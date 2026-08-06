import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  HostDiagnostics,
  ImagegenSkillProvenance
} from "@styleforge/contracts/native-messaging";
import {
  subjectQualityJsonSchema,
  subjectQualityReportSchema,
  type GenerationReferenceRole
} from "@styleforge/contracts/subject-asset";
import {
  domainAnalysisResultJsonSchema,
  domainAnalysisResultSchema,
  domainClassificationJsonSchema,
  domainClassificationSchema,
  type Domain,
  type DomainClassification
} from "@styleforge/contracts/domain-profile";
import {
  normalizeSetQualityIssues,
  gridCellAnalysisResultJsonSchema,
  gridCellAnalysisResultSchema,
  setQualityReportJsonSchema,
  setQualityReportSchema,
  type CreativeShotPlan,
  type GridLayout
} from "@styleforge/contracts/creation-set";
import visualDNAJsonSchema from "@styleforge/contracts/visual-dna.schema.json" with { type: "json" };
import {
  createCodexAppServerCommand,
  discoverConfiguredCodex,
  STYLEFORGE_SUPPORT_DIR
} from "./codex-discovery.js";

export const GRID_ANALYSIS_TURN_TIMEOUT_MS = 75_000;
export const DOMAIN_ANALYSIS_TURN_TIMEOUT_MS = 240_000;

type RpcResponse = { id?: number; result?: unknown; error?: { code: number; message: string } };
type ServerNotification = { method?: string; params?: Record<string, unknown> };

export function resolveDomainRouting(classification: DomainClassification) {
  return {
    domain: classification.domain,
    routingState: classification.confidence < 0.65 ? "uncertain" as const : "confirmed" as const,
    secondCandidate: classification.secondCandidate
  };
}

