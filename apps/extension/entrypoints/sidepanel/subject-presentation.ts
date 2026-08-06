import type { SubjectAssetType } from "@styleforge/contracts";

export interface SubjectTypePresentation {
  label: string;
  createTitle: string;
  editTitle: string;
  description: string;
  namePlaceholder: string;
  mediaLabel: string;
  addMediaLabel: string;
  emptyMediaError: string;
  saveFailure: string;
  instructionPlaceholder: string;
}

export const subjectTypeOrder: SubjectAssetType[] = [
  "person",
  "product",
  "character",
  "pet",
  "object"
];

export const subjectTypePresentation: Record<SubjectAssetType, SubjectTypePresentation> = {
  person: {
    label: "人物",
    createTitle: "添加我的人物",
    editTitle: "编辑人物",
    description: "选择能看清面部和外观的照片，保存后可以反复使用",
    namePlaceholder: "例如：小林",
    mediaLabel: "人物照片",
    addMediaLabel: "添加人物照片",
    emptyMediaError: "请至少选择一张人物照片。",
    saveFailure: "这些照片暂时不能创建人物素材。",
    instructionPlaceholder: "例如：保留人物身份，换成自然动作和更松弛的情绪。"
  },
  product: {
    label: "商品",
    createTitle: "添加我的商品",
    editTitle: "编辑商品",
    description: "选择能看清外形、结构和材质的商品照片，保存后可以反复使用",
    namePlaceholder: "例如：无品牌香水",
    mediaLabel: "商品照片",
    addMediaLabel: "添加商品照片",
    emptyMediaError: "请至少选择一张商品照片。",
    saveFailure: "这些照片暂时不能创建商品素材。",
    instructionPlaceholder: "例如：保持商品结构，迁移参考图的灯光、机位和广告氛围。"
  },
  object: {
    label: "物件",
    createTitle: "添加我的物件",
    editTitle: "编辑物件",
    description: "选择能看清外形、结构和材质的物件照片，保存后可以反复使用",
    namePlaceholder: "例如：复古台灯",
    mediaLabel: "物件照片",
    addMediaLabel: "添加物件照片",
    emptyMediaError: "请至少选择一张物件照片。",
    saveFailure: "这些照片暂时不能创建物件素材。",
    instructionPlaceholder: "例如：保持物件外形和材质，换到参考图的场景与光线中。"
  },
  character: {
    label: "角色",
    createTitle: "添加我的角色",
    editTitle: "编辑角色",
    description: "选择能看清角色外观和关键设定的图片，保存后可以反复使用",
    namePlaceholder: "例如：星野",
    mediaLabel: "角色图片",
    addMediaLabel: "添加角色图片",
    emptyMediaError: "请至少选择一张角色图片。",
    saveFailure: "这些图片暂时不能创建角色素材。",
    instructionPlaceholder: "例如：保持角色设定，迁移参考图的构图、光线和情绪。"
  },
  pet: {
    label: "宠物",
    createTitle: "添加我的宠物",
    editTitle: "编辑宠物",
    description: "选择能看清脸部、毛色和体型的宠物照片，保存后可以反复使用",
    namePlaceholder: "例如：豆包",
    mediaLabel: "宠物照片",
    addMediaLabel: "添加宠物照片",
    emptyMediaError: "请至少选择一张宠物照片。",
    saveFailure: "这些照片暂时不能创建宠物素材。",
    instructionPlaceholder: "例如：保持宠物的脸部花纹和体型，换成参考图的场景与动作。"
  }
};

export const subjectTypeLabels = Object.fromEntries(
  subjectTypeOrder.map((type) => [type, subjectTypePresentation[type].label])
) as Record<SubjectAssetType, string>;
