import {
  DEFAULT_VISUAL_DNA_LOCKS,
  VISUAL_DNA_ANALYSIS_VERSION,
  VISUAL_DNA_SCHEMA_VERSION,
  type VisualDNA
} from "@styleforge/contracts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function analyzeMock(sourceImageHash: string): Promise<VisualDNA> {
  await wait(700);
  const now = Date.now();
  return {
    schemaVersion: VISUAL_DNA_SCHEMA_VERSION,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    sourceImageHash,
    analysisModel: "styleforge-mock",
    analysisVersion: VISUAL_DNA_ANALYSIS_VERSION,
    domain: "photography",
    summary: "克制的编辑摄影语言，以自然留白、柔和侧光和低饱和中性色建立安静而专业的画面。",
    identity: {
      description: "无特定人物身份",
      distinctiveFeatures: [],
      preserve: []
    },
    subject: { description: "单一视觉主体", count: 1, action: null, environment: "简洁、层次清楚的背景" },
    composition: {
      shotType: "中景", subjectPlacement: "主体略偏右",
      negativeSpace: "左侧保留呼吸空间", depth: "前后景轻微分离", aspectRatioHint: "4:3"
    },
    camera: {
      angle: "平视", lens: "标准镜头", focalLength: "50mm",
      distance: "中距离", depthOfField: "浅景深", perspective: "自然透视"
    },
    lighting: {
      source: "大面积柔光源", direction: "右后方侧逆光", quality: "柔和漫射",
      contrast: "低到中等反差", highlightBehavior: "高光圆润", shadowBehavior: "阴影保留细节"
    },
    palette: {
      dominantColors: ["月白", "岩灰", "灰绿色"], saturation: "低饱和",
      temperature: "中性略冷", contrast: "克制的明度对比", accentColors: []
    },
    material: {
      types: ["哑光材质"], finish: "细腻",
      reflectivity: "低", translucency: "不透明"
    },
    texture: {
      medium: "编辑摄影", grain: "轻微细颗粒",
      sharpness: "主体清晰、背景柔和", surfaceDetail: "保留真实纹理，不塑料化"
    },
    mood: {
      keywords: ["安静", "克制", "专业"],
      emotionalTone: "平静", atmosphere: "具有呼吸感"
    },
    style: {
      keywords: ["安静", "克制", "编辑感"],
      medium: "编辑摄影"
    },
    locks: DEFAULT_VISUAL_DNA_LOCKS,
    references: [{ assetId: null, sourceImageHash, role: "style_layout", influence: 1, notes: null }],
    constraints: {
      preserve: ["主体轮廓清楚", "高光不过曝", "背景不抢主体"],
      avoid: ["文字和 Logo", "霓虹光效", "杂乱道具", "过度锐化"]
    },
    invariants: ["主体与留白的比例", "侧逆光方向", "低饱和色彩"],
    variables: ["主体内容", "背景材质", "局部点缀色"],
    generationBrief: "保持平视中景与右侧主体布局，使用右后方大面积柔光和低饱和月白、岩灰、灰绿色，创作干净克制的原创编辑摄影。",
    confidence: 0.82
  };
}
