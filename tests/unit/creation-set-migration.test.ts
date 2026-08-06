import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { openVisualForgeDB } from "../../apps/extension/lib/db";

describe("CreationSet 数据迁移", () => {
  it("从 v8 升级到 v9 时保留旧项目且不伪造历史组关系", async () => {
    const name = `styleforge-set-migration-${crypto.randomUUID()}`;
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 8);
      request.onupgradeneeded = () => {
        const projects = request.result.createObjectStore("projects", { keyPath: "id" });
        projects.createIndex("by-updated", "updatedAt");
        projects.createIndex("by-favorite", "favorite");
        projects.put({ id: "legacy-project", title: "旧单张作品", updatedAt: 20, favorite: 0 });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    legacy.close();

    const migrated = await openVisualForgeDB(name);
    expect(migrated.version).toBe(10);
    expect(migrated.objectStoreNames.contains("creationSets")).toBe(true);
    expect(await migrated.get("projects", "legacy-project")).toMatchObject({ title: "旧单张作品" });
    expect(await migrated.getAll("creationSets")).toEqual([]);
    migrated.close();
  });
});
