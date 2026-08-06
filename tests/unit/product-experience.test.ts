import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { analyzePrompt } from "@styleforge/core";
import {
  appendGeneratedCandidates,
  canCreateWithRuntime,
  composeFinalPrompt,
  connectionGuidance,
  NATIVE_HOST_DOWNLOAD,
  findCriticPlanItem,
  presentFinalSelectionAction,
  selectLastCompatibleSubjectId,
  presentResultReferences,
  presentReferenceSource,
  presentTaskLifecycle,
  presentUserError
} from "../../apps/extension/entrypoints/sidepanel/experience";

describe("Product Experience Hardening", () => {
  it("把诊断中的 Codex 与实际 imagegen Skill 溯源写入任务参数", async () => {
    const module = await import("../../apps/extension/entrypoints/sidepanel/experience");
    const createParameters = (module as unknown as {
      runtimeProviderParameters?: (diagnostics: unknown, skill?: unknown) => Record<string, unknown>;
    }).runtimeProviderParameters;
    expect(createParameters).toBeTypeOf("function");
    expect(createParameters!({
      state: "connected",
      label: "Codex 已连接",
      codex: {
        found: true,
        path: "/custom/codex",
        version: "codex-cli 1.2.3",
        source: "configured",
        security: {
          resolvedPath: "/custom/codex",
          signatureStatus: "verified",
          teamId: "OTHERTEAM1",
          identifier: "codex",
          trusted: false,
          risk: "签名团队不是已验证的 OpenAI 发行方"
        },
        error: null
      },
      imagegenSkill: { path: "/skill/SKILL.md", sha256: "a".repeat(64) }
    })).toMatchObject({
      codexVersion: "codex-cli 1.2.3",
      codexPath: "/custom/codex",
      codexSignatureStatus: "verified",
      codexTeamId: "OTHERTEAM1",
      codexTrusted: false,
      imagegenSkillPath: "/skill/SKILL.md",
      imagegenSkillSha256: "a".repeat(64)
    });
  });

  it("未经作品检查时明确提示跳过并要求确认", () => {
    expect(presentFinalSelectionAction(false)).toEqual({
      label: "跳过检查并选为最终版本",
      requiresConfirmation: true
    });
    expect(presentFinalSelectionAction(true)).toEqual({
      label: "选为最终版本",
      requiresConfirmation: false
    });
    expect(presentFinalSelectionAction(true, true)).toEqual({
      label: "仍选为最终版本",
      requiresConfirmation: true
    });
  });

  it("本地连接缺失或过旧时提供统一的跨平台官方下载页", async () => {
    expect(NATIVE_HOST_DOWNLOAD.url).toBe(
      "https://dososo.github.io/visualforge/"
    );
    const appSource = await readFile(
      new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
      "utf8"
    );
    const supportPage = await readFile(
      new URL("../../support.html", import.meta.url),
      "utf8"
    );
    const downloadsPage = await readFile(
      new URL("../../downloads.html", import.meta.url),
      "utf8"
    );
    expect(appSource).toContain('href={NATIVE_HOST_DOWNLOAD.url}');
    expect(appSource).toContain("下载适合本机的连接组件");
    expect(supportPage).toContain(NATIVE_HOST_DOWNLOAD.url);
    expect(supportPage).not.toContain("visualforge-public.vercel.app");
    expect(downloadsPage).toContain("VisualForge-0.5.8-macos-universal.dmg");
    expect(downloadsPage).toContain(
      "https://github.com/dososo/visualforge/releases/download/v0.5.8/"
    );
    expect(downloadsPage).not.toContain('href="/');
    expect(downloadsPage).toContain("VisualForge-0.5.8-windows-x64.zip");
    expect(downloadsPage).toContain("VisualForge-0.5.8-linux-x64.tar.gz");
    expect(downloadsPage).toContain("VisualForge-0.5.8-chrome.zip");
  });

  it("网页捕获入口在处理数据前显著说明用途、去向和本地边界", async () => {
    const appSource = await readFile(
      new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
      "utf8"
    );
    expect(appSource).toContain("不会在点击前上传页面内容");
    expect(appSource).toContain("当前登录的 Codex／OpenAI 处理");
    expect(appSource).toContain("所选图片、来源页面和你的要求会保存在本机");
  });

  it("粘贴参考图使用系统粘贴事件，不申请持续剪贴板读取权限", async () => {
    const appSource = await readFile(
      new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
      "utf8"
    );
    const configSource = await readFile(
      new URL("../../apps/extension/wxt.config.ts", import.meta.url),
      "utf8"
    );
    expect(appSource).toContain('window.addEventListener("paste", onPaste)');
    expect(appSource).toContain("const pasteShortcutLabel");
    expect(appSource).toContain('"⌘V" : "Ctrl+V"');
    expect(appSource).toContain("复制图片后，在侧边栏按 ${pasteShortcutLabel()}");
    expect(appSource).not.toContain("navigator.clipboard.read()");
    expect(configSource).not.toContain("\"clipboardRead\"");
  });

  it("参考图分析后只恢复最近使用且领域兼容的人物或商品", () => {
    const subjects = [
      { id: "person-1", type: "person" as const },
      { id: "product-1", type: "product" as const },
      { id: "pet-1", type: "pet" as const }
    ];
    const projects = [
      { selectedSubjectAssetId: "person-1", updatedAt: 100 },
      { selectedSubjectAssetId: "product-1", updatedAt: 300 },
      { selectedSubjectAssetId: "pet-1", updatedAt: 200 }
    ];

    expect(selectLastCompatibleSubjectId("portrait", projects, subjects)).toBe("person-1");
    expect(selectLastCompatibleSubjectId("product", projects, subjects)).toBe("product-1");
    expect(selectLastCompatibleSubjectId("illustration", projects, subjects)).toBeNull();
  });

  it("用户编辑反推提示词后，最终提示词同时保留编辑稿和对象替换约束", () => {
    expect(composeFinalPrompt("原始反推提示词", "原始反推提示词", "系统最终提示词"))
      .toBe("系统最终提示词");
    expect(composeFinalPrompt("原始反推提示词", "用户编辑后的反推提示词", "系统最终提示词"))
      .toContain("用户确认的参考图反推提示词");
    expect(composeFinalPrompt("原始反推提示词", "用户编辑后的反推提示词", "系统最终提示词"))
      .toContain("用户编辑后的反推提示词");
    expect(composeFinalPrompt("原始反推提示词", "用户编辑后的反推提示词", "系统最终提示词"))
      .toContain("系统最终提示词");
  });

  it("结果路径去掉同一参考图的内部重复职责，人像流程不误显示我的商品", () => {
    expect(presentResultReferences([
      { assetId: "reference-1", role: "style_layout" },
      { assetId: "person-1", role: "identity", subjectName: "小林" }
    ])).toEqual([
      { assetId: "reference-1", role: "style_layout", label: "待复刻画面" },
      { assetId: "person-1", role: "identity", label: "小林" }
    ]);
    expect(presentResultReferences([
      { assetId: "composition-1", role: "composition" },
      { assetId: "product-1", role: "subject" }
    ])).toEqual([
      { assetId: "product-1", role: "subject", label: "我的商品" },
      { assetId: "composition-1", role: "composition", label: "构图参考" }
    ]);
  });

  it("视觉分析明确区分画面事实与镜头推测", () => {
    expect(analyzePrompt).toContain("视觉推测");
    expect(analyzePrompt).toContain("近似镜头感");
    expect(analyzePrompt).toContain("不得写成确定事实");
  });

  it("任务展示只使用真实 TaskRecord 状态", () => {
    const uploading = presentTaskLifecycle("ANALYSIS", "UPLOADING");
    expect(uploading.status).toBe("UPLOADING");
    expect(uploading.label).toBe("正在读取参考图");
    expect(uploading.steps.map((step) => [step.status, step.state])).toEqual([
      ["CREATED", "complete"],
      ["UPLOADING", "current"],
      ["ANALYZING", "pending"],
      ["READY", "pending"]
    ]);
    expect(uploading.steps.map((step) => step.label)).not.toContain("整理视觉规则");

    const saving = presentTaskLifecycle("GENERATION", "GENERATING", "saving");
    expect(saving.status).toBe("GENERATING");
    expect(saving.label).toBe("正在校验并保存结果");
  });

  it("用户错误不直接泄露捕获和 Native 技术消息", () => {
    const capture = presentUserError(
      "capture",
      "TypeError: Failed to fetch net::ERR_BLOCKED_BY_RESPONSE",
      "direct"
    );
    expect(capture).toMatchObject({
      title: "图片没有添加成功",
      reason: "捕获方式：直接读取。该网页限制了原图访问，备用捕获也未能完成。",
      solution: "请重新捕获，或改用网页框选截图。",
      actionLabel: "框选当前网页"
    });
    expect(JSON.stringify(capture)).not.toContain("ERR_BLOCKED_BY_RESPONSE");
    expect(presentUserError("generation", "IMAGEGEN_UNAVAILABLE")).toMatchObject({
      title: "暂时不能生成作品",
      reason: "本地创作服务已连接，但图像生成功能还不可用。",
      solution: "请在设置中检查本地创作连接后重试。"
    });
    expect(presentUserError("image", "原参考图已不存在，请重新添加参考图后再试。")).toEqual({
      title: "原参考图已不存在",
      reason: "这条任务的原始输入已被清理，无法直接重试。",
      solution: "请重新添加参考图并重新分析后开始创作。",
      actionLabel: "重新选择图片"
    });
    expect(presentUserError("generation", "这条创作记录已不存在，请返回作品重新开始。")).toMatchObject({
      title: "创作记录已不存在",
      solution: "请返回创作首页，重新添加参考图后开始。"
    });
    expect(presentUserError("generation", "这条记录缺少已保存的参考图分析，请回到参考图重新分析。")).toMatchObject({
      title: "参考图分析记录不完整",
      solution: "请返回创作首页，重新分析参考图后开始。"
    });
    expect(presentUserError("generation", "第四张等待时间过长").reason).toContain("第四张等待时间过长");
    expect(presentUserError("generation", "TypeError: request failed at nativeHost").reason)
      .not.toContain("TypeError");
  });

  it("错误页重新选择图片会先恢复上传控件再触发文件选择", async () => {
    const appSource = await readFile(
      new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
      "utf8"
    );
    const replacementFlow = appSource.slice(
      appSource.indexOf("function chooseReplacementImage"),
      appSource.indexOf("async function openProject")
    );
    expect(replacementFlow).toContain('setStage("idle")');
    expect(replacementFlow).toContain('document.getElementById("styleforge-primary-image")?.click()');
    expect(appSource).toContain("onClick={chooseReplacementImage}");
  });

  it("本地创作未连接时按原因给出明确恢复动作", () => {
    expect(connectionGuidance("host-missing")).toMatchObject({
      title: "完成本地连接",
      reason: "VisualForge 使用你已经登录的 Codex 分析和生成图片，不需要 API Key。",
      actionLabel: "重新检查连接"
    });
    expect(connectionGuidance("login-required").solution).toContain("登录");
    expect(connectionGuidance("host-outdated").solution).toContain("更新");
    expect(connectionGuidance("connected")).toBeNull();
  });

  it("正式创作未连接时明确阻止生成，并引导用户连接", () => {
    expect(presentUserError("connection", "CONNECTION_REQUIRED")).toEqual({
      title: "需要连接本地创作",
      reason: "参考图和创作要求已经保留，但尚未开始分析或生成。",
      solution: "前往设置连接本地创作后，即可从这里继续。",
      actionLabel: "连接本地创作"
    });
  });

  it("只有真实连接或显式测试预览允许开始创作", () => {
    expect(canCreateWithRuntime(false, "host-missing")).toBe(false);
    expect(canCreateWithRuntime(false, "error")).toBe(false);
    expect(canCreateWithRuntime(false, "login-required")).toBe(false);
    expect(canCreateWithRuntime(false, "host-outdated")).toBe(false);
    expect(canCreateWithRuntime(false, "connected")).toBe(true);
    expect(canCreateWithRuntime(true, "host-missing")).toBe(true);
  });

  it("捕获后的参考图以普通语言显示来源网站和页面标题", () => {
    expect(presentReferenceSource({
      type: "web",
      sourceUrl: "https://i.pinimg.com/example.jpg",
      pageUrl: "https://www.pinterest.com/pin/1/",
      pageTitle: "雨后田野中的人物"
    })).toEqual({
      site: "pinterest.com",
      title: "雨后田野中的人物"
    });
    expect(presentReferenceSource({ type: "upload" })).toBeNull();
    expect(presentReferenceSource({
      type: "capture",
      pageUrl: "不是网址",
      pageTitle: "当前网页框选"
    })).toEqual({
      site: "网页参考",
      title: "当前网页框选"
    });
  });

  it("定向重试只增加候选，不自动替换用户已选的最终版本", () => {
    expect(appendGeneratedCandidates(
      ["original", "selected-final"],
      ["targeted-retry"],
      false
    )).toEqual(["original", "selected-final", "targeted-retry"]);
    expect(appendGeneratedCandidates(
      ["original", "selected-final"],
      ["normal-regeneration"],
      true
    )).toEqual(["original", "selected-final", "normal-regeneration"]);
  });

  it("套图中的单张作品按真实镜头职责评审，不固定使用第一镜头", () => {
    const first = { id: "plan-1", outputAssetId: "output-1", generationEventId: "event-1" };
    const second = { id: "plan-2", outputAssetId: "output-2", generationEventId: "event-2" };
    expect(findCriticPlanItem(
      [{ id: "set-1", planItems: [first, second] as never }],
      { id: "event-2", setId: "set-1", planItemId: "plan-2" },
      "output-2"
    )?.id).toBe("plan-2");
  });
});
