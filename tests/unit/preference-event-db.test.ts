import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  createPreferenceEvents,
  createVisualDNARevision,
  reviseVisualDNA
} from "@styleforge/core";
import type { ProjectRecord } from "@styleforge/contracts";
import * as db from "../../apps/extension/lib/db";
import { dna } from "./contracts.test";

describe("Preference Event IndexedDB", () => {
  it("与项目和 DNA revision 在同一保存入口落盘", async () => {
    const list = (db as Record<string, unknown>).listPreferenceEvents;
    expect(list).toBeTypeOf("function");
    if (typeof list !== "function") return;
    const next = reviseVisualDNA(dna, {
      locks: { ...dna.locks, lighting: "locked" }
    }, 4_000);
    const project: ProjectRecord = {
      id: "preference-db-project",
      title: "偏好事实",
      mode: "analyze",
      referenceAssetIds: ["source"],
      outputAssetIds: [],
      userInstruction: "",
      aspectRatio: "4:3",
      count: 1,
      visualDNA: next,
      provider: "mock",
      favorite: false,
      createdAt: 1_000,
      updatedAt: 4_000
    };
    const revision = createVisualDNARevision({
      id: "preference-db-revision",
      projectId: project.id,
      dna: next,
      previousDNA: dna,
      origin: "edit",
      createdAt: 4_000
    });
    const events = createPreferenceEvents({
      actionId: "preference-db-action",
      projectId: project.id,
      before: dna,
      after: next,
      source: "editor",
      createdAt: 4_000
    });

    await db.saveProject(project);
    await db.saveProjectRevision(project, revision, events);
    expect(await list()).toEqual(events);
  });

  it("项目已删除时拒绝旧 Revision 快照，不能把项目复活", async () => {
    const next = reviseVisualDNA(dna, {
      locks: { ...dna.locks, lighting: "locked" }
    }, 5_000);
    const project: ProjectRecord = {
      id: `deleted-revision-project-${crypto.randomUUID()}`,
      title: "已删除项目",
      mode: "analyze",
      referenceAssetIds: ["source"],
      outputAssetIds: [],
      userInstruction: "",
      aspectRatio: "4:3",
      count: 1,
      visualDNA: next,
      provider: "mock",
      favorite: false,
      createdAt: 1_000,
      updatedAt: 5_000
    };
    const revision = createVisualDNARevision({
      id: `deleted-revision-${crypto.randomUUID()}`,
      projectId: project.id,
      dna: next,
      previousDNA: dna,
      origin: "edit",
      createdAt: 5_000
    });

    await expect(db.saveProjectRevision(project, revision)).rejects.toThrow(/已删除|不存在/);
    expect(await db.getProject(project.id)).toBeUndefined();
  });
});
