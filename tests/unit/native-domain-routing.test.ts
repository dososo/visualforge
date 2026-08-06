import { describe, expect, it } from "vitest";
import { resolveDomainRouting } from "../../apps/native-host/src/codex-client";

describe("Native Host 领域路由", () => {
  it("低置信度保留最高候选和第二候选，不强制改成 photography", () => {
    expect(resolveDomainRouting({
      domain: "poster",
      confidence: 0.42,
      observedSignals: ["文字与图形层级同时存在"],
      secondCandidate: { domain: "illustration", confidence: 0.36 }
    })).toEqual({
      domain: "poster",
      routingState: "uncertain",
      secondCandidate: { domain: "illustration", confidence: 0.36 }
    });
  });

  it("高置信度保持 confirmed", () => {
    expect(resolveDomainRouting({
      domain: "product",
      confidence: 0.9,
      observedSignals: ["单一商品与商业布光"],
      secondCandidate: null
    })).toEqual({
      domain: "product",
      routingState: "confirmed",
      secondCandidate: null
    });
  });
});
