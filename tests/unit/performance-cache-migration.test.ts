import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { openVisualForgeDB } from "../../apps/extension/lib/db";

describe("PerformanceTrace 与分析缓存数据迁移", () => {
  it("从 v9 无损升级并创建两个空 store", async () => {
    const name = `styleforge-performance-migration-${crypto.randomUUID()}`;
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 9);
      request.onupgradeneeded = () => {
        const projects = request.result.createObjectStore("projects", { keyPath: "id" });
        projects.createIndex("by-updated", "updatedAt");
        projects.createIndex("by-favorite", "favorite");
        projects.put({ id: "legacy-project", title: "旧项目", updatedAt: 20, favorite: 0 });
        const settings = request.result.createObjectStore("settings");
        settings.put({ defaultAspectRatio: "3:4" }, "app");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    legacy.close();

    const migrated = await openVisualForgeDB(name);
    expect(migrated.version).toBe(10);
    expect(migrated.objectStoreNames.contains("performanceTraces")).toBe(true);
    expect(migrated.objectStoreNames.contains("analysisCache")).toBe(true);
    expect(await migrated.get("projects", "legacy-project")).toMatchObject({ title: "旧项目" });
    expect(await migrated.get("settings", "app")).toEqual({ defaultAspectRatio: "3:4" });
    expect(await migrated.getAll("performanceTraces")).toEqual([]);
    expect(await migrated.getAll("analysisCache")).toEqual([]);
    migrated.close();
  });

  it("读取旧版不完整设置时补齐当前默认值", async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("styleforge");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("settings", "readwrite");
    transaction.objectStore("settings").put({ defaultAspectRatio: "9:16" }, "app");
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    expect(await (await import("../../apps/extension/lib/db")).getSettings()).toEqual({
      defaultAspectRatio: "9:16",
      defaultCount: 1,
      saveSourceUrl: true,
      hoverCaptureEnabled: true,
      lastRoute: "create"
    });
  });
});
