import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { openVisualForgeDB } from "../../apps/extension/lib/db";

describe("Subject Asset 数据迁移", () => {
  it("从 v7 升级到当前版本时保留旧项目并新增空资产与拍一套 store", async () => {
    const name = `styleforge-migration-${crypto.randomUUID()}`;
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 7);
      request.onupgradeneeded = () => {
        const projects = request.result.createObjectStore("projects", { keyPath: "id" });
        projects.createIndex("by-updated", "updatedAt");
        projects.createIndex("by-favorite", "favorite");
        projects.put({ id: "legacy-project", title: "旧作品", updatedAt: 20, favorite: 0 });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    legacy.close();

    const migrated = await openVisualForgeDB(name);
    expect(migrated.version).toBe(10);
    expect(migrated.objectStoreNames.contains("subjectAssets")).toBe(true);
    expect(migrated.objectStoreNames.contains("creationSets")).toBe(true);
    expect(await migrated.get("projects", "legacy-project")).toMatchObject({ title: "旧作品" });
    expect(await migrated.getAll("subjectAssets")).toEqual([]);
    expect(await migrated.getAll("creationSets")).toEqual([]);
    migrated.close();
  });
});
