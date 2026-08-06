import { describe, expect, it } from "vitest";
import {
  creationSetSchema,
  transformationBlueprintSchema
} from "@styleforge/contracts";
import {
  createCreativeDirection,
  createCreationSetPlan,
  createMigrationDomainProfile,
  createTransformationBlueprint,
  overrideDomainProfile
} from "@styleforge/core";
import { dna } from "./contracts.test";

const blueprint = {
  schemaVersion: "1.0.0" as const,
  preserve: ["镜头与光影"],
  replace: ["用户主体"],
  recreate: ["动作与场景"],
  avoid: ["只替换背景"]
};

describe("Transformation Blueprint contract", () => {
  it("严格校验保持、替换、重建和避免四个非空分区", () => {
    expect(transformationBlueprintSchema.parse(blueprint)).toEqual(blueprint);
    expect(() => transformationBlueprintSchema.parse({ ...blueprint, preserve: [] })).toThrow();
    expect(() => transformationBlueprintSchema.parse({ ...blueprint, extra: true })).toThrow();
  });

  it("CreationSet 冻结蓝图，同时兼容没有蓝图的历史记录", () => {
    const legacy = {
      schemaVersion: "1.0.0",
      id: "set-blueprint",
      projectId: "project-blueprint",
      title: "历史组",
      domainProfile: createMigrationDomainProfile(),
      requestedCount: 4,
      userIntent: "",
      sharedVisualDNARevision: dna.revision,
      sharedVisualDNASnapshot: dna,
      sharedReferenceSnapshots: [],
      subjectAssetSnapshots: [],
      sourceGenerationEventId: null,
      sharedInvariants: [],
      allowedVariations: [],
      status: "READY",
      completedCount: 0,
      failedCount: 0,
      createdAt: 1,
      updatedAt: 1,
      qualityReport: null,
      planItems: createCreationSetPlan("photography", 4)
    };
    expect(creationSetSchema.parse(legacy).transformationBlueprintSnapshot).toBeNull();
    expect(creationSetSchema.parse({
      ...legacy,
      transformationBlueprintSnapshot: blueprint
    }).transformationBlueprintSnapshot).toEqual(blueprint);
  });

  it("参考分析产生过多避免项时会去重并收敛到契约上限", () => {
    const visualDNA = {
      ...dna,
      constraints: {
        ...dna.constraints,
        avoid: Array.from({ length: 20 }, (_, index) => `避免项 ${index + 1}`)
      }
    };
    const profile = overrideDomainProfile(createMigrationDomainProfile(), "portrait");
    const direction = createCreativeDirection({
      domain: "portrait",
      visualDNA,
      domainProfile: profile,
      userIntent: "生成女性写真"
    });
    const result = createTransformationBlueprint({
      domain: "portrait",
      visualDNA,
      creativeDirection: direction,
      references: [{ index: 1, role: "style" }, { index: 2, role: "identity" }]
    });
    expect(result.avoid).toHaveLength(12);
    expect(transformationBlueprintSchema.parse(result)).toEqual(result);
  });
});
