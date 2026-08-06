import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderPersonImageIdsByEvidence } from "@styleforge/core";
import { subjectReferenceUsageLabel } from "../../apps/extension/entrypoints/sidepanel/SubjectAssets";
import type { SubjectAsset } from "@styleforge/contracts";

const nativeClient = readFileSync(
  new URL("../../apps/extension/lib/native-client.ts", import.meta.url),
  "utf8"
);
const nativeHost = readFileSync(
  new URL("../../apps/native-host/src/index.ts", import.meta.url),
  "utf8"
);
const codexClient = readFileSync(
  new URL("../../apps/native-host/src/codex-client.ts", import.meta.url),
  "utf8"
);
const app = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
  "utf8"
);
const subjectAssetsUI = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/SubjectAssets.tsx", import.meta.url),
  "utf8"
);
const nativeMessaging = readFileSync(
  new URL("../../packages/contracts/src/native-messaging.ts", import.meta.url),
  "utf8"
);

describe("人物身份保真与分析可靠性链路", () => {
  const check = (status: "pass" | "warning" | "fail" | "unconfirmed", canContinue = true) => ({
    status, message: status, suggestion: null, canContinue
  });

  it("扩展上传、Native 协议和 Host 三段都保留人物职责", () => {
    expect(nativeClient).toContain("imagePurpose: reference.imagePurpose");
    expect(nativeClient).toContain("sourceKind: reference.sourceKind");
    expect(nativeHost).toContain("imagePurpose: reference.imagePurpose");
    expect(nativeHost).toContain("sourceKind: reference.sourceKind");
    expect(nativeMessaging).toContain('"generation-reference-evidence-v1"');
  });

  it("最终 imagegen 指令使用身份保持编辑语义，并禁止平均成新脸", () => {
    expect(codexClient).toContain("Use case: identity-preserve");
    expect(codexClient).toContain("不得把多张脸平均成新脸");
    expect(codexClient).toContain("所有 identity 图片都必须逐张使用");
    expect(codexClient).toContain("待复刻画面模板");
    expect(codexClient).toContain("肩—肘—腕、髋—膝—踝关节链");
  });

  it("AI 人物基准图只供人工核对，不回灌生成或质量判定", () => {
    const snapshots = app.slice(
      app.indexOf("function currentReferenceSnapshots"),
      app.indexOf("async function chooseSubjectAsset")
    );
    expect(snapshots).toContain("AI 基准图只供人工比对");
    expect(snapshots).not.toContain('sourceKind: "identity_board"');
    expect(app).toContain('snapshot.sourceKind !== "identity_board"');
  });

  it("待复刻图片只传一次画面模板职责，不与人物身份参考混名", () => {
    const snapshots = app.slice(
      app.indexOf("function currentReferenceSnapshots"),
      app.indexOf("async function chooseSubjectAsset")
    );
    expect(snapshots).toContain('sourceRole: GenerationReferenceSnapshot["role"] = "style_layout"');
    expect(snapshots).toContain("role: sourceRole");
    expect(snapshots).not.toContain('role: "style", sourceKind: "original", subjectAsset: null');
    expect(snapshots).not.toContain('role: "composition", sourceKind: "original", subjectAsset: null');
    expect(app).toContain('currentReferenceSnapshots(source, selectedSubject, "style_layout")');
    expect(app).not.toContain('currentReferenceSnapshots(source, selectedSubject, "style")');
  });

  it("参考图理解使用单轮联合分析，失败后仅受控重试一次", () => {
    expect(nativeHost).toContain("analyzeDomainImageReliable");
    expect(codexClient).toContain("return await this.analyzeDomainImageJoint");
    expect(codexClient).toContain("return this.analyzeDomainImageJoint");
    expect(codexClient).toContain("DOMAIN_ANALYSIS_TURN_TIMEOUT_MS = 240_000");
  });

  it("主图保持最高优先级，质量建议只排序而不排除用户照片", () => {
    const checks = (frontal: "pass" | "warning", usable = true) => ({
      faceDetected: check("pass"), multiplePeople: check("pass"), resolution: check("pass"),
      underexposed: check("pass"), overexposed: check("pass"), facialOcclusion: check(frontal),
      extremeProfile: check(frontal), frontalInformation: check(frontal, usable)
    });
    const subject = {
      type: "person",
      imageIds: ["weak", "best", "primary", "blocked", "body"],
      primaryImageId: "primary",
      imagePurposes: { weak: "face", best: "face", primary: "face", blocked: "face", body: "full_body" },
      qualityReport: {
        images: [
          { assetId: "weak", checks: checks("warning") },
          { assetId: "best", checks: checks("pass") },
          { assetId: "primary", checks: checks("warning") },
          { assetId: "blocked", checks: checks("pass", false) },
          { assetId: "body", checks: checks("warning") }
        ]
      }
    } as unknown as SubjectAsset;

    expect(orderPersonImageIdsByEvidence(subject)).toEqual([
      "primary", "best", "weak", "body", "blocked"
    ]);
  });

  it("人物卡明确说明全部身份照片都会共同用于生成", () => {
    const subject = {
      type: "person",
      imageIds: ["face-1", "face-2", "face-3", "face-4", "body"],
      imagePurposes: {
        "face-1": "face", "face-2": "face", "face-3": "face", "face-4": "face", body: "full_body"
      }
    } as SubjectAsset;
    expect(subjectReferenceUsageLabel(subject)).toBe("5 张身份照片全部用于生成");
    expect(subjectReferenceUsageLabel({ type: "product", imageIds: ["product-1", "product-2"] } as SubjectAsset))
      .toBe("2 张商品照片全部用于生成");
    expect(subjectAssetsUI).toContain("身份主照片");
    expect(subjectAssetsUI).toContain("设为身份主照片");
  });
});
