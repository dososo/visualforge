import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodexClient } from "../../apps/native-host/src/codex-client";

describe("Codex 真实生成阶段计时", () => {
  it("分别记录技能发现与生成 turn 耗时", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "visualforge-timing-"));
    const skillPath = path.join(outputDir, "SKILL.md");
    const skillContent = "# imagegen\n生成图片。\n";
    await writeFile(skillPath, skillContent);
    const client = new CodexClient("/tmp/codex");
    const controlTimeouts: Array<{ method: string; timeoutMs: number | undefined }> = [];
    client.call = async (method: string, _params: unknown, timeoutMs?: number) => {
      controlTimeouts.push({ method, timeoutMs });
      if (method === "skills/list") {
        return { data: [{ skills: [{ name: "imagegen", enabled: true, path: skillPath }] }] };
      }
      if (method === "thread/start") return { thread: { id: "thread-1" } };
      if (method === "turn/start") return { turn: { id: "turn-1" } };
      throw new Error(`未预期调用：${method}`);
    };
    client.waitForTurn = async () => ({
      status: "completed",
      items: [{ type: "imageGeneration", savedPath: path.join(outputDir, "output.png") }]
    });
    let timings: {
      skillDiscoveryMs: number;
      generationTurnMs: number;
    } | undefined;
    let imagegenSkill: { path: string; sha256: string } | undefined;

    await client.generateImage([], "生成图片", outputDir, 1, (value) => {
      timings = value;
    }, (value) => { imagegenSkill = value; });

    expect(timings).toEqual({
      skillDiscoveryMs: expect.any(Number),
      generationTurnMs: expect.any(Number)
    });
    expect(timings!.skillDiscoveryMs).toBeGreaterThanOrEqual(0);
    expect(timings!.generationTurnMs).toBeGreaterThanOrEqual(0);
    expect(imagegenSkill).toEqual({
      path: await realpath(skillPath),
      sha256: createHash("sha256").update(skillContent).digest("hex")
    });
    expect(controlTimeouts.find((item) => item.method === "thread/start")?.timeoutMs).toBe(60_000);
    expect(controlTimeouts.find((item) => item.method === "turn/start")?.timeoutMs).toBe(60_000);
    await unlink(skillPath);
    await rmdir(outputDir);
  });
});
