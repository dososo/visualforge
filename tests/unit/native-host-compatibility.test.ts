import { describe, expect, it } from "vitest";
import {
  REQUIRED_NATIVE_HOST_CAPABILITIES,
  REQUIRED_NATIVE_HOST_VERSION,
  assessNativeHostCompatibility
} from "../../apps/extension/lib/native-client";

describe("Native Host 兼容握手", () => {
  it("只有满足最低版本和全部能力时允许真实创作", () => {
    expect(REQUIRED_NATIVE_HOST_VERSION).toBe("0.5.8");
    expect(assessNativeHostCompatibility({
      protocolVersion: 1,
      version: "0.5.8",
      capabilities: [...REQUIRED_NATIVE_HOST_CAPABILITIES]
    })).toEqual({ compatible: true });
  });

  it("旧版或能力缺失时要求更新，而不是继续到运行时失败", () => {
    expect(assessNativeHostCompatibility({
      protocolVersion: 1,
      version: "0.5.0"
    })).toMatchObject({ compatible: false, reason: "version" });
    expect(assessNativeHostCompatibility({
      protocolVersion: 1,
      version: "0.4.9",
      capabilities: [...REQUIRED_NATIVE_HOST_CAPABILITIES]
    })).toMatchObject({ compatible: false, reason: "version" });
    expect(assessNativeHostCompatibility({
      protocolVersion: 1,
      version: "0.5.8",
      capabilities: ["generation-v1"]
    })).toMatchObject({ compatible: false, reason: "capability" });
    expect(REQUIRED_NATIVE_HOST_CAPABILITIES).toContain("generation-style-layout-v1");
    expect(assessNativeHostCompatibility({
      protocolVersion: 1,
      version: "0.5.8",
      capabilities: [
        "generation-v1",
        "generation-reference-evidence-v1",
        "grid-analysis-v1",
        "quality-check-v1",
        "self-uninstall-v1"
      ]
    })).toMatchObject({ compatible: false, reason: "capability" });
  });
});
