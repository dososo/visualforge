import { describe, expect, it } from "vitest";
import { lstat, mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as cleanup from "../../apps/native-host/src/cleanup";

async function removeFixture(root: string) {
  for (const file of [
    "temp/fresh.tmp",
    "tasks/task-1/output.png",
    "user-assets/portrait.png",
    "host.json",
    "bin/visualforge-native-host"
  ]) {
    await unlink(path.join(root, file)).catch(() => undefined);
  }
  for (const directory of [
    "tasks/task-1",
    "temp",
    "tasks",
    "user-assets",
    "bin",
    ""
  ]) {
    await rmdir(path.join(root, directory)).catch(() => undefined);
  }
}

async function createFixture(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await Promise.all([
    mkdir(path.join(root, "temp")),
    mkdir(path.join(root, "tasks/task-1"), { recursive: true }),
    mkdir(path.join(root, "user-assets")),
    mkdir(path.join(root, "bin"))
  ]);
  await Promise.all([
    writeFile(path.join(root, "temp/fresh.tmp"), "temporary"),
    writeFile(path.join(root, "tasks/task-1/output.png"), "task"),
    writeFile(path.join(root, "user-assets/portrait.png"), "portrait"),
    writeFile(path.join(root, "host.json"), "{}"),
    writeFile(path.join(root, "bin/visualforge-native-host"), "host")
  ]);
  return root;
}

describe("Native Host 主动数据清除", () => {
  it("清除全部临时数据，不删除配置、用户资产或已安装 Host", async () => {
    expect(cleanup.purgeTemporaryData).toBeTypeOf("function");
    if (typeof cleanup.purgeTemporaryData !== "function") return;
    const root = await createFixture("visualforge-purge-temp-");
    try {
      const result = await cleanup.purgeTemporaryData({ supportDir: root });

      await expect(lstat(path.join(root, "temp/fresh.tmp"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lstat(path.join(root, "tasks/task-1/output.png"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(path.join(root, "host.json"), "utf8")).toBe("{}");
      expect(await readFile(path.join(root, "user-assets/portrait.png"), "utf8")).toBe("portrait");
      expect(await readFile(path.join(root, "bin/visualforge-native-host"), "utf8")).toBe("host");
      expect(result).toMatchObject({ scope: "temporary", removedFiles: 2 });
    } finally {
      await removeFixture(root);
    }
  });

  it("清除全部用户数据，但保留已安装 Host 以维持扩展连接", async () => {
    expect(cleanup.purgeAllUserData).toBeTypeOf("function");
    if (typeof cleanup.purgeAllUserData !== "function") return;
    const root = await createFixture("visualforge-purge-all-");
    try {
      const result = await cleanup.purgeAllUserData({ supportDir: root });

      for (const target of ["temp", "tasks", "user-assets", "host.json"]) {
        await expect(lstat(path.join(root, target))).rejects.toMatchObject({ code: "ENOENT" });
      }
      expect(await readFile(path.join(root, "bin/visualforge-native-host"), "utf8")).toBe("host");
      expect(result).toMatchObject({ scope: "all", removedFiles: 4 });
    } finally {
      await removeFixture(root);
    }
  });
});
