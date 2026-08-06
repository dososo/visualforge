import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, stat, symlink, unlink, utimes, writeFile, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanupExpiredHostFiles } from "../../apps/native-host/src/cleanup";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const files = [
      "temp/new.tmp",
      "temp/linked-user-asset",
      "tasks/new-task/output.png",
      "user-assets/keep.png"
    ];
    for (const file of files) await unlink(path.join(root, file)).catch(() => undefined);
    await rmdir(path.join(root, "temp")).catch(() => undefined);
    await rmdir(path.join(root, "tasks/new-task")).catch(() => undefined);
    await rmdir(path.join(root, "tasks/old-task")).catch(() => undefined);
    await rmdir(path.join(root, "tasks")).catch(() => undefined);
    await rmdir(path.join(root, "user-assets")).catch(() => undefined);
    await rmdir(root).catch(() => undefined);
  }
});

describe("Native Host cleanup", () => {
  it("只删除过期临时文件与过期任务缓存", async () => {
    const supportDir = await mkdtemp(path.join(os.tmpdir(), "styleforge-cleanup-"));
    roots.push(supportDir);
    await Promise.all([
      mkdir(path.join(supportDir, "temp")),
      mkdir(path.join(supportDir, "tasks/old-task"), { recursive: true }),
      mkdir(path.join(supportDir, "tasks/new-task"), { recursive: true }),
      mkdir(path.join(supportDir, "user-assets"))
    ]);
    const oldTemp = path.join(supportDir, "temp/old.tmp");
    const newTemp = path.join(supportDir, "temp/new.tmp");
    const oldTask = path.join(supportDir, "tasks/old-task/output.png");
    const newTask = path.join(supportDir, "tasks/new-task/output.png");
    const userAsset = path.join(supportDir, "user-assets/keep.png");
    await Promise.all([
      writeFile(oldTemp, "old"),
      writeFile(newTemp, "new"),
      writeFile(oldTask, "old"),
      writeFile(newTask, "new"),
      writeFile(userAsset, "keep")
    ]);
    await symlink(userAsset, path.join(supportDir, "temp/linked-user-asset"));
    const now = Date.now();
    const oldTime = new Date(now - 48 * 60 * 60 * 1000);
    await Promise.all([utimes(oldTemp, oldTime, oldTime), utimes(oldTask, oldTime, oldTime)]);

    const result = await cleanupExpiredHostFiles({
      supportDir,
      now,
      maxAgeMs: 24 * 60 * 60 * 1000
    });

    await expect(stat(oldTemp)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(oldTask)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(newTemp, "utf8")).toBe("new");
    expect(await readFile(newTask, "utf8")).toBe("new");
    expect(await readFile(userAsset, "utf8")).toBe("keep");
    expect(await readFile(path.join(supportDir, "temp/linked-user-asset"), "utf8")).toBe("keep");
    expect(result.removedFiles).toBe(2);
  });
});