export async function inspectImagegenSkill(skillPath: string): Promise<ImagegenSkillProvenance> {
  const resolvedPath = await realpath(skillPath);
  const bytes = await readFile(resolvedPath);
  return {
    path: resolvedPath,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

export class CodexClient {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private turnWaiters = new Map<string, { resolve: (turn: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private completedTurns = new Map<string, Record<string, unknown>>();
  private turnItems = new Map<string, Array<Record<string, unknown>>>();
  private activeTurn?: { threadId: string; turnId: string };

  constructor(private readonly codexPath?: string) {}

  async start() {
    if (this.child) return;
    if (!this.codexPath) throw new Error("尚未配置可执行的 Codex CLI 路径");
    const command = createCodexAppServerCommand(this.codexPath);
    this.child = spawn(command.executable, command.args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child.on("exit", (code) => {
      this.child = undefined;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Codex App Server 已退出（${code ?? "未知状态"}）`));
      }
      this.pending.clear();
      for (const waiter of this.turnWaiters.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`Codex App Server 已退出（${code ?? "未知状态"}）`));
      }
      this.turnWaiters.clear();
      this.activeTurn = undefined;
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line) as RpcResponse & ServerNotification;
        if (typeof message.id !== "number") {
          if (message.method === "item/completed") {
            const turnId = message.params?.turnId;
            const item = message.params?.item as Record<string, unknown> | undefined;
            if (typeof turnId === "string" && item) {
              const items = this.turnItems.get(turnId) ?? [];
              items.push(item);
              this.turnItems.set(turnId, items);
            }
          }
          if (message.method === "turn/completed") {
            const turn = message.params?.turn as Record<string, unknown> | undefined;
            const turnId = turn?.id;
            if (typeof turnId === "string" && turn) {
              const collectedItems = this.turnItems.get(turnId);
              if (collectedItems?.length) turn.items = collectedItems;
              this.turnItems.delete(turnId);
              const waiter = this.turnWaiters.get(turnId);
              if (waiter) {
                clearTimeout(waiter.timer);
                this.turnWaiters.delete(turnId);
                waiter.resolve(turn);
              } else this.completedTurns.set(turnId, turn);
            }
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } catch {
        // 非 JSON 日志只会出现在 stderr；忽略异常 stdout 行以保持 Host 存活。
      }
    });
    await this.call("initialize", {
      clientInfo: { name: "styleforge", title: "VisualForge", version: "0.5.8" },
      capabilities: { experimentalApi: false }
    });
    this.notify("initialized", {});
  }

  call(method: string, params: unknown, timeoutMs = 12_000) {
    if (!this.child) return Promise.reject(new Error("Codex App Server 尚未启动"));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 响应超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  notify(method: string, params: unknown) {
    this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  close() {
    this.child?.kill();
    this.child = undefined;
    this.activeTurn = undefined;
  }

  async interruptActiveTurn() {
    const active = this.activeTurn;
    if (!active) {
      return { cancelled: false as const, message: "当前没有可取消的 Codex turn" };
    }
    await this.call("turn/interrupt", active);
    return { cancelled: true as const };
  }

  waitForTurn(
    turnId: string,
    timeoutMs = 180_000,
    timeoutLabel = "分析",
    turnContext?: { threadId: string; turnId: string }
  ) {
    const completed = this.completedTurns.get(turnId);
    if (completed) {
      this.completedTurns.delete(turnId);
      return Promise.resolve(completed);
    }
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.turnWaiters.delete(turnId);
        this.completedTurns.delete(turnId);
        this.turnItems.delete(turnId);
        const timeoutError = new Error(`Codex ${timeoutLabel}响应超时`);
        if (!turnContext) {
          reject(timeoutError);
          return;
        }
        void this.call("turn/interrupt", turnContext)
          .catch(() => undefined)
          .finally(() => reject(timeoutError));
      }, timeoutMs);
      this.turnWaiters.set(turnId, { resolve, reject, timer });
    });
  }

  private async runStructuredImageTurn(
    prompt: string,
    imagePaths: string[],
    outputSchema: unknown,
    errorLabel: string,
    timeoutMs = 180_000
  ) {
    const threadResponse = await this.call("thread/start", {
      cwd: STYLEFORGE_SUPPORT_DIR,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true
    }, 60_000) as { thread?: { id?: string } };
    const threadId = threadResponse.thread?.id;
    if (!threadId) throw new Error("Codex 未返回线程标识");
    const turnResponse = await this.call("turn/start", {
      threadId,
      input: [
        { type: "text", text: prompt },
        ...imagePaths.map((imagePath) => ({ type: "localImage", path: imagePath }))
      ],
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      outputSchema
    }, 60_000) as { turn?: { id?: string } };
    const turnId = turnResponse.turn?.id;
    if (!turnId) throw new Error(`Codex 未返回${errorLabel}任务标识`);
    this.activeTurn = { threadId, turnId };
    let turn: Record<string, unknown>;
    try {
      turn = await this.waitForTurn(turnId, timeoutMs, errorLabel, { threadId, turnId });
    } finally {
      if (this.activeTurn?.turnId === turnId) this.activeTurn = undefined;
    }
    if (turn.status !== "completed") {
      const error = turn.error as { message?: string } | null;
      throw new Error(error?.message ?? `Codex ${errorLabel}未完成`);
    }
    const items = turn.items as Array<{ type?: string; text?: string }> | undefined;
    const text = [...(items ?? [])].reverse().find((item) => item.type === "agentMessage")?.text;
    if (!text) throw new Error(`Codex 未返回结构化${errorLabel}`);
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Codex 返回的${errorLabel}不是有效 JSON`);
    }
  }

  async analyzeDomainImage(imagePath: string, sourceImageHash: string) {
    const classification = domainClassificationSchema.parse(await this.runStructuredImageTurn(
      DOMAIN_CLASSIFICATION_PROMPT,
      [imagePath],
      domainClassificationJsonSchema,
      "领域识别",
      420_000
    ));
    const routing = resolveDomainRouting(classification);
    const domain = routing.domain;
    const now = Date.now();
    const result = await this.runStructuredImageTurn(
      `${routing.routingState === "uncertain" ? ANALYZE_PROMPT : DOMAIN_ANALYSIS_PROMPTS[domain]}

${routing.routingState === "uncertain"
  ? `当前最高候选为 ${domain}，第二候选为 ${routing.secondCandidate?.domain ?? "无法确认"}。使用通用 Visual DNA 分析，并在可观察时补充这两个候选领域的重要字段；不得把不确定性改写为通用摄影。`
  : ""}

同时输出统一 Visual DNA 与 DomainProfile。只记录画面中可观察的依据，不输出私有推理过程，不猜测品牌、人物身份或艺术家姓名。
镜头类型、焦段、光圈、器材、透视成因或情绪如果不能从像素直接确认，字段内容必须以“视觉推测：”开头；不得把近似镜头感写成拍摄事实。

DomainProfile 工程字段必须使用：
- schemaVersion: 1.0.0
- domain: ${domain}
- confidence: ${classification.confidence}
- observedSignals: ${JSON.stringify(classification.observedSignals)}
- routingState: ${routing.routingState}
- secondCandidate: ${JSON.stringify(routing.secondCandidate)}
- profileVersion: ${domain}-v1
- source: auto

Visual DNA 工程字段必须使用：
- schemaVersion: 1.1.0
- revision: 1
- sourceImageHash: ${sourceImageHash}
- analysisModel: codex-app-server-default
- analysisVersion: domain-intelligence-v1
- createdAt 与 updatedAt: ${now}
- locks 的九个字段全部使用 unlocked
- references 只包含当前原始参考图`,
      [imagePath],
      domainAnalysisResultJsonSchema,
      "领域化视觉分析",
      420_000
    );
    const candidate = domainAnalysisResultSchema.parse(result);
    return domainAnalysisResultSchema.parse({
      domainProfile: {
        ...candidate.domainProfile,
        domain,
        confidence: classification.confidence,
        observedSignals: classification.observedSignals,
        routingState: routing.routingState,
        secondCandidate: routing.secondCandidate,
        profileVersion: `${domain}-v1`,
        source: "auto"
      },
      visualDNA: {
        ...candidate.visualDNA,
        schemaVersion: "1.1.0",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        sourceImageHash,
        analysisModel: "codex-app-server-default",
        analysisVersion: "domain-intelligence-v1",
        locks: {
          identity: "unlocked",
          subject: "unlocked",
          composition: "unlocked",
          camera: "unlocked",
          lighting: "unlocked",
          palette: "unlocked",
          material: "unlocked",
          texture: "unlocked",
          style: "unlocked"
        },
        references: [{
          assetId: null,
          sourceImageHash,
          role: "style_layout",
          influence: 1,
          notes: null
        }]
      }
    });
  }

  async analyzeDomainImageJoint(imagePath: string, sourceImageHash: string) {
    const now = Date.now();
    const candidate = domainAnalysisResultSchema.parse(await this.runStructuredImageTurn(
      `${ANALYZE_PROMPT}

在同一次分析中先识别最可能的视觉输出领域，再完成对应 DomainProfile 和统一 Visual DNA。领域只能是 portrait、product、poster、illustration、photography。
confidence 必须反映可观察证据；低于 0.65 时 routingState 使用 uncertain，保留最高候选领域，不得强制改成 photography，并填写 secondCandidate。

DomainProfile 工程字段：
- schemaVersion: 1.0.0
- profileVersion: <domain>-joint-v1
- source: auto

Visual DNA 工程字段：
- schemaVersion: 1.1.0
- revision: 1
- sourceImageHash: ${sourceImageHash}
- analysisModel: codex-app-server-default
- analysisVersion: domain-intelligence-joint-v2
- createdAt 与 updatedAt: ${now}
- locks 的九个字段全部使用 unlocked
- references 只包含当前原始参考图
- 镜头类型、焦段、光圈、器材、透视成因或情绪如果不能从像素直接确认，字段内容必须以“视觉推测：”开头`,
      [imagePath],
      domainAnalysisResultJsonSchema,
      "联合领域化视觉分析",
      DOMAIN_ANALYSIS_TURN_TIMEOUT_MS
    ));
    const confidence = candidate.domainProfile.confidence;
    return domainAnalysisResultSchema.parse({
      domainProfile: {
        ...candidate.domainProfile,
        routingState: confidence !== null && confidence < 0.65 ? "uncertain" : "confirmed",
        profileVersion: `${candidate.domainProfile.domain}-joint-v1`,
        source: "auto"
      },
      visualDNA: {
        ...candidate.visualDNA,
        schemaVersion: "1.1.0",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        sourceImageHash,
        analysisModel: "codex-app-server-default",
        analysisVersion: "domain-intelligence-joint-v2",
        locks: {
          identity: "unlocked",
          subject: "unlocked",
          composition: "unlocked",
          camera: "unlocked",
          lighting: "unlocked",
          palette: "unlocked",
          material: "unlocked",
          texture: "unlocked",
          style: "unlocked"
        },
        references: [{
          assetId: null,
          sourceImageHash,
          role: "style_layout",
          influence: 1,
          notes: null
        }]
      }
    });
  }

  async analyzeDomainImageReliable(imagePath: string, sourceImageHash: string) {
    try {
      return await this.analyzeDomainImageJoint(imagePath, sourceImageHash);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/cancel|取消/i.test(message)) throw cause;
      return this.analyzeDomainImageJoint(imagePath, sourceImageHash);
    }
  }

  async checkCreationSetQuality(
    items: Array<{
      itemId: string;
      planTitle: string;
      creativePlan?: CreativeShotPlan;
      path: string;
    }>,
    context?: {
      domain: Domain;
      references: Array<{
        role: GenerationReferenceRole;
        imagePurpose?: "face" | "full_body";
        path: string;
      }>;
      sharedInvariants: string[];
      signatureStyle?: {
        styleId: string;
        styleName: string;
        signatureCode: string;
        dedicatedDimensions: string[];
        observableSignals: string[];
        failureSignals: string[];
        retryStrategy: string;
      } | null;
    }
  ) {
    const effectiveContext = context ?? {
      domain: "photography" as const,
      references: [],
      sharedInvariants: []
    };
    const now = Date.now();
    const itemMap = items.map((item, index) =>
      `输出图 ${index + 1} 对应 itemId=${item.itemId}，计划=${item.planTitle}，Creative Shot Plan=${item.creativePlan ? JSON.stringify(item.creativePlan) : "旧版调用未提供"}`).join("\n");
    const referenceMap = effectiveContext.references.map((reference, index) =>
      `参考图 ${index + 1} 角色=${reference.role}${reference.imagePurpose ? `，人物用途=${reference.imagePurpose}` : ""}`).join("\n");
    const domainChecklist = effectiveContext.domain === "portrait"
      ? `人像问题类型使用：
- identity_drift：相对 identity 参考的脸型、五官、年龄感或发型漂移
- body_proportion_drift：相对 full_body 人物参考的肩宽、腰胯轮廓、腿身比、四肢粗细、体态或重心明显漂移
- pose_anomaly：动作的左右侧、关节链、持物侧、遮挡或接触关系不可信，包括手臂跨过身体中线／从对侧腋下穿过、反关节、穿模或冲突动作
- expression_anomaly：未由计划要求的挤眼、歪嘴、夸张张嘴、眉眼不协调或其他怪异表情
- structural_error：缺失、多余或融合的肢体／手指／脚，错误关节、身体截断、穿模，或人与车辆／道具／地面之间无法解释的遮挡和接触关系
- emotion_flat：情绪不可读或未形成计划要求的情绪高潮
- pose_repeat：姿态、动作或手势与其他输出重复
- composition_repeat：景别、机位、主体位置或留白关系重复
- style_mismatch：相对 style 参考的摄影、色彩、光线、材质或后期方法偏离
- reference_pose_mismatch：相对 style_layout 待复刻画面的动作阶段、身体朝向、左右手职责、持物侧、遮挡或接触关系偏离
- reference_expression_mismatch：相对 style_layout 待复刻画面的视线、嘴部状态、眉眼关系或情绪强度偏离
- wardrobe_continuity_drift：相对 style_layout 或同组已通过画面的服装、帽子、饰品、妆发、颜色、图案或面料偏离
- reference_composition_mismatch：相对 style_layout 的景别、机位、主体占比、位置、留白、前中后景或道具空间关系偏离
- reference_lighting_mismatch：相对 style_layout 的主光方向、光质、曝光、高光、阴影、色温、反差、景深或后期质感偏离
- set_continuity_mismatch：同组画面的服装、妆发、场景、时间、天气、主光、曝光、色彩、材质或后期不连续
四个门必须彼此独立检查：
1. 面部身份只对照 imagePurpose=face 的 identity 参考，逐项检查脸型、眼睛、眉形、鼻子、嘴唇、五官相对位置、年龄感、发际线、发型和稳定识别特征。
2. 身材体型只对照 imagePurpose=full_body 的 identity 参考，检查肩宽、腰胯轮廓、腿身比、四肢粗细、体态和重心；没有 full_body 参考时不得臆造“体型相同”结论。
style_layout 待复刻画面不是人物身份来源：脸型、五官、年龄、肤色和体型只对照 identity；但其服装、动作、表情、构图、背景、道具、光影、色彩、材质与后期正是必须保持的画面锚点。输出若更像待复刻画面中的原人物脸或体型，判为 identity_drift 或 body_proportion_drift；输出若丢失待复刻画面的服装、动作表情、构图或光影，分别使用上述 reference_* 或 wardrobe_continuity_drift，不得把“换了人物”误解为重做整张图。
3. 动作结构逐项检查左右肩—肘—腕、髋—膝—踝—脚链路、持物侧、接触点和遮挡可读性；一只手只承担一个任务，跨身体中线或从对侧腋下持物视为 pose_anomaly。
4. 表情单独检查双眼对称可读、嘴部自然、眉眼协调；未由计划明确要求的挤眼、歪嘴、夸张张嘴或挑眉视为 expression_anomaly。
任一门出现普通观看者可直接发现的明显失败，都必须建议只重试该张；不得用“整体氛围不错”抵消失败。
每张都先检查人体数量、头颈躯干连接、左右手臂、双手、两条腿、双脚和关节；允许合理出画，但任何被车体、衣物或前景遮挡的肢体都必须有可读的轮廓、关节、脚部或接触点。即使三维关系理论上可以解释，只要整条腿完全藏在车体或前景后、没有任何脚／踝／膝／独立轮廓线索，普通观看者会直接读成缺腿，就必须使用 structural_error 并建议只重试该张。参考图清楚展示双腿时，输出必须保持双腿可读性。明显缺肢、融合、多肢、错误关节或穿模同样必须使用 structural_error。
逐项检查 dimension：reference_pose_fidelity、reference_expression_fidelity、wardrobe_continuity、reference_composition_fidelity、reference_lighting_fidelity、set_continuity、emotion_arc、story_progression、pose_diversity、camera_diversity、gaze_repetition、gesture_repetition、environment_relationship、memorable_frame_missing。`
      : effectiveContext.domain === "product"
        ? `商品问题类型使用：
- geometry_drift：相对 subject 参考的外形、比例、轮廓或组件位置漂移
- structure_mismatch：按钮、接口、开合件或关键结构数量／位置／形状错误
- material_inconsistency：材质、透明度、表面处理、反射或颜色不一致
- label_drift：标签区域、边界、比例或相对位置漂移
- text_layout_drift：文字块、字距、行距、阅读顺序或信息层级漂移
- logo_position_drift：Logo 的位置、比例、方向或安全区漂移
- duplicate_angle：景别、相机角度或观看方向与其他输出重复
- advertising_weakness：未清楚表达当前广告目的、品牌感、使用体验或产品价值
逐项检查 dimension：advertising_intent、product_hierarchy、brand_coherence、label_fidelity、text_layout_fidelity、logo_position_fidelity、material_realism、usage_causality、prop_relevance、shot_diversity、memorable_frame_missing。对无法从参考图准确辨认的可读文字必须标为不确定，不得伪造。`
        : "仅使用 schema 中与可观察问题最匹配的类型。";
    const signatureStyleChecklist = effectiveContext.signatureStyle
      ? `\nVisualForge 专属风格验收：
- 风格：${effectiveContext.signatureStyle.styleName}（${effectiveContext.signatureStyle.signatureCode}）
- 专属审查维度：${effectiveContext.signatureStyle.dedicatedDimensions.join("；")}
- 输出必须能观察到：${effectiveContext.signatureStyle.observableSignals.join("；")}
- 出现以下信号即判定风格失效：${effectiveContext.signatureStyle.failureSignals.join("；")}
- 定向重试策略：${effectiveContext.signatureStyle.retryStrategy}
不要按“好看／高级”等抽象印象评分；必须指出哪个可观察信号存在、缺失或冲突。`
      : "";
    const result = await this.runStructuredImageTurn(
      `${SET_QUALITY_PROMPT}

领域：${effectiveContext.domain}
${domainChecklist}
${signatureStyleChecklist}

图像顺序：
${referenceMap}
${itemMap}

共享不可变锚点：
${effectiveContext.sharedInvariants.join("\n")}

必须先把输出图与对应的 style_layout／style／identity／subject 参考逐项比较，再检查输出图之间的连续性。style_layout 是待复刻画面锚点，不是松散灵感。每个问题必须写明 dimension、impact（为什么影响整套作品）、retryFocus（只强化什么）和 preserve（必须保持什么）。每个建议重试的 itemId 必须有精确问题类型和只修复该张的具体建议。

工程字段：
- schemaVersion: 1.0.0
- checkedAt: ${now}
- model: codex-app-server-default
${itemMap}`,
      [...effectiveContext.references.map((reference) => reference.path), ...items.map((item) => item.path)],
      setQualityReportJsonSchema,
      "整组一致性检查",
      900_000
    );
    const report = setQualityReportSchema.parse(result);
    return {
      ...report,
      issues: normalizeSetQualityIssues(effectiveContext.domain, report.issues)
    };
  }

  async analyzeImage(imagePath: string, sourceImageHash: string) {
    const threadResponse = await this.call("thread/start", {
      cwd: STYLEFORGE_SUPPORT_DIR,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true
    }, 60_000) as { thread?: { id?: string } };
    const threadId = threadResponse.thread?.id;
    if (!threadId) throw new Error("Codex 未返回线程标识");
    const turnResponse = await this.call("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: `${ANALYZE_PROMPT}

工程字段必须使用以下精确值：
- schemaVersion: 1.1.0
- revision: 1
- sourceImageHash: ${sourceImageHash}
- analysisModel: codex-app-server-default
- analysisVersion: visual-dna-v1
- createdAt 与 updatedAt: ${Date.now()}
- locks 的九个字段全部使用 unlocked`
        },
        { type: "localImage", path: imagePath }
      ],
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      outputSchema: visualDNAJsonSchema
    }, 60_000) as { turn?: { id?: string } };
    const turnId = turnResponse.turn?.id;
    if (!turnId) throw new Error("Codex 未返回分析任务标识");
    this.activeTurn = { threadId, turnId };
    let turn: Record<string, unknown>;
    try {
      turn = await this.waitForTurn(turnId, 180_000, "分析", { threadId, turnId });
    } finally {
      if (this.activeTurn?.turnId === turnId) this.activeTurn = undefined;
    }
    if (turn.status !== "completed") {
      const error = turn.error as { message?: string } | null;
      throw new Error(error?.message ?? "Codex 视觉分析未完成");
    }
    const items = turn.items as Array<{ type?: string; text?: string }> | undefined;
    const text = [...(items ?? [])].reverse().find((item) => item.type === "agentMessage")?.text;
    if (!text) {
      const itemTypes = (items ?? []).map((item) => item.type ?? "unknown").join(", ");
      throw new Error(`Codex 未返回结构化视觉分析（返回项：${itemTypes || "无"}）`);
    }
    try {
      const result = JSON.parse(text) as Record<string, unknown>;
      const now = Date.now();
      return {
        ...result,
        schemaVersion: "1.1.0",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        sourceImageHash,
        analysisModel: "codex-app-server-default",
        analysisVersion: "visual-dna-v1",
        locks: {
          identity: "unlocked",
          subject: "unlocked",
          composition: "unlocked",
          camera: "unlocked",
          lighting: "unlocked",
          palette: "unlocked",
          material: "unlocked",
          texture: "unlocked",
          style: "unlocked"
        },
        references: [{
          assetId: null,
          sourceImageHash,
          role: "style_layout",
          influence: 1,
          notes: null
        }]
      };
    } catch {
      throw new Error("Codex 返回的 Visual DNA 不是有效 JSON");
    }
  }

  async analyzeGridImage(imagePath: string, sourceImageHash: string, layout: GridLayout) {
    const columnStops = layout.columnStops.map((stop) => stop.toFixed(4)).join(", ") || "无";
    const rowStops = layout.rowStops.map((stop) => stop.toFixed(4)).join(", ") || "无";
    const candidate = gridCellAnalysisResultSchema.parse(await this.runStructuredImageTurn(
      `分析这张宫格参考图中的每一个独立画面。按从左到右、从上到下的顺序输出，index 从 0 开始。

已确认布局：${layout.columns} 列 × ${layout.rows} 行，共 ${layout.count} 格。
列分隔位置（0～1）：${columnStops}
行分隔位置（0～1）：${rowStops}

每格只输出四项可观察语义：
- composition：主体位置、前后层次、留白、视觉重心和方向关系。
- shotScale：全景／中景／半身／近景／特写等可观察景别；不猜测器材。
- action：画面中可见的动作、姿态或商品使用／陈列状态；静止时明确写静态关系。
- emotion：由表情、姿态、光线和空间共同呈现的情绪或广告感受；不猜人物身份。

不得把不同格写成同一套空泛文案。不要判断人物身份或臆造品牌；服装、背景、道具、动作和光影如果影响构图或情绪，必须按当前格真实可见内容准确描述，不得忽略。必须输出恰好 ${layout.count} 个 cells，index 必须为 0 到 ${layout.count - 1} 且不重复。

工程字段必须为：
- schemaVersion: 1.0.0
- analysisVersion: grid-semantics-v1
- model: codex-app-server-default
- sourceImageHash: ${sourceImageHash}`,
      [imagePath],
      gridCellAnalysisResultJsonSchema,
      "宫格逐格语义分析",
      GRID_ANALYSIS_TURN_TIMEOUT_MS
    ));
    const cells = [...candidate.cells].sort((left, right) => left.index - right.index);
    if (cells.length !== layout.count || cells.some((cell, index) => cell.index !== index)) {
      throw new Error(`Codex 宫格分析返回 ${cells.length} 格，预期 ${layout.count} 格且序号连续`);
    }
    return gridCellAnalysisResultSchema.parse({
      ...candidate,
      schemaVersion: "1.0.0",
      analysisVersion: "grid-semantics-v1",
      model: "codex-app-server-default",
      sourceImageHash,
      cells
    });
  }

  async checkSubjectQuality(images: Array<{ assetId: string; path: string }>) {
    const threadResponse = await this.call("thread/start", {
      cwd: STYLEFORGE_SUPPORT_DIR,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true
    }, 60_000) as { thread?: { id?: string } };
    const threadId = threadResponse.thread?.id;
    if (!threadId) throw new Error("Codex 未返回线程标识");
    const now = Date.now();
    const ids = images.map((image, index) => `图 ${index + 1} 的 assetId 必须为 ${image.assetId}`).join("\n");
    const turnResponse = await this.call("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: `${SUBJECT_QUALITY_PROMPT}

工程字段：
- schemaVersion: 1.0.0
- checkedAt: ${now}
- model: codex-app-server-default
${ids}`
        },
        ...images.map((image) => ({ type: "localImage", path: image.path }))
      ],
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      outputSchema: subjectQualityJsonSchema
    }, 60_000) as { turn?: { id?: string } };
    const turnId = turnResponse.turn?.id;
    if (!turnId) throw new Error("Codex 未返回人物检查任务标识");
    this.activeTurn = { threadId, turnId };
    let turn: Record<string, unknown>;
    try {
      turn = await this.waitForTurn(turnId, 180_000, "人物照片检查", { threadId, turnId });
    } finally {
      if (this.activeTurn?.turnId === turnId) this.activeTurn = undefined;
    }
    if (turn.status !== "completed") {
      const error = turn.error as { message?: string } | null;
      throw new Error(error?.message ?? "Codex 人物照片检查未完成");
    }
    const items = turn.items as Array<{ type?: string; text?: string }> | undefined;
    const text = [...(items ?? [])].reverse().find((item) => item.type === "agentMessage")?.text;
    if (!text) throw new Error("Codex 未返回结构化人物照片检查");
    return subjectQualityReportSchema.parse(JSON.parse(text));
  }

  async generateImage(
    references: Array<{
      path: string;
      role: GenerationReferenceRole;
      imagePurpose?: "face" | "full_body";
      sourceKind?: "original" | "identity_board";
    }>,
    prompt: string,
    outputDir: string,
    count: number,
    onTiming?: (timings: { skillDiscoveryMs: number; generationTurnMs: number }) => void,
    onSkill?: (skill: ImagegenSkillProvenance) => void
  ) {
    await mkdir(outputDir, { recursive: true });
    const skillDiscoveryStartedAt = performance.now();
    const skills = await this.call("skills/list", { cwds: [outputDir], forceReload: false }) as {
      data?: Array<{ skills?: Array<{ name?: string; path?: string; enabled?: boolean }> }>;
    };
    const skillDiscoveryMs = performance.now() - skillDiscoveryStartedAt;
    const imagegen = skills.data?.flatMap((entry) => entry.skills ?? [])
      .find((skill) => skill.name === "imagegen" && skill.enabled && skill.path);
    if (!imagegen?.path) throw new Error("当前 Codex 未检测到 imagegen 技能");
    const imagegenSkill = await inspectImagegenSkill(imagegen.path).catch((error) => {
      throw new Error(`无法读取 imagegen 技能文件：${error instanceof Error ? error.message : String(error)}`);
    });
    onSkill?.(imagegenSkill);
    const threadResponse = await this.call("thread/start", {
      cwd: outputDir,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      ephemeral: true
    }, 60_000) as { thread?: { id?: string } };
    const threadId = threadResponse.thread?.id;
    if (!threadId) throw new Error("Codex 未返回生成线程标识");
    const referenceMap = references.map((reference, index) => {
      const purpose = reference.imagePurpose === "face"
        ? "面部身份，只锁定同一个人的脸型、五官相对位置、年龄感与发型"
        : reference.imagePurpose === "full_body"
          ? "全身体型，只锁定肩胯、腿身比、四肢粗细、体态与接地关系"
          : reference.role === "style"
            ? "摄影指纹，保持光线方向与软硬、曝光与高光、饱和度与反差、景深与镜头感、材质与后期质感，不得继承图中人物身份"
            : reference.role === "style_layout"
              ? "待复刻画面模板，保持风格、构图、气质、背景、道具、服装或承托面、动作表情、光影、色彩、材质和后期，只替换用户主体"
            : reference.role === "composition"
              ? "当前宫格单格模板，保持该格景别、主体位置、动作、情绪、光影、色彩、材质和空间关系，不得继承图中人物身份"
              : reference.role === "edit_base"
                ? "定向修复底图，只修复明确缺陷，其他像素关系和参考锚点保持不变"
              : reference.role;
      return `图 ${index + 1}：${purpose}；来源=${reference.sourceKind ?? "original"}`;
    }).join("\n");
    const identityMode = references.some((reference) => reference.role === "identity")
      ? `Use case: identity-preserve
把这次任务视为人物身份保持编辑，不是重新设计一个相似人物。所有 identity 图片都必须逐张使用：第一张 identity 是身份主照片，负责首要脸部锚点；其余 identity 是同一人的角度、五官和全身体型联合证据，负责交叉校验，不得忽略，也不得把多张脸平均成新脸。待复刻画面模板负责除身份外的画面风格、气质、构图、背景、道具、服装或承托面、动作表情、光影、色彩、材质与后期，不得擅自重做。不得使用 style／style_layout／composition 图中的人物身份。全身画面必须保持用户体型参考的头身关系、躯干长度、腰线、膝位、腿身比与腿部长度，避免近距离广角透视，禁止大头小身、短躯干和短腿。动作必须保持可解释的肩—肘—腕、髋—膝—踝关节链，单手只执行一个动作，表情自然克制。`
      : "";
    const generationTurnStartedAt = performance.now();
    const turnResponse = await this.call("turn/start", {
      threadId,
      input: [
        { type: "skill", name: "imagegen", path: imagegenSkill.path },
        { type: "text", text: `${identityMode}\n\n输入图片职责：\n${referenceMap}\n\n${prompt}\n\n请严格按上面的图号和参考图职责使用随后按顺序提供的图片。请生成 ${count} 张图片，必须保存到这个目录：${outputDir}\n完成后明确返回保存文件。` },
        ...references.map((reference) => ({ type: "localImage", path: reference.path }))
      ],
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [outputDir],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false
      }
    }, 60_000) as { turn?: { id?: string } };
    const turnId = turnResponse.turn?.id;
    if (!turnId) throw new Error("Codex 未返回图像生成任务标识");
    this.activeTurn = { threadId, turnId };
    let turn: Record<string, unknown>;
    try {
      turn = await this.waitForTurn(turnId, 420_000, "图像生成", { threadId, turnId });
    } finally {
      if (this.activeTurn?.turnId === turnId) this.activeTurn = undefined;
    }
    onTiming?.({
      skillDiscoveryMs,
      generationTurnMs: performance.now() - generationTurnStartedAt
    });
    if (turn.status !== "completed") {
      const error = turn.error as { message?: string } | null;
      throw new Error(error?.message ?? "Codex 图像生成未完成");
    }
    const items = turn.items as Array<{ type?: string; savedPath?: string }> | undefined;
    const saved = (items ?? []).filter((item) => item.type === "imageGeneration" && item.savedPath)
      .map((item) => item.savedPath!)
      .filter((filePath) => path.resolve(filePath).startsWith(path.resolve(outputDir) + path.sep));
    if (saved.length) return saved.slice(0, count);
    const entries = await readdir(outputDir);
    const candidates = await Promise.all(entries
      .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
      .map(async (name) => {
        const filePath = path.join(outputDir, name);
        return { filePath, modified: (await stat(filePath)).mtimeMs };
      }));
    candidates.sort((a, b) => b.modified - a.modified);
    const paths = candidates.slice(0, count).map((entry) => entry.filePath);
    if (!paths.length) throw new Error("Codex 已结束，但没有找到生成的图片文件");
    return paths;
  }
}

const ANALYZE_PROMPT = `你是一名视觉分析师和图像生成提示词编译器。只根据输入参考图，提取可以被另一张新作品复用的视觉规则，不要把具体内容误当成风格。必须具体记录主体占画比例、位置与留白，光线方向和软硬、明暗比、高光与阴影边界，饱和度、色温与反差，景深、近似镜头感与透视，以及颗粒、锐度、皮肤／材质细节和后期质感；不得用“高级、氛围感、电影感”等抽象词替代可观察事实。分别分析主体、构图、光线、色彩、材质、不变量、变量与禁止项。使用清晰具体的中文，不猜测品牌、身份或艺术家姓名。镜头类型、焦段、光圈、器材、透视成因或情绪如果不能从像素直接确认，必须标注“视觉推测”或“近似镜头感”，不得写成确定事实。输出必须符合提供的 JSON Schema。`;

const SUBJECT_QUALITY_PROMPT = `检查随后 1～5 张人物照片。逐图判断：是否检测到人脸、是否多人、分辨率是否过低、是否过暗、是否过曝、五官是否严重遮挡、是否极端侧脸、是否有可用正脸信息；多图时判断是否明显不是同一个人。不能可靠判断必须使用 unconfirmed 和“无法确认”，不得伪造 pass。每个问题说明具体图片、问题、建议和是否允许继续。只有完全没有可用人物、多图明显不是同一人、或全部照片无法使用时 overall 才是 blocked。`;

const DOMAIN_CLASSIFICATION_PROMPT = `只根据随后一张图片识别目标视觉输出领域。只能选择 portrait、product、poster、illustration、photography。领域描述视觉输出而不是主体类型；人物出现在海报中仍可属于 poster。动漫归入 illustration。confidence 必须反映可观察证据；observedSignals 只写画面中可核对的依据，不输出推理过程。`;

const DOMAIN_ANALYSIS_PROMPTS: Record<Domain, string> = {
  portrait: "使用人像摄影模板分析，并把可观察结论映射到现有字段：核心概念与完整视觉世界；主体占画比例；景别；相机高度、水平角度和俯仰角度；焦段、景深和透视；构图与留白；可见头身关系、躯干长度、腰线、膝位、腿身比、肩胯关系、身体重心、姿态和手部任务；动作处于发生前、进行中或发生后；视线、表情和情绪；环境、天气、时间；道具与人物关系；光线方向、软硬、明暗比、高光和阴影边界；饱和度、色温和反差；皮肤、服装与环境材质；颗粒、锐度和统一后期；可形成的套图节奏；最可能成为记忆点的画面。参考图无法确认的维度明确写“无法确认”，不得用通用模板冒充参考图事实。",
  product: "使用商品视觉模板分析，并把可观察结论映射到现有字段：核心概念与品牌世界；景别；相机高度、水平角度和俯仰角度；焦段与透视；构图与广告留白；商品朝向和工作状态；动作进行阶段；环境、天气和时间；道具与商品的穿过、压住、包围、支撑、悬浮、折射或融入关系；光线方向、软硬和明暗比；色彩体系；外形、关键结构、Logo 和文字区域；材质、透明度、边缘高光、接触面、阴影和反射；可形成的套图节奏；统一后期；最可能成为记忆点的画面。参考图无法确认的维度明确写“无法确认”，不得用通用广告模板冒充参考图事实。",
  poster: "使用海报设计模板分析：画布比例、网格、信息层级、标题与正文角色、字体类别、字号关系、文字和图片区块位置、留白、装饰图形、边框、材质、印刷效果、安全区域、阅读顺序。不得猜测不可读文字，readableText 必须为 null。",
  illustration: "使用插画／动漫模板分析：媒介、线稿、笔触、色块、阴影方式、角色造型、形状语言、透视、色彩、背景复杂度、动态、渲染方式、纸张或数字材质。",
  photography: "使用通用摄影模板分析：主体、场景、事件或瞬间、景别、机位、镜头感、景深、曝光、光线、色彩、构图、环境质感、后期风格。"
};

const SET_QUALITY_PROMPT = `检查随后整组作品，提供“一致性检查建议”。先逐张检查主体结构和物理关系，再检查身份、参考图摄影指纹、计划执行与组内差异。人物必须独立检查头身关系、头部相对尺寸、躯干长度、腰线、膝位、腿身比、腿部长度、近距离透视畸变，以及头颈躯干、左右手臂、双手、两条腿、双脚、关节、遮挡和与道具／车辆／地面的接触；出现大头小身、短躯干或短腿时使用 body_proportion_drift。商品必须检查外形、组件、材质和使用关系。发现缺失、融合、多余肢体、错误关节、身体截断或穿模时必须作为明显结构错误建议重试，不能归为风格问题。逐项检查：人物或主体是否明显漂移；光线方向与软硬、曝光与高光、饱和度与反差、景深与镜头感、材质与后期质感是否偏离参考图；是否存在近重复；是否不符合对应计划，并列出建议重试的 itemId。还要检查整组是否只有背景变化，是否真实形成不同故事／广告目的、动作或使用行为、镜头景别、机位、情绪、环境关系和光影设计。缺少这些导演差异时使用 plan_mismatch，并明确指出缺失维度。只给可观察建议，不输出相似度分数、认证或准确率，不自动删除或重生成作品。不能确认时不要虚构问题。`;

export async function diagnoseCodex(): Promise<HostDiagnostics> {
  const codex = await discoverConfiguredCodex();
  if (!codex.found) {
    return {
      state: "codex-missing",
      label: "尚未检测到 Codex",
      codex,
      detail: `${codex.error}。可使用发行 Host 的 --configure-codex 指定绝对路径。`
    };
  }

  const client = new CodexClient(codex.path);
  try {
    await client.start();
    const account = await client.call("account/read", { refreshToken: false }) as {
      account?: { type?: string } | null; requiresOpenaiAuth?: boolean;
    };
    if (!account.account && account.requiresOpenaiAuth) {
      return {
        state: "login-required", label: "Codex 尚未登录", codex,
        detail: "请在终端运行 codex login，然后重新检测。"
      };
    }
    const models = await client.call("model/list", { includeHidden: false }) as { data?: unknown[] };
    const skills = await client.call("skills/list", { cwds: [STYLEFORGE_SUPPORT_DIR], forceReload: false }) as {
      data?: Array<{ skills?: Array<{ name?: string; path?: string; enabled?: boolean }> }>;
    };
    const imagegenCandidate = skills.data?.flatMap((entry) => entry.skills ?? [])
      .find((skill) => skill.name === "imagegen" && skill.enabled && skill.path);
    const imagegenSkill = imagegenCandidate?.path
      ? await inspectImagegenSkill(imagegenCandidate.path).catch(() => undefined)
      : undefined;
    const imagegen = Boolean(imagegenSkill);
    const securitySummary = codex.security?.trusted
      ? "Codex 可执行文件已验证为 OpenAI 签名"
      : codex.security?.risk;
    return {
      state: "connected",
      label: imagegen ? "Codex 已连接" : "Codex 已连接，可拆解风格",
      codex,
      modelCount: models.data?.length ?? 0,
      imagegen,
      ...(imagegenSkill ? { imagegenSkill } : {}),
      detail: [
        imagegen
          ? `已检测并校验 imagegen 技能：${imagegenSkill!.path}`
          : imagegenCandidate
            ? "检测到 imagegen 技能，但无法读取其内容并计算哈希"
            : "当前未检测到 imagegen 技能",
        securitySummary
      ].filter(Boolean).join("；")
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: /auth|login|unauthorized/i.test(message) ? "login-required" : "error",
      label: /auth|login|unauthorized/i.test(message) ? "Codex 尚未登录" : "Codex 连接失败",
      codex,
      detail: message
    };
  } finally {
    client.close();
  }
}
