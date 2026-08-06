import {
  SIGNATURE_STYLE_LIBRARY_VERSION,
  SIGNATURE_STYLE_SCHEMA_VERSION,
  signatureStyleLibrarySchema,
  signatureStyleSelectionSchema,
  type CreationSetPlanItem,
  type SignatureStyle,
  type SignatureStyleCategory,
  type SignatureStyleEvidenceKey,
  type SignatureStyleLibrary,
  type SignatureStyleSelection,
  type VisualDNA
} from "@styleforge/contracts";

type Domain = SignatureStyle["suitableDomains"][number];

interface StyleSeed {
  id: string;
  name: string;
  category: SignatureStyleCategory;
  signatureTier?: "signature" | "curated";
  code: string;
  summary: string;
  domains: Domain[];
  anchor: string;
  differentiation: string;
  event: string;
  composition: string;
  camera: string;
  lighting: string;
  color: string;
  material: string;
  texture: string;
  subject: string;
  emotion: string;
  narrative: string;
  bestFor: string[];
  preserve: string[];
  recreate: string[];
  avoid: string[];
  positive: string[];
  negative: string[];
  evidenceKeys?: SignatureStyleEvidenceKey[];
  theorySynthesis?: string;
}

function englishName(id: string): string {
  return id
    .split("-")
    .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function fourShotSet(category: SignatureStyleCategory, seed: StyleSeed): SignatureStyle["fourShotSet"] {
  const templates: Record<SignatureStyleCategory, Array<[string, string, string]>> = {
    "人像与时装": [
      ["身份建立", "环境全身或三分之四景", `用${seed.composition}建立人物身份、造型和空间关系`],
      ["性格动作", "中景", `以${seed.subject}呈现有任务的姿态、视线与手势`],
      ["情绪核心", "近景或极近特写", `用${seed.lighting}和真实表情形成情绪高潮`],
      ["记忆画面", "非常规动态景别", `保留${seed.anchor}，打破前三张的机位或秩序`]
    ],
    "商品与品牌": [
      ["Hero 主视觉", "完整商品三分之四景", `以${seed.composition}建立商品地位与第一眼价值`],
      ["生活方式", "环境中景", `把商品放入可信尺度和使用关系，不只替换背景`],
      ["功能证明", "操作或结构近景", `用清楚动作、接口和结果证明一项功能`],
      ["材质记忆", "微距或非常规机位", `以${seed.material}和${seed.anchor}形成不可替代的收尾`]
    ],
    "电影与叙事": [
      ["空间建立", "环境远景或全景", `建立事件发生前的空间、时间与${seed.emotion}`],
      ["动作推进", "中景跟拍", `让${seed.event}发生在可读的中间阶段`],
      ["关系核心", "近景", `通过视线、结构或动作结果揭示主体关系`],
      ["开放收束", "偏轴或遮挡镜头", `保留${seed.anchor}并留下可推断的下一秒`]
    ],
    "当代东方": [
      ["空间气质", "环境全景", `以${seed.composition}建立材料、留白与当代空间`],
      ["主体关系", "中景", `让主体与${seed.material}发生真实遮挡、承托或动作关系`],
      ["材料细节", "近景", `以${seed.lighting}表现材料层次，不依赖传统符号`],
      ["东方记忆", "非常规留白镜头", `只保留${seed.anchor}作为当代东方记忆点`]
    ],
    "艺术与编辑": [
      ["主版式", "完整画面", `用${seed.composition}建立第一阅读顺序`],
      ["层级变化", "中近景或局部版式", "改变内容尺度，同时保持网格、安全区和主轴"],
      ["证据细节", "局部特写", `让${seed.anchor}承担明确的信息职责`],
      ["系统变体", "另一内容比例", "在同一规则下替换内容，证明风格不是单张装饰"]
    ],
    "生活方式与商业内容": [
      ["情境建立", "环境全景", `用${seed.composition}建立主体所属的真实世界`],
      ["主体关系", "中景", `让${seed.subject}与环境、人物或承托物发生关系`],
      ["行动价值", "动作近景", `通过${seed.event}说明主体正在产生什么价值`],
      ["品牌记忆", "非常规细节或留白", `以${seed.anchor}完成可识别的商业收尾`]
    ]
  };
  return templates[category].map(([role, framing, direction], index) => ({
    order: index + 1,
    role,
    framing,
    direction
  }));
}

function criticDimensions(category: SignatureStyleCategory, seed: StyleSeed): string[] {
  const categoryDimensions: Record<SignatureStyleCategory, string[]> = {
    "人像与时装": ["人物身份稳定", "姿态与手势任务", "情绪和视线差异"],
    "商品与品牌": ["商品几何保真", "接口与组件数量", "广告职责和使用因果"],
    "电影与叙事": ["动作前后因果", "场外空间可推断", "镜头间时间推进"],
    "当代东方": ["当代性而非符号拼贴", "材料与留白关系", "传统元素克制度"],
    "艺术与编辑": ["阅读顺序", "信息职责", "缩略尺寸可辨识度"],
    "生活方式与商业内容": ["真实情境", "主体环境关系", "商业记忆点"]
  };
  return [
    `记忆锚点必须可指认：${seed.anchor}`,
    `视觉事件必须真实发生：${seed.event}`,
    ...categoryDimensions[category]
  ];
}

function theoryEvidence(category: SignatureStyleCategory): SignatureStyleEvidenceKey[] {
  const evidence: Record<SignatureStyleCategory, SignatureStyleEvidenceKey[]> = {
    "人像与时装": ["ASC_VISUAL_STORY", "ASC_MOTIVATED_LIGHT", "GESTALT_FIGURE_GROUND"],
    "商品与品牌": ["BAUHAUS_FORM_FUNCTION", "COOPER_TEXTURE_TACTILITY", "ALBERS_COLOR_RELATIVITY"],
    "电影与叙事": ["ASC_VISUAL_STORY", "ASC_MOTIVATED_LIGHT", "GESTALT_FIGURE_GROUND"],
    "当代东方": ["SONG_EMPTY_FULL", "CHINESE_MIND_LANDSCAPE", "CHINESE_REINVENTION"],
    "艺术与编辑": ["AIGA_GRID_HIERARCHY", "GESTALT_FIGURE_GROUND", "BAUHAUS_EXPERIMENT"],
    "生活方式与商业内容": ["BAUHAUS_FORM_FUNCTION", "ASC_VISUAL_STORY", "COOPER_IMAGE_TEXTURE"]
  };
  return evidence[category];
}

function defineStyle(seed: StyleSeed): SignatureStyle {
  return {
    schemaVersion: SIGNATURE_STYLE_SCHEMA_VERSION,
    id: seed.id,
    name: seed.name,
    englishName: englishName(seed.id),
    category: seed.category,
    signatureTier: seed.signatureTier ?? "curated",
    summary: seed.summary,
    valueProposition: `通过“${seed.anchor}”把${seed.bestFor.join("、")}转化为可识别、可复用的视觉价值。`,
    visualPhilosophy: `${seed.differentiation} 方法核心是让“${seed.event}”成为画面事实，而不是只套用色调或滤镜。`,
    unsuitableFor: [...seed.avoid],
    suitableDomains: seed.domains,
    signature: {
      code: seed.code,
      memoryAnchor: seed.anchor,
      differentiation: seed.differentiation
    },
    method: {
      visualEvent: seed.event,
      composition: seed.composition,
      camera: seed.camera,
      lighting: seed.lighting,
      color: seed.color,
      material: seed.material,
      texture: seed.texture,
      subject: seed.subject,
      emotion: seed.emotion,
      narrative: seed.narrative
    },
    production: {
      shotScaleRule: `景别必须服务“${seed.event}”；基础构图为${seed.composition}，同组至少包含环境、关系、细节和记忆四个层次。`,
      cameraAndPerspective: `${seed.camera}；透视必须保持主体身份、商品结构和环境尺度可信，不能为追求风格任意拉伸。`,
      lensLanguage: `${seed.camera}的镜头语言，观看距离随镜头职责变化，禁止整组固定同一机位。`,
      depthOfField: `景深服从“${seed.subject}”：身份或关键结构清楚，环境保留足够因果线索，不能只靠极浅景深制造高级感。`,
      postProcessing: `后期保持${seed.color}与${seed.texture}；允许统一色彩和颗粒，不允许修掉真实材质、皮肤或结构细节。`
    },
    promptTemplates: {
      portrait: `保持同一人物的身份、年龄感、脸型和五官关系，以“${seed.name}（${englishName(seed.id)}）”创作人物画面：${seed.event}；采用${seed.composition}、${seed.camera}、${seed.lighting}，表现${seed.emotion}，避免${seed.negative.join("、")}。`,
      product: `保持同一商品的完整外形、比例、接口、组件数量和真实材质，以“${seed.name}（${englishName(seed.id)}）”创作商品画面：${seed.event}；采用${seed.composition}、${seed.camera}、${seed.lighting}，突出${seed.material}，避免${seed.negative.join("、")}。`
    },
    fourShotSet: fourShotSet(seed.category, seed),
    critic: {
      dedicatedDimensions: criticDimensions(seed.category, seed),
      commonFailures: [...seed.avoid],
      retryStrategy: `只重试被 Critic 点名的单张：锁定${seed.preserve.join("、")}；针对缺失的“${seed.anchor}”或视觉事件，重建${seed.recreate.join("、")}，不得改变其他已通过镜头。`
    },
    theory: {
      evidenceKeys: seed.evidenceKeys ?? theoryEvidence(seed.category),
      synthesis: seed.theorySynthesis
        ?? `以${seed.composition}组织视觉注意，以${seed.event}承担功能或叙事，再用${seed.differentiation}约束表面化模仿。`
    },
    recipe: {
      dominantRule: `主导规则：${seed.composition}`,
      counterRule: `制衡规则：${seed.differentiation}`,
      visualTension: `以${seed.material}的物理证据承载${seed.emotion}，让材料与心理距离形成张力。`,
      sequenceLogic: `系列按“环境建立—关系推进—细节证明—${seed.anchor}收束”推进；${seed.narrative}`
    },
    acceptance: {
      observableSignals: [
        `视觉事件可见：${seed.event}`,
        `记忆锚点可辨：${seed.anchor}`,
        `构图关系成立：${seed.composition}`,
        `光线因果清楚：${seed.lighting}`,
        `材料证据真实：${seed.material}`
      ],
      failureSignals: [...seed.avoid, ...seed.negative]
    },
    application: {
      bestFor: seed.bestFor,
      preserve: seed.preserve,
      recreate: seed.recreate,
      avoid: seed.avoid
    },
    prompt: {
      positive: seed.positive,
      negative: seed.negative
    },
    provenance: {
      origin: "VisualForge 原创方法",
      inspirationPolicy: "clean-room",
      externalAssetDependency: false
    }
  };
}

const styles: SignatureStyle[] = [
  defineStyle({
    id: "mist-gold-refraction", name: "雾金折光", category: "生活方式与商业内容",
    signatureTier: "signature", code: "SF-SO-01",
    summary: "让主体从低对比雾层中被一道窄金边发现，克制而具有贵重感。",
    domains: ["portrait", "product", "photography"], anchor: "雾中唯一的金色轮廓",
    differentiation: "不用满画面金色或奢华道具，价值感只由局部折射和暗部层级建立。",
    event: "主体穿过薄雾，边缘在一个瞬间折出窄金光。",
    composition: "主体偏心，前景雾层遮挡不超过三分之一，金边落在视觉转折处。",
    camera: "中长焦、轻微低机位", lighting: "大面积低照度柔光加一道极窄逆光",
    color: "炭灰、暖米与低面积旧金", material: "雾、玻璃、哑光织物或细腻金属",
    texture: "细颗粒与柔和空气透视", subject: "保持主体结构清楚，只让边缘进入雾层",
    emotion: "安静、珍贵、未完全显露", narrative: "由不可见到被发现，画面停在身份刚刚成立的一刻。",
    bestFor: ["奢品主视觉", "人物封面", "品牌开场"],
    preserve: ["单一金色轮廓事件", "大面积低对比暗部"], recreate: ["雾层形状", "主体位置与环境"],
    avoid: ["通体金色", "廉价光斑", "过度烟雾遮脸"], positive: ["窄幅金色逆光", "低对比雾层", "克制偏心构图"],
    negative: ["满屏金粉", "霓虹渐变", "主体轮廓消失"]
  }),
  defineStyle({
    id: "static-enamel", name: "静电珐琅", category: "生活方式与商业内容",
    signatureTier: "signature", code: "SF-SO-02",
    summary: "用硬质珐琅色面与细小静电轨迹制造既精确又有生命力的视觉张力。",
    domains: ["product", "illustration", "poster"], anchor: "硬色面旁的一束静电细线",
    differentiation: "不是赛博霓虹；亮点来自少量微细电痕与实体釉面之间的尺度反差。",
    event: "稳定实体表面被一束短促静电划过，但结构没有被破坏。",
    composition: "大形体占画面六成以上，静电只沿一个切面或接口运动。",
    camera: "正侧三分之四近摄", lighting: "冷硬轮廓光与受控面光分离",
    color: "深墨底配单一珐琅主色和少量冷白", material: "高密度珐琅、深色金属、绝缘橡胶",
    texture: "光洁硬面与微小电弧颗粒", subject: "结构、接口和边缘必须准确可读",
    emotion: "精密、克制、带一点危险", narrative: "静止产品在能量启动前一瞬被激活。",
    bestFor: ["科技产品", "功能主视觉", "概念海报"],
    preserve: ["实体釉面质感", "单一路径静电事件"], recreate: ["主色与接口位置", "能量运动路径"],
    avoid: ["蓝紫霓虹铺满", "闪电风暴", "塑料质感"], positive: ["珐琅硬色面", "微细静电轨迹", "精密接口"],
    negative: ["电竞光效", "多色激光", "模糊产品结构"]
  }),
  defineStyle({
    id: "porous-theatre", name: "孔隙剧场", category: "生活方式与商业内容",
    signatureTier: "signature", code: "SF-SO-03",
    summary: "把微观孔隙放大成可进入的舞台，让材质内部成为视觉事件发生地。",
    domains: ["product", "illustration", "photography"], anchor: "一处被放大的材质孔洞舞台",
    differentiation: "不是普通微距；必须同时呈现外部物体尺度与内部孔隙空间的转换。",
    event: "主体表面的一处孔隙打开，内部光线揭示第二层空间。",
    composition: "外部完整轮廓与孔隙近景同框，孔隙是唯一第二视觉中心。",
    camera: "微距与中景的复合视角", lighting: "外部柔光、孔隙内部定向亮光",
    color: "矿物中性色配内部单色亮点", material: "陶、石、泡沫、纤维或多孔金属",
    texture: "真实断面、颗粒与尺度参照", subject: "完整主体不能因微观奇观而失真",
    emotion: "好奇、静谧、可探索", narrative: "从日常表面进入隐藏内部，形成一次尺度旅行。",
    bestFor: ["材质广告", "科学叙事", "工艺说明"],
    preserve: ["外部与内部双尺度", "唯一孔隙入口"], recreate: ["内部空间", "尺度参照与光源"],
    avoid: ["无依据洞穴", "黏液质感", "主体只剩抽象纹理"], positive: ["真实材质断面", "双尺度同框", "内部定向光"],
    negative: ["随机孔洞", "生物恐惧密集孔", "失去商品全貌"]
  }),
  defineStyle({
    id: "backlit-specimen", name: "逆光标本", category: "生活方式与商业内容",
    signatureTier: "signature", code: "SF-SO-04",
    summary: "将主体作为正在观察的当代标本，以透光边缘和编号秩序建立可信记忆。",
    domains: ["product", "portrait", "poster"], anchor: "透光轮廓与一处标本编号",
    differentiation: "不模仿复古博物馆；使用当代洁净台面、克制编号和真实透光关系。",
    event: "主体被放到观察台前，逆光第一次揭示其内部结构。",
    composition: "正视或轻俯视，主体居中但以一处偏心编号打破绝对对称。",
    camera: "标准镜头或轻微俯拍", lighting: "均匀背光加低强度正面补光",
    color: "骨白、烟黑、琥珀或叶绿", material: "半透明玻璃、薄片、织物、皮肤边缘",
    texture: "高分辨率细节与轻微扫描颗粒", subject: "形态完整，内部层次必须来源可信",
    emotion: "理性、稀有、被认真观看", narrative: "把熟悉对象重新定义为值得保存和研究的样本。",
    bestFor: ["工艺档案", "产品详情", "实验性肖像"],
    preserve: ["真实透光关系", "当代标本秩序"], recreate: ["编号系统", "承托面和观察环境"],
    avoid: ["医学恐怖", "伪造器官", "满屏标签"], positive: ["透光边缘", "洁净观察台", "克制编号"],
    negative: ["复古羊皮纸", "血腥解剖", "信息过载"]
  }),
  defineStyle({
    id: "material-match-cut", name: "材质跳接", category: "生活方式与商业内容",
    code: "SF-SO-05", summary: "用同一材质边缘跨越原料、制作、使用与结果，让四张图形成一次可读的品牌剪辑。",
    domains: ["product", "portrait", "photography"], anchor: "跨场景保持同一位置的一条材质接缝",
    differentiation: "不是同色拼贴；镜头可跨越时空，但必须由可验证的粗细、软硬、亮哑或弯曲属性完成接棒。",
    event: "前一镜的材质边缘在下一镜同一画面区域转化为另一对象或使用场景。",
    composition: "共享轮廓落在稳定的视觉坐标，主体与地点变化但接缝尺度连续。",
    camera: "镜头距离随叙事变化，以轮廓尺度匹配完成跳接",
    lighting: "每镜服从本地真实光源，匹配边缘的明度保持连续",
    color: "场景色可变化，只保留一个材料本色或反射回声", material: "纤维、木、金属、石、皮革或再生材料",
    texture: "每镜都能辨认同一材料属性", subject: "商品结构或人物身份稳定，变化只发生在场景与材料阶段",
    emotion: "有推进、有工艺感、可信", narrative: "以材料从来源到使用结果的变化压缩品牌时间。",
    bestFor: ["工艺品牌", "可持续材料", "时装与家居故事"],
    preserve: ["共享材质边缘", "主体身份或商品结构"], recreate: ["场景阶段", "镜头距离与使用动作"],
    avoid: ["只靠同色连接", "四张互不相干", "商品形状漂移"], positive: ["材质轮廓接棒", "跨时空连续性", "工艺阶段推进"],
    negative: ["随机拼贴", "统一滤镜冒充连续", "无材料证据"],
    evidenceKeys: ["FILM_MONTAGE_CONTINUITY", "COOPER_TEXTURE_TACTILITY", "ASC_VISUAL_STORY"],
    theorySynthesis: "把蒙太奇的时空压缩与材料可触属性结合：允许地点和景别改变，但由同一物理边缘完成视觉连续。"
  }),
  defineStyle({
    id: "woven-daylight", name: "昼夜织色", category: "生活方式与商业内容",
    code: "SF-SO-06", summary: "锁定同一对象与空间，只让一天中的真实光线逐步改变纤维、涂层和生活情绪。",
    domains: ["product", "portrait", "photography"], anchor: "同一织物表面连续四时的可解释色变",
    differentiation: "不是四张分别换色温；位置、尺度与场景保持不动，色彩变化必须来自光线角度、纤维方向和表面处理。",
    event: "晨、昼、昏、夜的光依次穿过同一细纹表面，显露不同但连续的材料色。",
    composition: "三张固定主体位置与尺度，一张微距证明纤维方向和光学混色。",
    camera: "50—70mm 固定观察位加一张材料微距", lighting: "低角晨光、高位日光、暖侧夕光与单一夜间实际光",
    color: "统一曝光基线下的连续色变，不套独立 LUT", material: "织物、磨砂涂层、珠光、木纹或细密编织",
    texture: "纤维方向、微反射与吸光差异", subject: "商品标签、人物肤色与结构色不能随时段漂移",
    emotion: "生活流动、安定、时间可感", narrative: "同一对象如何从清晨到夜晚改变用途与心理温度。",
    bestFor: ["家纺", "室内", "家具", "时装与生活方式"],
    preserve: ["同一空间与主体尺度", "材料本色与纤维方向"], recreate: ["四时光线", "每时段使用关系"],
    avoid: ["只换白平衡", "同时更换背景", "标签颜色漂移"], positive: ["统一机位时间序列", "材料随光响应", "可解释色变"],
    negative: ["四套滤镜", "无理由虹彩", "场景不连续"],
    evidenceKeys: ["DESIGN_MUSEUM_WOVEN_COLOR", "ALBERS_COLOR_RELATIVITY", "ASC_MOTIVATED_LIGHT"],
    theorySynthesis: "颜色不是固定色号，而是光照时段、纤维结构、相邻色面积与表面反射共同形成的观看结果。"
  }),
  defineStyle({
    id: "lacquer-moon-void", name: "漆月留白", category: "当代东方",
    signatureTier: "signature", code: "SF-CE-01",
    summary: "以深漆面、弧形月隙和大面积留白构成当代东方的静默空间。",
    domains: ["portrait", "product", "poster"], anchor: "深漆面上的一弯空月",
    differentiation: "不使用古建筑、祥云或书法符号，东方感来自漆面深度、弧线与空白比例。",
    event: "深色漆面被一道月形空隙切开，主体停在明暗交界。",
    composition: "七成负空间，弧形切口与主体形成不闭合关系。",
    camera: "正视偏轴、轻长焦", lighting: "侧后方柔硬交界光",
    color: "乌漆、月白与一点朱砂", material: "高深度漆面、哑光纸、细金属",
    texture: "漆面层叠反射与纸纤维", subject: "主体不穿古装、不依赖东方道具",
    emotion: "清寂、端正、含蓄", narrative: "月隙像尚未说完的话，主体停在进入或离开的边界。",
    bestFor: ["东方奢品", "人物封面", "文化品牌"],
    preserve: ["月形空隙", "七成留白与深漆层次"], recreate: ["主体位置", "朱砂点和场景"],
    avoid: ["祥云堆叠", "古风影楼", "金色龙纹"], positive: ["深漆层次", "月形负空间", "一点朱砂"],
    negative: ["传统符号拼贴", "古装写真", "中国风边框"]
  }),
  defineStyle({
    id: "paper-window-light", name: "纸窗游光", category: "当代东方",
    signatureTier: "signature", code: "SF-CE-02",
    summary: "用纸的半透层次和缓慢移动的窗光，让时间而不是符号表达东方气质。",
    domains: ["portrait", "product", "photography"], anchor: "跨过纸层的一格移动日光",
    differentiation: "不复刻格栅窗；以抽象光格、纸张厚度和时间痕迹形成现代空间。",
    event: "一格日光跨过多层半透明纸面，短暂照亮主体。",
    composition: "纸层构成前中后景，主体只占画面三至五成。",
    camera: "35—50mm 环境视角", lighting: "单向自然窗光穿过多层纸",
    color: "暖白、浅灰、茶褐与低饱和肤色", material: "手工纸、薄织物、浅色木或陶",
    texture: "可见纸纤维、折痕和柔和透光", subject: "主体与纸层发生遮挡或穿行关系",
    emotion: "松弛、清晨感、时间缓慢", narrative: "光在移动，主体的动作停在下一秒之前。",
    bestFor: ["生活方式人像", "家居产品", "编辑摄影"],
    preserve: ["多层纸的空间深度", "单向游动日光"], recreate: ["纸层形状", "人物动作或商品承托"],
    avoid: ["日式门窗照搬", "均匀棚拍", "假纸塑料感"], positive: ["半透明纸层", "移动窗光", "环境遮挡"],
    negative: ["传统格栅复制", "平面背景纸", "无时间感"]
  }),
  defineStyle({
    id: "bronze-new-rain", name: "青铜新雨", category: "当代东方",
    signatureTier: "signature", code: "SF-CE-03",
    summary: "把青铜氧化色与雨后湿面结合，形成古老材料在当代城市重新呼吸的感觉。",
    domains: ["product", "portrait", "photography"], anchor: "湿青铜表面的新鲜雨线",
    differentiation: "不复制器物纹样；只使用氧化色、重量感、雨水方向和现代尺度关系。",
    event: "雨水刚停，青铜表面留下仍在移动的细线与冷暖反射。",
    composition: "低机位近中景，湿面作为前景，主体与城市硬边形成重量对照。",
    camera: "低机位 50—85mm", lighting: "阴天漫射光加远处暖反射",
    color: "铜绿、黛黑、湿灰与微量暖橙", material: "氧化金属、湿石、玻璃和深色织物",
    texture: "水膜、细雨线、铜锈颗粒", subject: "保持主体结构，不添加仿古纹样",
    emotion: "沉着、坚韧、雨后更新", narrative: "旧材料经历天气后进入新的城市时刻。",
    bestFor: ["腕表珠宝", "城市人像", "建筑品牌"],
    preserve: ["青铜氧化色与湿面", "冷暖远近反射"], recreate: ["城市环境", "雨线与主体动作"],
    avoid: ["青铜器复制", "伪古董", "脏污过度"], positive: ["湿青铜", "雨后反射", "低机位重量感"],
    negative: ["饕餮纹", "博物馆陈列", "满面锈蚀"]
  }),
  defineStyle({
    id: "mineral-silk-scene", name: "矿物绢景", category: "当代东方",
    signatureTier: "signature", code: "SF-CE-04",
    summary: "以矿物颜料般的克制色层叠加绢的透气感，构成非复古的东方画面。",
    domains: ["portrait", "illustration", "poster"], anchor: "矿物色块之间一层会呼吸的绢",
    differentiation: "不模拟古画笔触，强调色层、透明空气和现代裁切。",
    event: "一层轻绢被气流抬起，露出后方矿物色空间与主体局部。",
    composition: "横向色层被竖向主体切开，边缘保留不对称空白。",
    camera: "平视中景或近景裁切", lighting: "无明显光源的层间柔光",
    color: "石青、赭石、贝白与烟紫", material: "薄绢、矿物哑光表面、皮肤或陶",
    texture: "细密纤维与干燥色层", subject: "主体动作需推动绢层而非静态摆拍",
    emotion: "含蓄、轻盈、内在张力", narrative: "被遮住的部分在气流中短暂显现。",
    bestFor: ["时装人像", "文化海报", "美妆视觉"],
    preserve: ["矿物色层关系", "透气绢层与现代裁切"], recreate: ["色块形状", "气流方向和主体动作"],
    avoid: ["工笔画复制", "仙侠飘带", "假古纸滤镜"], positive: ["矿物哑光色层", "半透明绢", "不对称裁切"],
    negative: ["古画临摹", "古装仙气", "卷轴边框"]
  }),
  defineStyle({
    id: "twilight-coherence", name: "暮色合材", category: "当代东方",
    code: "SF-CE-05", summary: "在接近暮色的低照度里，让纸、绢、漆、木和石趋于整体，同时保留一处可辨材料边缘。",
    domains: ["portrait", "product", "photography"], anchor: "低照度中仍然清楚的一处材料边缘",
    differentiation: "不是压暗曝光或通体褐色；东方气质来自多种材料在暮色中的吸光、透光和微反射差异。",
    event: "一天将尽，主体的一侧轮廓逐渐与空间融合，只剩一处材料边缘保持可辨。",
    composition: "主体轮廓只开放一侧，其余部分与环境形成低对比连续面。",
    camera: "50—85mm 平视或轻低机位", lighting: "暮色环境光加一个极弱暖色实际光源",
    color: "炭灰、黛色、矿物褐与低面积暖光", material: "纸、绢、木、漆与石",
    texture: "暗部中的吸光、透光与细微反射", subject: "身份或商品结构由边缘与比例保持，不靠高亮描边",
    emotion: "沉静、收束、一天将尽", narrative: "主体从显露转向沉静，空间边界可感但不被全部说明。",
    bestFor: ["茶器", "香氛", "工艺品", "克制人物肖像"],
    preserve: ["暗部材料层级", "唯一可辨边缘"], recreate: ["暮色空间", "实际光源与主体位置"],
    avoid: ["黑位堵死", "假烛光", "古装灯笼拼贴"], positive: ["暮色低对比", "材料吸光差异", "弱实际光源"],
    negative: ["通体褐色滤镜", "无来源烟雾", "主体消失"],
    evidenceKeys: ["SMITHSONIAN_TWILIGHT_MATERIAL", "CHINESE_MIND_LANDSCAPE", "ASC_MOTIVATED_LIGHT"],
    theorySynthesis: "把东方观看中的内在空间与暮色条件下的材料融合结合，以暗部层级而非传统符号建立精神关系。"
  }),
  defineStyle({
    id: "borrowed-horizon", name: "借景折入", category: "当代东方",
    code: "SF-CE-06", summary: "用真实近景门槛折入中景主体与远方地平线，让有限画幅获得向外延伸的精神尺度。",
    domains: ["portrait", "product", "photography"], anchor: "主体轮廓与远景边缘的一次精确咬合",
    differentiation: "不是假窗框或山水拼贴；近、中、远三层必须共享时间、天气、尺度和真实遮挡。",
    event: "主体经过近景门槛时，轮廓与远处地平线或建筑边缘短暂对齐。",
    composition: "近景框占四分之一至四成，主体在中景，远景承担唯一精神指向。",
    camera: "70—135mm 轻度空间压缩，从真实门洞、树枝或转角观察",
    lighting: "近景略暗，主体与远景共享同一时间和天气",
    color: "远景低对比，主体提取一个远景回声色", material: "真实门槛、建筑边缘、树枝、石或木",
    texture: "空气透视与自然遮挡边缘", subject: "主体识别区完整，不能被框景切断",
    emotion: "向往、内敛、空间向外打开", narrative: "主体拥有眼前空间，但故事被远景牵引到画框之外。",
    bestFor: ["旅行与酒店", "建筑品牌", "环境人像", "家居"],
    preserve: ["近中远三层因果", "主体与远景咬合点"], recreate: ["框景实体", "远景方向与环境"],
    avoid: ["假窗框", "地标拼贴", "前后景同样锐利"], positive: ["真实借景", "空气透视", "三层空间"],
    negative: ["传统山水道具", "硬蒙版边缘", "无尺度远景"],
    evidenceKeys: ["CHINESE_BORROWED_SCENERY", "CHINESE_MIND_LANDSCAPE", "GESTALT_FIGURE_GROUND"],
    theorySynthesis: "将借景的空间扩展与心象山水的内在指向结合，要求远景既是物理连续，也是主体叙事的精神出口。"
  }),
  defineStyle({
    id: "black-mirror-plinth", name: "黑镜悬台", category: "商品与品牌",
    code: "SF-PA-01", summary: "用黑镜承托、窄缝悬浮和精确边缘光建立高级商品的结构权威。",
    domains: ["product", "photography"], anchor: "离开黑镜一指宽的悬浮商品",
    differentiation: "不是普通黑底棚拍；必须看见可信悬浮距离、接触逻辑和结构边缘。",
    event: "商品在黑镜上方短距离悬停，倒影与本体保持准确对应。",
    composition: "三分之四 Hero 机位，倒影占画面四分之一以内。",
    camera: "70—100mm 三分之四近景", lighting: "双侧窄条光加顶部柔光",
    color: "墨黑、商品本色与单一冷白高光", material: "镜面玻璃、金属、真实商品材质",
    texture: "受控反射与清楚边缘", subject: "所有接口、比例和组件数量锁定",
    emotion: "权威、精密、昂贵", narrative: "商品像被检验中的核心器件，悬浮只服务于结构展示。",
    bestFor: ["消费电子", "腕表", "香水 Hero"],
    preserve: ["商品几何", "可信悬浮与对应倒影"], recreate: ["光带位置", "黑镜尺度与背景"],
    avoid: ["漂浮无阴影", "过曝轮廓", "重复组件"], positive: ["短距离悬浮", "准确倒影", "结构边缘光"],
    negative: ["无限太空", "随机光轨", "商品结构漂移"]
  }),
  defineStyle({
    id: "liquid-crystal-explode", name: "液晶解构", category: "商品与品牌",
    code: "SF-PA-02", summary: "以透明液体和晶体层围绕商品展开，解释材质与成分而不遮挡结构。",
    domains: ["product", "illustration"], anchor: "商品周围一圈分层透明晶片",
    differentiation: "不是水花特效；每一层透明物都有明确材质职责和空间顺序。",
    event: "商品保持完整，液体薄膜与晶片从一个接口向外分层展开。",
    composition: "主体居中，解构层沿单一轴线展开且不遮挡识别特征。",
    camera: "轻俯视标准镜头", lighting: "大面积透射光加局部折射高光",
    color: "透明、冰灰与商品主色", material: "玻璃、液体薄膜、晶体和商品原材质",
    texture: "真实折射、液面厚度与锐利晶面", subject: "商品完整，解构的是环境与成分层",
    emotion: "清澈、科学、轻盈", narrative: "一项看不见的成分或功能被转化为可读的透明层。",
    bestFor: ["护肤品", "饮品", "透明材质产品"],
    preserve: ["商品完整结构", "单轴透明层级"], recreate: ["晶片数量", "液体路径和空间"],
    avoid: ["爆炸碎片", "无重力水花", "遮挡标签"], positive: ["透明分层", "可信液膜", "可读结构"],
    negative: ["玻璃爆炸", "黏液", "随机漂浮颗粒"]
  }),
  defineStyle({
    id: "soft-domain-daily", name: "软域日常", category: "商品与品牌",
    code: "SF-PA-03", summary: "把产品放入有真实使用痕迹的柔软日常空间，用因果动作而非摆拍证明价值。",
    domains: ["product", "photography"], anchor: "刚被使用过的一处柔软凹痕",
    differentiation: "不是米色家居样板间；必须有动作结果、尺度参照和不完美生活痕迹。",
    event: "使用者刚离开或正在操作，产品周围留下可读的动作结果。",
    composition: "环境占六成，产品以真实使用尺度进入中景。",
    camera: "35—50mm 眼平环境视角", lighting: "有方向的自然窗光与真实遮挡影",
    color: "暖中性、生活本色与商品主色", material: "织物、木、纸、皮肤与商品原材质",
    texture: "褶皱、压痕、指纹和轻微使用痕迹", subject: "商品结构清楚，动作不能遮挡关键功能",
    emotion: "亲近、可信、想拥有", narrative: "通过正在发生的使用关系说明产品为何属于这个生活。",
    bestFor: ["家居", "耳机", "美妆生活方式"],
    preserve: ["真实使用因果", "环境尺度与商品结构"], recreate: ["人物局部", "生活痕迹和场景"],
    avoid: ["纯背景替换", "样板间无痕", "无结果手势"], positive: ["真实使用中间帧", "生活压痕", "环境尺度"],
    negative: ["静态陈列", "完美空房", "手部遮挡结构"]
  }),
  defineStyle({
    id: "craft-cross-section", name: "工艺剖面", category: "商品与品牌",
    code: "SF-PA-04", summary: "通过一个可信剖面或开合状态说明工艺，让复杂结构成为直观广告理由。",
    domains: ["product", "photography", "illustration"], anchor: "完整商品旁唯一可解释的剖面",
    differentiation: "不是科幻爆炸图；只展示真实支持的层级、接口和材料关系。",
    event: "一个关键部件打开或剖切，工作路径和结果同时可见。",
    composition: "完整商品与结构局部并列，阅读顺序从整体到接口再到结果。",
    camera: "标准镜头加结构近摄", lighting: "重点光沿接口和材料层级移动",
    color: "商品本色、结构中性色与单一提示色", material: "严格依照主体图可见材料",
    texture: "真实切面、紧固件和接触阴影", subject: "不增加不存在的组件或功能",
    emotion: "可靠、专业、令人信服", narrative: "结构如何工作直接转化为购买理由。",
    bestFor: ["机械产品", "包装结构", "功能详情"],
    preserve: ["组件数量与位置", "整体到局部阅读顺序"], recreate: ["开合状态", "承托面和提示色"],
    avoid: ["幻觉零件", "无因果拆解", "复杂技术文字"], positive: ["可信开合", "材料层级", "接口因果"],
    negative: ["科幻爆炸图", "新增按钮", "漂浮零件"]
  }),
  defineStyle({
    id: "joined-imperfection", name: "合缝月体", category: "商品与品牌",
    signatureTier: "signature", code: "SF-PA-05",
    summary: "用真实合缝、轻微偏轴与烧制色差证明制造过程，让受控偏差成为有机完整的价值。",
    domains: ["product", "photography"], anchor: "只有侧光下才出现的一条真实合缝",
    differentiation: "不是刻意做旧或随机瑕疵；整体轮廓保持稳定，只允许由制造方式解释的接缝、微偏轴和色差。",
    event: "柔侧光跨过两个成形部分的结合处，使合缝与釉色变化短暂显现。",
    composition: "近中心构图，垂直轴允许极小受控偏移，周围保留完整呼吸区。",
    camera: "70—100mm 接近正交的正面或三分之四视角", lighting: "宽幅柔侧光跨过合缝，另一侧保留釉色层次",
    color: "骨白、暖灰、窑变桃色或极少量矿物蓝", material: "瓷、陶、模压纸浆或浇铸材料",
    texture: "真实接缝、釉层与烧制色差", subject: "商品整体几何、开口、标签和比例必须稳定",
    emotion: "温润、可信、手工但不粗糙", narrative: "两个并不完全相同的部分最终形成一个可信整体。",
    bestFor: ["陶瓷", "香水与美妆容器", "家居器物"],
    preserve: ["整体轮廓与结构", "真实制造合缝"], recreate: ["承托面", "侧光位置与色差"],
    avoid: ["刻意做旧", "随机凹凸", "产品结构歪斜"], positive: ["受控偏差", "真实合缝", "柔侧光釉色"],
    negative: ["裂缝式破损", "直接加入月亮", "自动镜像对称"],
    evidenceKeys: ["MET_MOON_JAR_IMPERFECTION", "BAUHAUS_FORM_FUNCTION", "COOPER_TEXTURE_TACTILITY"],
    theorySynthesis: "把月罐的有机合成逻辑转译为商品摄影门禁：制造痕迹必须可解释，偏差只在整体结构稳定时成立。"
  }),
  defineStyle({
    id: "layered-unveiling", name: "层启仪式", category: "商品与品牌",
    signatureTier: "signature", code: "SF-PA-06",
    summary: "让绳、纸、布、盒与内衬按真实动作逐层开启，把四张商品图变成不可交换的发现过程。",
    domains: ["product", "photography"], anchor: "从外层结扣通向核心商品的一条开启路径",
    differentiation: "不是零件爆炸或悬浮包装；每镜只解除一层，前一层必须部分保留以证明动作顺序。",
    event: "使用者依次解结、揭纸、移布并取出商品，核心品牌色只在内层出现。",
    composition: "限定可信桌面尺度，每镜保留前一层痕迹并让开启路径持续可读。",
    camera: "45 度桌面视角、正俯视与手部近景交替", lighting: "稳定柔光，内层比外层高半级明度",
    color: "外层中性克制，内层出现唯一品牌核心色", material: "绳、纸、织物、木盒、金属与商品原材质",
    texture: "摩擦、厚度、折痕和接触阴影", subject: "商品与包装结构锁定，手部只执行单一清楚动作",
    emotion: "期待、珍视、逐步接近", narrative: "封存—解结—揭示—使用构成不可调换的四步。",
    bestFor: ["香水", "珠宝", "茶", "护肤与礼盒"],
    preserve: ["商品与包装结构", "逐层开启顺序"], recreate: ["手部动作", "每层材质与品牌色出现时机"],
    avoid: ["一次打开全部", "漂浮包装", "重复手指"], positive: ["真实开箱顺序", "保留前层证据", "内层品牌色"],
    negative: ["零件爆炸图", "无限嵌套", "伪文字包装"],
    evidenceKeys: ["SMITHSONIAN_UNVEILING_RITUAL", "ASC_VISUAL_STORY", "COOPER_TEXTURE_TACTILITY"],
    theorySynthesis: "把真实茶事包装的动作顺序转译为广告叙事：材料层级、手部因果与品牌揭示必须共同推进。"
  }),
  defineStyle({
    id: "breathing-close-field", name: "呼吸近场", category: "人像与时装",
    code: "SF-PP-01", summary: "用近距离呼吸感、细微皮肤起伏与错开视线形成不表演的亲密肖像。",
    domains: ["portrait", "photography"], anchor: "呼吸带动的一处轻微衣领或发丝",
    differentiation: "不是大光圈糖水特写；身份、呼吸动作和心理距离必须同时可读。",
    event: "人物吸气或呼气的中间一秒带动发丝、衣领或肩部。",
    composition: "面部不完全居中，眼神与手势构成不闭合三角。",
    camera: "75—105mm 眼平近摄", lighting: "大侧窗柔光保留皮肤微反差",
    color: "自然肤色、低饱和衣物与环境暗色", material: "真实皮肤、发丝、织物",
    texture: "皮肤纹理、细发和浅景深过渡", subject: "五官比例与年龄感优先，手不遮脸",
    emotion: "亲密、克制、有心理距离", narrative: "观者进入人物一次真实呼吸，而不是看到摆好的表情。",
    bestFor: ["情绪近景", "人物封面", "身份卡精选"],
    preserve: ["身份与真实皮肤", "呼吸中间帧"], recreate: ["视线对象", "手势与背景线索"],
    avoid: ["磨皮", "僵硬直视", "手挡五官"], positive: ["呼吸中间帧", "真实皮肤", "错开视线"],
    negative: ["塑料皮肤", "证件照正视", "夸张表演"]
  }),
  defineStyle({
    id: "wind-trace-profile", name: "风迹侧写", category: "人像与时装",
    code: "SF-PP-02", summary: "让风成为塑造轮廓和动作方向的摄影角色，人物身份仍清楚稳定。",
    domains: ["portrait", "photography"], anchor: "横穿侧脸的一束可读风迹",
    differentiation: "不是风扇吹发；环境颗粒、衣物受力和身体重心必须共享同一风向。",
    event: "侧身动作刚被一阵风改变，发丝、衣摆和环境同时响应。",
    composition: "人物位于迎风侧，运动方向前方保留负空间。",
    camera: "50—85mm 侧向跟拍", lighting: "逆侧光勾勒风中细节",
    color: "天气本色、低饱和服装与一处环境色", material: "发丝、轻织物、草叶、尘或雨",
    texture: "方向一致的运动模糊与锐利面部", subject: "脸部关键特征清楚，身体重心可信",
    emotion: "自由、坚韧、正在前往", narrative: "风打断原动作并把人物推向下一刻。",
    bestFor: ["户外人像", "时装动态", "故事套图"],
    preserve: ["统一风向", "身份清楚与可信重心"], recreate: ["天气颗粒", "衣物与环境动作"],
    avoid: ["所有元素乱飞", "脸部糊掉", "站桩吹发"], positive: ["统一风向", "侧向跟拍", "动作受力"],
    negative: ["随机飘带", "面部运动模糊", "静态摆拍"]
  }),
  defineStyle({
    id: "night-walk-hard-flash", name: "夜行硬闪", category: "人像与时装",
    code: "SF-PP-03", summary: "以夜间行走的中间帧和近轴硬闪制造直接、偶发而非棚拍的时尚能量。",
    domains: ["portrait", "photography"], anchor: "夜路中被硬闪截停的一步",
    differentiation: "不是 Y2K 滤镜；硬闪必须揭示真实空间、动作和近远亮度断层。",
    event: "人物行走或转身时被一次硬闪截住，背景仍保留夜间方向线索。",
    composition: "近景人物偏轴，路面或门框提供运动方向。",
    camera: "28—40mm 近距离平视", lighting: "近轴硬闪加环境实际光源",
    color: "深夜本色、冷白闪光与少量暖环境灯", material: "皮肤高光、织物、湿地或金属",
    texture: "直接闪光、轻颗粒与真实暗部", subject: "身份稳定，动作不得退化为正面站姿",
    emotion: "果断、偶发、带社交现场感", narrative: "一次被抓住的夜行动作成为人物性格证据。",
    bestFor: ["时装", "音乐人物", "夜景故事"],
    preserve: ["动作中间帧", "硬闪与环境光并存"], recreate: ["夜间路线", "服装与动作"],
    avoid: ["棚拍黑背景", "紫蓝霓虹", "所有张直视"], positive: ["近轴硬闪", "夜行中间帧", "环境方向线"],
    negative: ["Y2K 贴纸", "霓虹泛光", "静态胸像"]
  }),
  defineStyle({
    id: "low-voice-studio", name: "低声棚景", category: "人像与时装",
    code: "SF-PP-04", summary: "保留影棚设备和制作痕迹，以低声量动作构成克制而完整的环境肖像。",
    domains: ["portrait", "photography"], anchor: "人物之外仍可读的一件影棚设备",
    differentiation: "不是无缝背景棚拍；设备、线缆和工作状态必须成为叙事空间。",
    event: "人物在拍摄间隙调整服装、看向工作人员或从台座起身。",
    composition: "环境式全身或三分之四景，器材构成前后景而不抢主体。",
    camera: "35—50mm 眼平环境镜头", lighting: "方向性棚灯与未完全照亮的外围",
    color: "深中性色、肤色与单一背景色域", material: "织物、台座、金属支架、背景纸",
    texture: "真实影棚暗部和设备磨损", subject: "身份、造型和动作任务都清楚",
    emotion: "冷静、自持、幕后真实", narrative: "人物不是被摆放，而是在制作过程中的一个过渡动作。",
    bestFor: ["时装编辑", "演员肖像", "系列识别图"],
    preserve: ["影棚环境关系", "低声量任务动作"], recreate: ["设备位置", "背景色与造型"],
    avoid: ["纯背景证件照", "器材堆满", "动作无任务"], positive: ["环境式棚拍", "制作痕迹", "过渡动作"],
    negative: ["无缝背景孤立人物", "杂乱器材", "站桩"]
  }),
  defineStyle({
    id: "oblique-disclosure", name: "斜轴显影", category: "人像与时装",
    signatureTier: "signature", code: "SF-PP-05",
    summary: "让一条强斜轴同时改变观看位置、建筑秩序与人物行动方向，形成真正由机位驱动的时装画面。",
    domains: ["portrait", "photography"], anchor: "穿过人物与建筑的一条强斜轴",
    differentiation: "不是无理由把画面旋歪；倾斜必须由真实建筑边缘、明暗边界和人物移动共同成立。",
    event: "人物在进入或脱离建筑秩序的一刻经过斜轴转折点。",
    composition: "主轴倾斜约十二至二十五度，人物位于转折点而非中心。",
    camera: "24—35mm 适度广角，高位俯视或低位仰视", lighting: "场景内可解释的硬侧光，让斜轴同时成为明暗边界",
    color: "中性色占四分之三以上，只保留一个小面积信号色", material: "混凝土、玻璃、织物与金属",
    texture: "不同边缘硬度与建筑表面证据", subject: "脸部比例、四肢和身体重心不得被广角拉伸",
    emotion: "独立、突破、正在穿越", narrative: "观看轴本身推动人物进入、穿越或脱离一套空间秩序。",
    bestFor: ["时装大片", "人物封面", "角色视觉"],
    preserve: ["人物身份与完整肢体", "真实建筑斜轴"], recreate: ["机位高度", "行动方向与信号色"],
    avoid: ["无理由歪画面", "脸部变形", "全身贴边裁切"], positive: ["强斜轴", "极端但可信机位", "建筑推动动作"],
    negative: ["鱼眼畸变", "后期旋转冒充构图", "先锋滤镜"],
    evidenceKeys: ["MET_NEW_VISION", "GESTALT_FIGURE_GROUND", "ASC_VISUAL_STORY"],
    theorySynthesis: "把新视觉摄影的非常规观看位置与人物叙事结合：机位不是装饰，而是人物与秩序关系发生变化的原因。"
  }),
  defineStyle({
    id: "gravity-drapery", name: "重力成衣", category: "人像与时装",
    signatureTier: "signature", code: "SF-PP-06",
    summary: "以织物重量、支点和身体反作用力塑造人物，而不是依靠无重力飘带制造戏剧感。",
    domains: ["portrait", "photography"], anchor: "从肩、肘或腰落下的一条连续重量线",
    differentiation: "不是风扇吹发或飞布；每一道主褶都必须能追溯到支点、材料厚度和身体重心。",
    event: "人物改变重心，整件织物沿一个支点重新下坠并牵引姿态。",
    composition: "身体重心与布料下坠方向形成反向平衡，保留一块稳定垂直布面。",
    camera: "50—85mm 中景或三分之四身，机位接近腰线", lighting: "宽幅侧光擦过褶峰与褶谷",
    color: "低饱和主体色配单一深色重量区", material: "丝、羊毛、棉、皮革或复合织物",
    texture: "回弹、折痕、厚度和真实光泽", subject: "手臂与布料边界、身体支点和落地距离清楚",
    emotion: "承担、抵抗、释放", narrative: "人物姿态与衣物重量互相制约，动作的代价可以被看见。",
    bestFor: ["高级时装", "人物全身", "软质商品"],
    preserve: ["人物身份与身体结构", "连续重量线"], recreate: ["织物支点", "重心与背景留白"],
    avoid: ["无重力飞布", "褶皱复制", "手臂与布料融合"], positive: ["可解释垂坠", "褶峰褶谷", "身体反作用力"],
    negative: ["风扇式飘带", "塑料布料", "解剖错误"],
    evidenceKeys: ["MET_DRAPERY_GRAVITY", "ASC_MOTIVATED_LIGHT", "COOPER_TEXTURE_TACTILITY"],
    theorySynthesis: "把服装史中的三维垂坠关系转化为摄影规则：织物形态必须由重量、材料属性、身体轮廓和光线共同解释。"
  }),
  defineStyle({
    id: "unfinished-action", name: "未完动作", category: "电影与叙事",
    code: "SF-NC-01", summary: "让画面停在动作尚未完成的节点，用前因后果的张力替代说明性摆拍。",
    domains: ["portrait", "product", "photography"], anchor: "一个明确但尚未完成的动作",
    differentiation: "不是动态模糊；观者必须能推断动作前一秒和后一秒。",
    event: "手即将触达、门尚未关上、液体刚开始落下或人物正在转身。",
    composition: "动作目标与结果区域同时入画，中间保留可读路径。",
    camera: "按动作采用 35—70mm", lighting: "光线强调动作起点与目标",
    color: "服从场景时间，只保留一个动作提示色", material: "由真实事件决定",
    texture: "锐利关键节点与轻微方向模糊", subject: "动作结构和受力必须可信",
    emotion: "期待、悬停、将要发生", narrative: "用一个未完成动作自动生成前后时态。",
    bestFor: ["人物故事", "产品使用", "套图记忆镜头"],
    preserve: ["动作前后因果", "起点、路径与目标"], recreate: ["具体动作", "空间与角色关系"],
    avoid: ["完成态摆拍", "无目标手势", "全画面运动模糊"], positive: ["动作中间帧", "可推断前后", "明确目标"],
    negative: ["静态手势", "动作已完成", "因果不清"]
  }),
  defineStyle({
    id: "after-door-light", name: "门后余光", category: "电影与叙事",
    code: "SF-NC-02", summary: "利用门、帘或狭窄开口后的余光建立场外人物与未见空间。",
    domains: ["portrait", "product", "photography"], anchor: "门缝后仍亮着的一道余光",
    differentiation: "不是电影感暗调滤镜；开口必须对应真实空间、动机光和场外关系。",
    event: "主体刚穿过开口，门后余光仍指向未被看见的空间。",
    composition: "前景遮挡占两至四成，亮缝引导到主体或动作结果。",
    camera: "35—65mm 门框外观察位", lighting: "开口后的动机光与前景低照度",
    color: "深前景、空间本色和一处暖或冷余光", material: "门框、帘、玻璃或结构边缘",
    texture: "暗部层次与光束空气颗粒", subject: "主体不能被遮挡到失去身份或结构",
    emotion: "秘密、离开、仍有牵引", narrative: "已离开的空间通过余光继续参与当前事件。",
    bestFor: ["人物离场", "品牌故事", "产品空间广告"],
    preserve: ["开口动机光", "可推断的场外空间"], recreate: ["门帘结构", "主体动作与光色"],
    avoid: ["无来源光束", "纯黑压暗", "主体完全遮挡"], positive: ["门缝余光", "前景观察位", "场外空间"],
    negative: ["假电影黑边", "随机烟雾", "无动机逆光"]
  }),
  defineStyle({
    id: "dual-time-reflection", name: "双时空倒影", category: "电影与叙事",
    code: "SF-NC-03", summary: "让本体与倒影处于相邻但不同的动作阶段，在单张画面中形成时间差。",
    domains: ["portrait", "product", "photography"], anchor: "与本体不同步的一处倒影动作",
    differentiation: "不是超现实镜像复制；差异只允许发生在动作阶段、视线或功能状态。",
    event: "本体开始一个动作，倒影显示动作前一秒或后一秒。",
    composition: "本体与倒影权重不相等，以边缘、玻璃或水面建立可信介质。",
    camera: "标准镜头、轻微偏轴", lighting: "同一动机光在两层空间中产生合理衰减",
    color: "本体自然色与倒影轻微温差", material: "玻璃、水面、抛光金属或镜面",
    texture: "真实反射衰减、污迹与视差", subject: "身份或商品结构保持一致，仅动作阶段变化",
    emotion: "记忆、犹疑、时间错位", narrative: "同一主体的两个相邻时刻在反射介质中并置。",
    bestFor: ["人物记忆镜头", "香水故事", "电影海报"],
    preserve: ["反射物理可信", "只改变动作时态"], recreate: ["介质", "动作阶段与空间"],
    avoid: ["两个不同主体", "镜像结构错误", "任意超现实变形"], positive: ["相邻动作时态", "可信倒影视差", "单一身份"],
    negative: ["双胞胎效果", "镜面错误", "随机变形"]
  }),
  defineStyle({
    id: "weather-transition", name: "天气转场", category: "电影与叙事",
    code: "SF-NC-04", summary: "用同一空间内逐步变化的雨、雾、风或阳光完成视觉转场和情绪推进。",
    domains: ["portrait", "product", "photography"], anchor: "画面两端可读的天气变化边界",
    differentiation: "不是左右拼接滤镜；天气变化必须影响材质、动作、光线和空间深度。",
    event: "一股天气边界正在穿过主体所在空间。",
    composition: "天气边界斜向或纵深穿过画面，主体位于变化交界而非居中分割。",
    camera: "35—70mm 环境镜头", lighting: "天气两侧共享同一时间但光质渐变",
    color: "由天气形成连续温湿变化", material: "湿面、雾、发丝、织物或产品表面",
    texture: "水汽、反射和空气透视连续变化", subject: "主体对天气有动作或材质响应",
    emotion: "转折、释放、环境参与", narrative: "天气不是背景，而是推动人物或商品状态变化的事件。",
    bestFor: ["系列收束", "户外产品", "人物情绪转场"],
    preserve: ["天气对主体的真实影响", "连续而非拼贴的变化"], recreate: ["天气类型", "边界方向和动作"],
    avoid: ["左右两张图拼接", "奇观风暴", "主体无响应"], positive: ["天气边界", "材质响应", "连续光质"],
    negative: ["天气贴纸", "灾难奇观", "简单颜色渐变"]
  }),
  defineStyle({
    id: "deep-field-relay", name: "深场接力", category: "电影与叙事",
    signatureTier: "signature", code: "SF-NC-05",
    summary: "让前景行为触发中景回应并在背景产生结果，用同一深场里的三段因果替代浅景深氛围。",
    domains: ["portrait", "product", "photography"], anchor: "从前景传到背景的一条三段式动作链",
    differentiation: "不是全画面同样锐利；前、中、后三层各有职责和权重，且必须由实体、遮挡和共享光向连接。",
    event: "前景动作触发中景回应，再在背景形成可读后果。",
    composition: "前中后三层权重约四比三点五比二点五，动作路径连续但焦点明确。",
    camera: "24—35mm 广角感，保持空间几何可信", lighting: "每层有可解释光源且主光方向一致",
    color: "前景对比最高，背景逐级降低饱和度或明度", material: "门框、玻璃、道路、桌面或真实空间结构",
    texture: "遮挡、尺度与空气透视共同建立纵深", subject: "多个主体或商品关系清楚，不能像绿幕拼贴",
    emotion: "关系推进、发现、因果清楚", narrative: "一个事件沿空间层级传递，观者能同时读到原因、回应与结果。",
    bestFor: ["多人叙事", "生活方式", "商品使用场景"],
    preserve: ["三层空间几何", "动作因果链"], recreate: ["各层主体职责", "光线权重与路径"],
    avoid: ["所有区域同等抢眼", "角色互不相关", "背景绿幕感"], positive: ["三层因果", "深场空间", "前后动作接力"],
    negative: ["全局锐化", "信息平均铺满", "无连接背景"],
    evidenceKeys: ["BFI_DEEP_FOCUS", "ASC_VISUAL_STORY", "VISION_OCCLUSION_DEPTH"],
    theorySynthesis: "把深焦的多层叙事能力与遮挡深度线索结合，让空间层级承担因果，而不是仅把背景拍清楚。"
  }),
  defineStyle({
    id: "exposure-trace", name: "曝光余迹", category: "电影与叙事",
    signatureTier: "signature", code: "SF-NC-06",
    summary: "以一个完全清楚的身份锚点和一条单向运动余迹，把等待、经过或离开压缩进同一帧。",
    domains: ["portrait", "photography"], anchor: "清楚身份锚点旁的一条连续运动余迹",
    differentiation: "不是随机光绘或全画面模糊；静止身份必须准确，轨迹必须拥有起点、路径和终点。",
    event: "主体的一部分被瞬时光锁定，连续运动在单一方向留下时间轨迹。",
    composition: "静止锚点占主要视觉重量，轨迹只沿一个方向穿过并保留终点空间。",
    camera: "35—50mm 固定机位或单轴跟随", lighting: "连续光记录轨迹，较硬瞬时主光锁定脸或关键结构",
    color: "低复杂度背景配单色或双色轨迹", material: "湿地、金属、玻璃、织物或城市实际光",
    texture: "轨迹柔化但身份与肢体边缘准确", subject: "脸部、肢体数量和接触关系不能被重复曝光破坏",
    emotion: "经过、等待、时间被拉长", narrative: "一段时间被压缩为路径，同时保留一个不可动摇的主体身份。",
    bestFor: ["动态时装", "城市交通", "运动与表演"],
    preserve: ["清楚身份锚点", "单向时间路径"], recreate: ["动作起终点", "连续光与环境"],
    avoid: ["重复脸", "幽灵肢体", "随机光绘"], positive: ["单向曝光轨迹", "瞬时身份锁定", "时间压缩"],
    negative: ["全画面模糊", "多方向抖动", "用模糊掩盖解剖错误"],
    evidenceKeys: ["MOMA_EXPOSURE_TIME", "ASC_VISUAL_STORY", "ASC_MOTIVATED_LIGHT"],
    theorySynthesis: "把延时曝光记录运动的能力限定为一条可解释路径，并用瞬时主光保护身份、肢体和叙事起点。"
  }),
  defineStyle({
    id: "sentence-break-grid", name: "断句网格", category: "艺术与编辑",
    code: "SF-GE-01", summary: "把网格当作阅读节奏而不是装饰，让图像、标题和留白像句子一样停顿。",
    domains: ["poster", "illustration"], anchor: "一处故意提前结束的网格行",
    differentiation: "不是瑞士风模板；网格的断裂必须对应信息语义和阅读停顿。",
    event: "一行内容在预期位置前终止，留下承担语义的空格。",
    composition: "基础网格稳定，只允许一个主断点和一个次级回声。",
    camera: "不适用；正视版面", lighting: "平面版式不模拟摄影光效",
    color: "黑白底加单一语义色", material: "纸、墨或清晰数字像素",
    texture: "轻纸感或完全平整二选一", subject: "图像裁切服从阅读顺序",
    emotion: "理性、停顿、明确", narrative: "阅读中的一次断句使关键信息被重新看见。",
    bestFor: ["编辑海报", "作品封面", "信息卡"],
    preserve: ["语义断点", "单一阅读主轴"], recreate: ["列数", "文字图像比例和色彩"],
    avoid: ["随机错位", "多重网格效果", "小字不可读"], positive: ["语义留白", "断句网格", "清楚阅读顺序"],
    negative: ["模板化瑞士风", "装饰性错位", "信息噪音"]
  }),
  defineStyle({
    id: "paper-edge-index", name: "纸边索引", category: "艺术与编辑",
    code: "SF-GE-02", summary: "利用纸张边缘、裁切缺口与索引色建立可触摸的内容导航。",
    domains: ["poster", "illustration", "product"], anchor: "画面边缘露出的一枚索引缺口",
    differentiation: "不是剪贴簿拼贴；所有纸边都对应层级、顺序或可打开的内容。",
    event: "一层纸被抽出，边缘索引暴露下一层信息或商品局部。",
    composition: "层级由边缘进入画面，中心区域保持清楚主内容。",
    camera: "轻俯视或正视", lighting: "极浅接触阴影说明纸层关系",
    color: "纸本色、深墨与少量索引色", material: "未涂布纸、薄卡、半透明描图纸",
    texture: "纸纤维、裁切边与微小压痕", subject: "图像或商品不能被无意义纸片遮挡",
    emotion: "有序、可收藏、可翻阅", narrative: "观者通过一枚边缘线索知道还有下一层内容。",
    bestFor: ["作品档案", "包装视觉", "系列目录"],
    preserve: ["边缘索引有信息职责", "真实纸层接触关系"], recreate: ["索引位置", "层级数量和内容"],
    avoid: ["随意撕纸", "复古贴纸堆叠", "厚重假阴影"], positive: ["纸边索引", "浅接触影", "可翻阅层级"],
    negative: ["剪贴簿装饰", "随机胶带", "无意义遮挡"]
  }),
  defineStyle({
    id: "color-block-footnote", name: "色块注脚", category: "艺术与编辑",
    code: "SF-GE-03", summary: "用小面积色块承担解释、转折或证据职责，让颜色成为内容注脚。",
    domains: ["poster", "illustration", "product"], anchor: "主图旁一块承担解释的窄色块",
    differentiation: "不是孟菲斯装饰；每个色块必须能说清它标记了什么信息关系。",
    event: "一块窄色域与主图中的某个细节建立跨区域对应。",
    composition: "主图占主导，色块位于边缘并通过位置或线性关系指向细节。",
    camera: "不适用或正视产品", lighting: "图像光线独立，色块保持平面",
    color: "中性主画面配一至两个功能色", material: "平面色、纸或商品原材质",
    texture: "色块干净，主图保留真实纹理", subject: "色块不覆盖身份、结构或可读文字",
    emotion: "清楚、活泼、有编辑判断", narrative: "色彩不是气氛滤镜，而是对画面证据的一句注脚。",
    bestFor: ["产品卖点", "编辑卡片", "信息海报"],
    preserve: ["色块的信息职责", "主图与注脚的对应"], recreate: ["功能色", "注脚位置和内容"],
    avoid: ["彩色几何乱铺", "遮挡主体", "无意义高饱和"], positive: ["功能色注脚", "主次清楚", "跨区域对应"],
    negative: ["孟菲斯装饰", "随机色块", "彩虹配色"]
  }),
  defineStyle({
    id: "miniature-archive", name: "微缩档案", category: "艺术与编辑",
    code: "SF-GE-04", summary: "以少量微缩图、编号和尺度一致的留白组织系列，让差异可比较而非堆满。",
    domains: ["poster", "photography", "illustration"], anchor: "一排有统一尺度的微缩证据图",
    differentiation: "不是情绪板；每张微缩图都对应一个可比较维度和明确编号。",
    event: "主图旁展开一组同尺度微缩证据，揭示系列变化或过程。",
    composition: "一张主图加三至五张微缩图，所有缩略图共享安全区与基线。",
    camera: "服从原图；版面正视", lighting: "各图保留来源光线，不统一套滤镜",
    color: "中性档案底色加单一编号色", material: "数字版面或高克重档案纸",
    texture: "清晰缩略图与轻微纸面颗粒", subject: "缩略图必须在小尺寸仍可辨识关键差异",
    emotion: "可信、可比较、具有收藏性", narrative: "主作品之外，微缩证据让创作过程与变化变得可验证。",
    bestFor: ["作品系列", "前后对比", "审计与评审"],
    preserve: ["统一缩略尺度", "每张图的比较职责"], recreate: ["主图选择", "编号与比较维度"],
    avoid: ["图片墙", "尺寸随机", "无标签拼贴"], positive: ["统一微缩图", "比较编号", "主图加证据"],
    negative: ["情绪板堆叠", "随机拼贴", "缩略图不可辨"]
  }),
  defineStyle({
    id: "contact-luminogram", name: "触光负形", category: "艺术与编辑",
    signatureTier: "signature", code: "SF-GE-05",
    summary: "取消普通相机透视，让实体、透明度与光直接形成一枚可辨的光学签名。",
    domains: ["poster", "product", "illustration"], anchor: "不透明实影与半透明密度影的唯一重叠区",
    differentiation: "不是蓝晒滤镜或随机剪影；每个密度级必须对应真实材料透光率和接触距离。",
    event: "不透明与半透明对象贴近感光面，单一曝光留下不同密度的负形痕迹。",
    composition: "平面接触式构图，重叠区是唯一高复杂度区域，其余大面积安静。",
    camera: "近似无透视的正交观看", lighting: "单一背光或接触曝光，由透明度而非柔焦决定层级",
    color: "两至三个密度级和一个材料本色", material: "玻璃、薄膜、纱、叶片、珠宝或金属轮廓",
    texture: "真实接触边缘、感光颗粒与透明密度", subject: "完整商品或关键轮廓可辨，人物只使用局部轮廓",
    emotion: "理性、神秘、像被光记录", narrative: "不展示对象外观，而展示它留在光上的物理签名。",
    bestFor: ["编辑封面", "珠宝", "透明包装", "香氛"],
    preserve: ["真实轮廓与透光差", "唯一重叠区"], recreate: ["接触排列", "密度层级与材料色"],
    avoid: ["随机剪影", "人物脸部负像", "无意义堆物"], positive: ["接触式光影", "透明密度层", "二维光学签名"],
    negative: ["直接套蓝晒", "统一噪点", "普通逆光棚拍"],
    evidenceKeys: ["MOMA_CAMERALESS_LIGHT", "MOMA_EXPOSURE_TIME", "GESTALT_FIGURE_GROUND"],
    theorySynthesis: "将无相机摄影的物—光—感光面关系转译为生成约束，使透明度、接触距离和负形承担全部空间信息。"
  }),
  defineStyle({
    id: "occlusion-parallax", name: "遮层视差", category: "艺术与编辑",
    signatureTier: "signature", code: "SF-GE-06",
    summary: "用最多三层遮挡、轮廓终止和透明度差，让观者主动补全被隐藏的主体与空间。",
    domains: ["poster", "portrait", "product", "photography"], anchor: "三个边缘在同一区域形成清楚的前中后顺序",
    differentiation: "不是纸片硬抠或极浅景深；深度必须由 T 形交接、尺度、透明度和轻微横向视差共同建立。",
    event: "观看位置轻微横移，前景阻隔显露主体识别区并揭示第三层空间。",
    composition: "最多三层，前景遮挡不超过主体四分之一，保留一个完整识别区。",
    camera: "35—70mm 轻微横向偏位", lighting: "各层边缘亮度不同但共享同一环境光逻辑",
    color: "优先以明度差区分前后，色相只做辅助", material: "不透明、半透明与反射材料各承担一层",
    texture: "自然遮挡边缘、反射衰减与接触阴影", subject: "脸、Logo、接口和四肢不能被遮挡切断",
    emotion: "探索、阻隔、逐层发现", narrative: "观者先看到阻隔，再依据轮廓交接主动补全隐藏信息。",
    bestFor: ["人物编辑", "包装", "空间", "海报"],
    preserve: ["主体完整识别区", "三层深度顺序"], recreate: ["各层材料", "视差和遮挡边缘"],
    avoid: ["遮脸遮 Logo", "透明层过多", "剪纸式硬边"], positive: ["T 形交接", "三层视差", "局部显露"],
    negative: ["主体像被切断", "浅景深冒充层次", "无光线一致性"],
    evidenceKeys: ["VISION_OCCLUSION_DEPTH", "GESTALT_FIGURE_GROUND", "JAPANESE_ASYMMETRY"],
    theorySynthesis: "把视觉科学中的遮挡深度线索与不对称构图结合，要求每一层都有明确空间职责，而非装饰叠片。"
  }),
  defineStyle({
    id: "contour-counterproof", name: "轮廓反证", category: "人像与时装",
    signatureTier: "signature", code: "SF-PF-07",
    summary: "让一张清楚轮廓与一张清楚面部互相证明同一身份，避免把人物辨识压缩成一张标准证件照。",
    domains: ["portrait", "photography"], anchor: "同一人物在轮廓证据与面部证据之间的准确互证",
    differentiation: "不是单纯逆光剪影；轮廓、骨架比例、发型和脸部结构必须在不同镜头中形成可核对的身份链。",
    event: "人物从暗面转入侧光，先以完整轮廓建立身体证据，再以近景面部完成身份反证。",
    composition: "一张大留白全身轮廓与一张近景面部形成尺度对位，其余镜头补充手势和步态。",
    camera: "85mm 面部近景与50mm 全身平视组合", lighting: "轮廓镜头用窄侧逆光，面部镜头用同方向大面柔光",
    color: "低彩中性色与单一肤色基线", material: "哑光织物、皮肤、发丝和少量轮廓反光",
    texture: "皮肤与发丝真实，暗部保留层次", subject: "脸型、五官距离、肩颈比例、身高感和发型连续",
    emotion: "坚定、克制、被逐步认出", narrative: "系列先提出‘是谁’，再用轮廓与面部两类证据给出同一个答案。",
    bestFor: ["人物身份套图", "时装型录", "演员肖像"],
    preserve: ["同一人物脸部结构", "轮廓与骨架比例"], recreate: ["轮廓镜头", "面部反证镜头与步态"],
    avoid: ["剪影丢失身份", "不同镜头像不同人物", "轮廓和面部光向冲突"], positive: ["身份互证", "轮廓证据", "面部证据"],
    negative: ["纯黑剪影", "换脸感", "过度磨皮"],
    evidenceKeys: ["MET_FASHION_LINE", "GESTALT_FIGURE_GROUND", "ASC_LIGHT_QUALITY"],
    theorySynthesis: "把服装轮廓的线性阅读、图形—背景分离和可控光质组合成双证据身份系统：一镜证明身体外形，一镜证明面部身份。"
  }),
  defineStyle({
    id: "posture-vector", name: "姿态折线", category: "人像与时装",
    signatureTier: "signature", code: "SF-PF-08",
    summary: "用肩、髋、膝与足形成一条连续受力折线，让姿态成为时装画面的第一视觉语言。",
    domains: ["portrait", "photography", "poster"], anchor: "从肩线贯穿髋部并落到足尖的一条连续受力折线",
    differentiation: "不是夸张摆拍或运动模糊；每个关节转折都要有重量来源，并由服装垂坠继续这条力线。",
    event: "人物把重心从一侧转移到另一侧，服装褶皱沿同一力线完成可见传递。",
    composition: "人物占画面三分之二，身体主折线与背景一条稳定结构线形成张力。",
    camera: "50—70mm 轻低机位，保持肢体比例", lighting: "斜上硬柔混合光勾出关节与布料转折",
    color: "单色服装与低干扰背景", material: "有重量的羊毛、皮革、棉或垂坠丝料",
    texture: "褶皱方向和接触阴影准确", subject: "四肢完整、关节自然、手足有任务",
    emotion: "自持、力量、动作即将继续", narrative: "四张画面记录一条姿态力线从建立、偏移、释放到收束。",
    bestFor: ["时装大片", "人物全身照", "动态型录"],
    preserve: ["人物身份", "完整肢体与真实关节"], recreate: ["受力折线", "服装褶皱与背景结构线"],
    avoid: ["断肢", "无重心姿势", "布料与身体受力不一致"], positive: ["连续姿态向量", "真实重心", "服装力线"],
    negative: ["木偶姿势", "幽灵肢体", "靠模糊掩盖动作"],
    evidenceKeys: ["MET_FASHION_LINE", "ASC_VISUAL_STORY", "GESTALT_FIGURE_GROUND"],
    theorySynthesis: "把服装线条、人体重心与视觉连续性合并为可观察的力学规则，避免以表情或调色替代姿态设计。"
  }),
  defineStyle({
    id: "stress-reveal", name: "应力显形", category: "商品与品牌",
    signatureTier: "signature", code: "SF-PB-07",
    summary: "让商品在受控使用负载中显露结构逻辑，用真实受力证明性能而不是罗列参数。",
    domains: ["product", "photography"], anchor: "从接触点传到承重结构的一条可读应力路径",
    differentiation: "不是爆炸破坏或夸张变形；负载在安全范围内，形变、支撑和恢复都必须符合材料逻辑。",
    event: "工具或人体施加一次明确负载，商品沿结构路径产生微小可见响应并保持完整。",
    composition: "接触点、承力结构和结果端位于同一阅读路径，Hero 镜头仍保留完整商品。",
    camera: "三分之四中近景加接触点微距", lighting: "斜侧硬光显示微形变，柔和填充保护品牌面",
    color: "材料本色与安全提示单色", material: "弹性体、织物、金属连接件、复合材料或缓冲结构",
    texture: "压缩、拉伸、回弹与接缝细节", subject: "商品形状、接口、标签、部件数量和比例不漂移",
    emotion: "可信、耐用、工程自信", narrative: "从施力到承受再到恢复，形成一条可验证的功能证据链。",
    bestFor: ["运动装备", "家具", "工具", "耐用品广告"],
    preserve: ["商品几何", "接口与品牌标识"], recreate: ["负载动作", "应力路径和恢复结果"],
    avoid: ["商品破裂", "夸张液化", "没有接触点的假变形"], positive: ["受控负载", "材料响应", "结构证明"],
    negative: ["爆炸拆解", "橡皮玩具感", "伪科学力线"],
    evidenceKeys: ["BAUHAUS_FORM_FUNCTION", "DESIGN_MUSEUM_MATERIAL_LITERACY", "COOPER_TEXTILE_CONTRAST"],
    theorySynthesis: "以形式服从功能为底线，把材料认知和表面差异转化为可见受力证据；视觉吸引力来自功能被看见，而非装饰特效。"
  }),
  defineStyle({
    id: "contact-gauge", name: "接触计量", category: "商品与品牌",
    signatureTier: "signature", code: "SF-PB-08",
    summary: "只用一个准确接触动作同时证明商品尺度、人体工学和功能入口。",
    domains: ["product", "photography"], anchor: "指尖、手掌或工具与关键接口的唯一精确接触点",
    differentiation: "不是泛化生活方式照；人物只承担计量和功能证明，接触点必须与真实接口、尺度和结果一致。",
    event: "一只手或工具完成一次功能动作，商品立刻给出可见且克制的结果反馈。",
    composition: "商品占主导，接触点位于视觉中心附近，人体其余部分退到次级。",
    camera: "70—100mm 近摄与一张完整尺度中景", lighting: "柔和主光加接口边缘小面积高光",
    color: "品牌中性色与单一状态反馈色", material: "真实皮肤、金属、玻璃、按键、旋钮或织物接触面",
    texture: "指腹压力、接触阴影和表面阻尼可信", subject: "手指数量、关节、接口位置与商品比例准确",
    emotion: "直观、精密、马上会用", narrative: "观者无需说明书，通过一次接触看懂尺寸、入口、动作与结果。",
    bestFor: ["消费电子", "美妆", "工具", "可穿戴设备"],
    preserve: ["商品结构与比例", "唯一功能接口"], recreate: ["人体接触", "动作结果和尺度参照"],
    avoid: ["多只无关手", "错误接口", "手遮挡品牌与结构"], positive: ["单点接触", "人体工学尺度", "功能反馈"],
    negative: ["假按钮", "多余手指", "泛化摆拍"],
    evidenceKeys: ["BAUHAUS_FORM_FUNCTION", "DESIGN_MUSEUM_MATERIAL_LITERACY", "COOPER_TEXTURE_TACTILITY"],
    theorySynthesis: "把功能主义、材料触感与尺度参照合成单点交互语言，使商业画面在一秒内回答‘多大、怎么拿、从哪里用、会发生什么’。"
  }),
  defineStyle({
    id: "offscreen-echo", name: "场外回声", category: "电影与叙事",
    signatureTier: "signature", code: "SF-CN-07",
    summary: "不展示事件本身，只用人物反应、光影变化和环境后果让场外动作变得可推断。",
    domains: ["portrait", "photography"], anchor: "画内反应与场外事件之间的一组方向性证据",
    differentiation: "不是故作神秘的空镜；视线、影子、声源方向暗示和环境扰动必须指向同一个场外原因。",
    event: "未入镜的动作发生，画内主体同时出现视线、姿态和环境三层回应。",
    composition: "主体偏向一侧，为视线或动作方向留下场外空间，环境后果位于相同向量上。",
    camera: "35—50mm 观察机位，避免主观晃动", lighting: "实际光被场外动作短暂遮挡或反射",
    color: "自然环境色与一次短暂光色变化", material: "门帘、玻璃、水面、尘埃或可被事件影响的物体",
    texture: "空气和表面扰动保留真实连续性", subject: "人物身份、视线和身体反应一致",
    emotion: "预感、紧张、好奇", narrative: "四镜头从异常征兆、人物反应、环境后果到开放答案逐步建立场外世界。",
    bestFor: ["悬念人像", "品牌短片关键帧", "剧情摄影"],
    preserve: ["反应方向", "人物身份与空间几何"], recreate: ["场外原因线索", "环境后果与开放收束"],
    avoid: ["线索互相矛盾", "只拍惊讶表情", "用文字解释事件"], positive: ["场外空间", "方向性线索", "环境回声"],
    negative: ["无因果空镜", "跳吓表情", "字幕替代叙事"],
    evidenceKeys: ["MOMA_STAGED_TABLEAU", "ASC_VISUAL_STORY", "ASC_MOTIVATED_LIGHT"],
    theorySynthesis: "把摄影中的情境搭建与电影的画外空间结合，要求反应、动机光和环境后果共同证明一个未直接展示的事件。"
  }),
  defineStyle({
    id: "threshold-continuation", name: "阈限续帧", category: "电影与叙事",
    signatureTier: "signature", code: "SF-CN-08",
    summary: "让同一动作穿过门、窗、幕或画面边缘，在四张独立画面中维持方向和时间连续。",
    domains: ["portrait", "product", "photography"], anchor: "跨越阈限后仍保持同方向的一条动作向量",
    differentiation: "不是重复四张走路照；每个阈限改变空间信息和心理关系，但动作方向、速度阶段与身份不跳变。",
    event: "主体接近、穿过、离开一个空间阈限，并在新空间留下可见后果。",
    composition: "阈限结构占画面一侧或形成框中框，主体跨越时保留足够前后空间。",
    camera: "35—50mm 连续轴线，最多一次有动机的反轴", lighting: "阈限两侧光质不同，但光源方向和曝光过渡可信",
    color: "两个空间各有主色，阈限区域完成连续过渡", material: "门、帘、玻璃、雾、阴影边界或包装开合结构",
    texture: "接触、遮挡和空气变化真实", subject: "人物身份或商品结构在穿越前后保持一致",
    emotion: "决定、离开、进入新阶段", narrative: "阈限将四镜头连成不可倒放的时间序列，而不是四张独立氛围图。",
    bestFor: ["人物叙事", "旅行与空间", "包装开启故事"],
    preserve: ["运动方向", "主体身份与时间顺序"], recreate: ["阈限结构", "两侧空间和动作阶段"],
    avoid: ["方向跳轴", "人物瞬移", "四张场景无后果"], positive: ["空间阈限", "动作连续", "时间不可逆"],
    negative: ["随机换景", "重复步态", "无动机反轴"],
    evidenceKeys: ["FILM_MONTAGE_CONTINUITY", "MOMA_STAGED_TABLEAU", "ASC_VISUAL_STORY"],
    theorySynthesis: "以连续剪辑的方向规则为骨架，用真实阈限改变空间与心理状态，使四镜头拥有明确的前后关系。"
  }),
  defineStyle({
    id: "courtyard-breath-layers", name: "叠院透息", category: "当代东方",
    signatureTier: "signature", code: "SF-CE-07",
    summary: "借多重庭院式平面、空气和侧向天光建立层层可呼吸的空间，不依赖传统符号。",
    domains: ["portrait", "product", "photography"], anchor: "三层错位开口之间的一条可见空气通道",
    differentiation: "不是贴窗格、竹子或中式纹样；东方性来自进深、虚实、借景和人在层间的尺度关系。",
    event: "侧向天光穿过三层错位开口，主体在第二层与远景形成一次短暂对位。",
    composition: "前中后三层开口不完全同心，留白大于主体，远景只借入一小块。",
    camera: "50mm 左右平视，保持建筑垂直线", lighting: "顶部或侧向自然天光逐层衰减",
    color: "石灰白、烟灰、木本色与一处植物色", material: "灰泥、木、薄纱、石和空气",
    texture: "材料吸光、边缘磨损与空气透视", subject: "主体在空间中有清楚尺度，不被装饰吞没",
    emotion: "安定、含蓄、可停留", narrative: "空间不是背景，而通过开合、遮挡和借景引导一次缓慢观看。",
    bestFor: ["东方空间人像", "家居", "茶器与香具"],
    preserve: ["三层进深", "主体与建筑尺度"], recreate: ["错位开口", "空气通道与借景"],
    avoid: ["传统符号堆砌", "窗格贴图", "空洞极简"], positive: ["叠院进深", "借景", "侧向天光"],
    negative: ["古装布景", "禅意标签", "平面中式花纹"],
    evidenceKeys: ["SONG_EMPTY_FULL", "CHINESE_MIND_LANDSCAPE", "MOMA_STAGED_TABLEAU"],
    theorySynthesis: "把空满关系、可游可居的心景和摄影情境搭建转译为三层空间语法，以真实进深而非符号宣称当代东方。"
  }),
  defineStyle({
    id: "mineral-ink-tide", name: "矿墨回潮", category: "当代东方",
    signatureTier: "signature", code: "SF-CE-08",
    summary: "让吸收、沉积与干湿边界成为真实材料事件，用矿物颗粒建立当代东方的时间质感。",
    domains: ["product", "portrait", "poster", "illustration"], anchor: "一条从湿润吸收过渡到矿物沉积的自然潮线",
    differentiation: "不是水墨滤镜；潮线必须由材料吸收、颗粒重量和表面坡度产生，并与主体发生接触关系。",
    event: "液体沿纸、石或织物扩散，矿物颗粒在干湿交界沉积出唯一潮线。",
    composition: "主体位于潮线转折处，湿区、干区和沉积区三者比例不对称。",
    camera: "正视或轻俯视中近景加材料微距", lighting: "低角侧光显示颗粒厚度与湿面反射",
    color: "墨黑、矿青、赭石或石绿中只选一主矿色", material: "宣纸纤维、粗陶、石、绢或吸水织物",
    texture: "毛细扩散、颗粒沉积和干湿反光差", subject: "商品标签、人物肤色和结构保持干净，不被墨迹随机覆盖",
    emotion: "沉静、生长、时间留下痕迹", narrative: "一次真实渗透把不可见的时间变成可触摸的边界。",
    bestFor: ["茶与香", "陶瓷", "编辑视觉", "东方人物局部"],
    preserve: ["主体完整性", "真实材料吸收逻辑"], recreate: ["潮线", "颗粒沉积与干湿区域"],
    avoid: ["水墨滤镜", "随机泼墨遮主体", "多色矿物堆叠"], positive: ["毛细潮线", "矿物沉积", "真实干湿边界"],
    negative: ["仿古卷轴", "数字烟雾", "无材料来源晕染"],
    evidenceKeys: ["NMAA_LACQUER_PANEL", "COOPER_TEXTILE_CONTRAST", "CHINESE_REINVENTION"],
    theorySynthesis: "从东方材料艺术的层积、纺织表面差异和传统再创造中提炼‘渗透—沉积—显时’方法，拒绝水墨表面化。"
  }),
  defineStyle({
    id: "registration-drift", name: "误差套印", category: "艺术与编辑",
    signatureTier: "signature", code: "SF-GE-07",
    summary: "只允许一个方向和一个层级发生受控套印偏差，让误差暴露信息结构而非制造故障感。",
    domains: ["poster", "illustration", "product"], anchor: "主图关键边缘旁一条单轴、定量的套印偏差",
    differentiation: "不是 RGB 故障或全画面重影；主体主轮廓保持准确，偏差只标记次级信息、运动或版本关系。",
    event: "一个次级色版沿单轴偏移少量距离，显露原本被主图覆盖的信息层。",
    composition: "主图、标题和偏移层共享网格，偏移只发生在一个语义区域。",
    camera: "平面版式或正视商品", lighting: "摄影主体保持真实光线，套印层不模拟发光",
    color: "纸白、深墨和一个高识别专色", material: "纸、油墨、网点或可解释的数字印刷层",
    texture: "网点、墨边和轻微压印真实", subject: "脸、Logo 和商品结构的主版不偏移",
    emotion: "机敏、编辑性、带受控不完美", narrative: "误差成为版本差异或信息揭示的证据，而不是装饰噪声。",
    bestFor: ["编辑海报", "包装系列", "时装视觉"],
    preserve: ["主版结构", "网格与可读文字"], recreate: ["单轴偏移层", "被揭示的次级信息"],
    avoid: ["全画面重影", "RGB 赛博故障", "Logo 和脸部错版"], positive: ["受控套印", "单轴偏差", "印刷层级"],
    negative: ["glitch 特效", "多轴抖动", "不可读文字"],
    evidenceKeys: ["AIGA_GRID_HIERARCHY", "MOMA_PHOTOMONTAGE_ASSEMBLY", "COOPER_POSTER_DEPTH"],
    theorySynthesis: "把平面设计的信息组织、蒙太奇层叠和海报制作过程合成为受控误差语法，让偏差拥有语义职责。"
  }),
  defineStyle({
    id: "evidence-index", name: "证物编目", category: "艺术与编辑",
    signatureTier: "signature", code: "SF-GE-08",
    summary: "以主证物、尺度、局部和规则线组成可核验的视觉论证，让版面像一次精确观察。",
    domains: ["poster", "product", "illustration", "photography"], anchor: "主证物旁一条真实尺度基准与一枚对应局部",
    differentiation: "不是情绪板或资料堆砌；每个图像和标记只能承担身份、尺度、结构、材料或结果中的一个职责。",
    event: "主证物被置于统一基准上，局部放大与尺度线揭示一个此前不可见的关键差异。",
    composition: "一件主证物占六成，最多三枚辅助证据沿同一基线排列。",
    camera: "主证物正视或标准三分之四，辅助图保持可比较尺度", lighting: "主辅图采用一致的中性观察光",
    color: "档案中性色与一个分类色", material: "档案纸、金属尺、玻璃片或干净数字界面",
    texture: "高分辨率材料细节与准确标线", subject: "商品、图像或物件不因版式裁切丢失关键结构",
    emotion: "可信、严谨、具有发现感", narrative: "版面通过证据顺序回答‘它是什么、尺寸如何、差异在哪里、为什么重要’。",
    bestFor: ["产品技术广告", "工艺档案", "展览与评审版面"],
    preserve: ["主证物完整", "真实尺度和对应关系"], recreate: ["局部证据", "基线、编号与结论顺序"],
    avoid: ["无职责图片墙", "伪造测量", "信息密度失控"], positive: ["证物主次", "尺度基准", "局部论证"],
    negative: ["情绪板", "装饰编号", "随机技术线"],
    evidenceKeys: ["AIGA_GRID_HIERARCHY", "COOPER_POSTER_DEPTH", "MOMA_PHOTOMONTAGE_ASSEMBLY"],
    theorySynthesis: "把图文层级、海报重叠深度与摄影蒙太奇的证据拼合转化为最小论证系统，每个元素都可说明其职责。"
  }),
  defineStyle({
    id: "residual-use-warmth", name: "使用余温", category: "生活方式与商业内容",
    signatureTier: "signature", code: "SF-SO-07",
    summary: "不直接表演使用过程，而用冷凝、压痕、位移和残留暖光证明商品刚刚被真实使用。",
    domains: ["product", "photography"], anchor: "一处由刚刚使用产生、仍在变化的物理余迹",
    differentiation: "不是随意凌乱或摆拍道具；每个残留必须能反推出一个具体动作、功能和时间距离。",
    event: "使用者刚离开画面，商品周围的冷凝、压痕、开合状态或余热仍在缓慢变化。",
    composition: "商品完整可读，使用余迹靠近功能区域，人物最多保留边缘或影子。",
    camera: "50—85mm 环境中近景加一张余迹微距", lighting: "现场自然光或单一实用灯，余温区域有轻微光质差",
    color: "真实环境本色与局部暖冷差", material: "玻璃冷凝、织物压痕、金属余热、液体水线或打开的包装",
    texture: "水汽、褶皱、指印和接触阴影克制真实", subject: "商品形状、标签、接口和卫生状态准确",
    emotion: "亲近、可信、生活刚发生", narrative: "通过使用后的物理证据，让观者补全刚刚结束的动作并理解功能价值。",
    bestFor: ["家居", "饮品", "美妆", "生活电器"],
    preserve: ["商品结构", "功能区域与真实使用结果"], recreate: ["物理余迹", "刚离场的动作线索"],
    avoid: ["脏乱场景", "无因果水滴", "人物抢走商品"], positive: ["刚使用的余迹", "功能因果", "生活现场"],
    negative: ["静物摆拍", "虚假蒸汽", "随机污渍"],
    evidenceKeys: ["BAUHAUS_FORM_FUNCTION", "COOPER_TEXTURE_TACTILITY", "ASC_VISUAL_STORY"],
    theorySynthesis: "以功能主义约束残留物，用可触材料和叙事因果让‘刚刚发生’成为商业记忆点，而非借道具营造松弛感。"
  }),
  defineStyle({
    id: "dayline-sequence", name: "一日折线", category: "生活方式与商业内容",
    signatureTier: "signature", code: "SF-SO-08",
    summary: "以同一人物或商品的一条日常任务链贯穿晨、昼、昏、夜，让光线变化服务真实使用节奏。",
    domains: ["portrait", "product", "photography"], anchor: "跨四个时段保持连续的一条使用动作链",
    differentiation: "不是同一场景换四种色温；每个时段必须推进一个任务阶段，并保留前一阶段留下的物理结果。",
    event: "主体在一天中完成准备、使用、转场与收束，光线和环境痕迹随任务连续变化。",
    composition: "四镜头共享一个稳定视觉坐标或物件位置，景别随任务从环境到细节推进。",
    camera: "35—70mm 随任务切换，保持人物方向或商品朝向连续", lighting: "晨侧光、昼自然顶光、昏暖侧光和夜间单一实用灯",
    color: "材料与肤色基线稳定，时段变化来自真实光源而非独立 LUT", material: "随使用产生变化的织物、纸、食物、金属、玻璃或皮革",
    texture: "前一时段的折痕、消耗、开合或位置变化在后一时段延续", subject: "身份、商品结构和品牌色跨时段稳定",
    emotion: "熟悉、流动、一天被认真度过", narrative: "四张图是不可交换顺序的任务链，每张都改变下一张的条件。",
    bestFor: ["生活方式品牌", "通勤与旅行", "家居与个人护理"],
    preserve: ["主体身份或商品结构", "跨时段动作方向"], recreate: ["四阶段任务", "真实光线与物理结果"],
    avoid: ["只换白平衡", "四张无任务联系", "前后物件状态复位"], positive: ["日常任务链", "时段光线", "状态连续"],
    negative: ["四色滤镜", "重复摆拍", "时间线跳跃"],
    evidenceKeys: ["ASC_LIGHT_QUALITY", "ASC_VISUAL_STORY", "COOPER_TEXTURE_TACTILITY"],
    theorySynthesis: "把光质变化、动作叙事和材料余迹绑定为不可逆的日常序列；时间由行为证明，而不是由色温标签证明。"
  })
];

export const signatureStyleLibrary: SignatureStyleLibrary = signatureStyleLibrarySchema.parse({
  schemaVersion: SIGNATURE_STYLE_SCHEMA_VERSION,
  title: "VisualForge Signature Style System v4",
  updatedAt: "2026-08-01T18:00:00+08:00",
  styles
});

export function getSignatureStyle(id: string): SignatureStyle | null {
  return signatureStyleLibrary.styles.find((style) => style.id === id) ?? null;
}

export function listSignatureStyles(category?: SignatureStyleCategory): SignatureStyle[] {
  return category
    ? signatureStyleLibrary.styles.filter((style) => style.category === category)
    : [...signatureStyleLibrary.styles];
}

export interface SignatureStyleRecommendation {
  style: SignatureStyle;
  reason: string;
  existingFeatures: string[];
  strengthen: string[];
  avoidAdding: string[];
  evidence: "direct" | "explore";
}

function recommendationDomain(dna: VisualDNA): Domain {
  return dna.domain === "other" ? "photography" : dna.domain;
}

const domainCategoryPriority: Record<Domain, SignatureStyleCategory[]> = {
  portrait: ["人像与时装", "电影与叙事", "当代东方", "生活方式与商业内容", "艺术与编辑", "商品与品牌"],
  product: ["商品与品牌", "生活方式与商业内容", "当代东方", "艺术与编辑", "电影与叙事", "人像与时装"],
  poster: ["艺术与编辑", "当代东方", "生活方式与商业内容", "电影与叙事", "商品与品牌", "人像与时装"],
  illustration: ["艺术与编辑", "生活方式与商业内容", "当代东方", "商品与品牌", "电影与叙事", "人像与时装"],
  photography: ["生活方式与商业内容", "电影与叙事", "当代东方", "人像与时装", "商品与品牌", "艺术与编辑"]
};

export function recommendSignatureStyles(
  dna: VisualDNA,
  limit = 3
): SignatureStyleRecommendation[] {
  const domain = recommendationDomain(dna);
  const evidenceVocabulary = [
    "留白", "居中", "对称", "偏轴", "前景", "中景", "远景", "近景", "特写", "全景",
    "广角", "长焦", "俯拍", "仰拍", "平视", "浅景深", "深景深",
    "侧光", "逆光", "顶光", "硬光", "柔光", "低反差", "高反差",
    "低饱和", "高饱和", "冷色", "暖色", "黑白",
    "金属", "玻璃", "纸", "丝", "织物", "石", "木", "漆", "雾", "颗粒",
    "反射", "透光", "阴影", "静止", "运动", "叙事"
  ];
  const evidenceGroups = [
    {
      label: `构图采用${dna.composition.shotType}、${dna.composition.subjectPlacement}和${dna.composition.negativeSpace}`,
      value: [
        dna.composition.shotType,
        dna.composition.subjectPlacement,
        dna.composition.negativeSpace,
        dna.composition.depth
      ].join(" ")
    },
    {
      label: `机位呈现${dna.camera.angle}、${dna.camera.lens}和${dna.camera.depthOfField}`,
      value: [dna.camera.angle, dna.camera.lens, dna.camera.depthOfField, dna.camera.perspective].join(" ")
    },
    {
      label: `光线为${dna.lighting.direction}、${dna.lighting.quality}和${dna.lighting.contrast}`,
      value: [
        dna.lighting.source,
        dna.lighting.direction,
        dna.lighting.quality,
        dna.lighting.contrast
      ].join(" ")
    },
    {
      label: `色彩呈现${dna.palette.temperature}、${dna.palette.saturation}`,
      value: [...dna.palette.dominantColors, dna.palette.temperature, dna.palette.saturation].join(" ")
    },
    {
      label: `材质包含${dna.material.types.join("、") || dna.material.finish}`,
      value: [...dna.material.types, dna.material.finish, dna.material.reflectivity, dna.material.translucency].join(" ")
    },
    {
      label: `情绪为${dna.mood.emotionalTone}、${dna.mood.atmosphere}`,
      value: [dna.mood.emotionalTone, dna.mood.atmosphere, ...dna.mood.keywords].join(" ")
    }
  ];
  const ranked = signatureStyleLibrary.styles
    .filter((style) => style.suitableDomains.includes(domain))
    .map((style) => {
      const methodTerms = [
        style.method.visualEvent,
        style.method.composition,
        style.method.camera,
        style.method.lighting,
        style.method.color,
        style.method.material,
        style.method.texture,
        style.method.emotion,
        style.method.narrative
      ].join(" ");
      const matchingTerms = evidenceVocabulary.filter((term) =>
        methodTerms.includes(term) && evidenceGroups.some((group) => group.value.includes(term))
      );
      const matchingEvidence = evidenceGroups.filter((group) =>
        matchingTerms.some((term) => group.value.includes(term) && methodTerms.includes(term))
      );
      const conflictTerms = [
        ...style.application.avoid,
        ...style.prompt.negative
      ].filter((term) => [
        dna.subject.description,
        dna.subject.environment,
        dna.mood.atmosphere
      ].filter(Boolean).some((value) => value!.includes(term)));
      return {
        style,
        matchingTerms,
        matchingEvidence,
        score: matchingTerms.length * 3
          + matchingEvidence.length * 2
          - conflictTerms.length * 4
          - domainCategoryPriority[domain].indexOf(style.category) * 0.1
      };
    })
    .sort((left, right) => right.score - left.score || left.style.signature.code.localeCompare(right.style.signature.code));

  const directCandidates = ranked.filter((candidate) => candidate.matchingEvidence.length > 0);
  const candidates = directCandidates.length ? directCandidates : ranked.slice(0, 1);
  const targetCount = Math.max(1, Math.min(limit, 3, candidates.length));
  const diverse = candidates.reduce<typeof ranked>((selected, candidate) => {
    if (selected.length >= targetCount) return selected;
    if (!selected.some((item) => item.style.category === candidate.style.category)) {
      selected.push(candidate);
    }
    return selected;
  }, []);
  if (diverse.length < targetCount) {
    for (const candidate of candidates) {
      if (diverse.length >= targetCount) break;
      if (!diverse.some((item) => item.style.id === candidate.style.id)) diverse.push(candidate);
    }
  }

  return diverse.map(({ style, matchingTerms, matchingEvidence }) => {
    const direct = matchingEvidence.length > 0;
    const visibleRelation = direct
      ? matchingEvidence.map((item) => item.label)
      : [evidenceGroups[0]!.label, evidenceGroups[2]!.label];
    return {
      style,
      reason: direct
        ? `原图可见的${visibleRelation[0]}，与「${style.name}」中的${matchingTerms.slice(0, 2).join("、")}方法有直接关系；建议保留原图主体，只强化${style.signature.memoryAnchor}。`
        : `这是一个可探索方向，而不是相似度判断：原图目前可确认${visibleRelation[0]}；可以尝试「${style.name}」的${style.signature.memoryAnchor}，不覆盖原图主体和色温。`,
      existingFeatures: visibleRelation,
      strengthen: [style.method.composition, style.method.lighting, style.method.narrative],
      avoidAdding: style.application.avoid.slice(0, 3),
      evidence: direct ? "direct" : "explore"
    };
  });
}

export function applySignatureStyleToPrompt(
  basePrompt: string,
  style: SignatureStyle,
  mode: "style" | "blend",
  domain: VisualDNA["domain"]
): string {
  const template = domain === "product"
    ? style.promptTemplates.product
    : domain === "portrait"
      ? style.promptTemplates.portrait
      : `以“${style.name}”组织当前${domain === "poster" ? "版面" : "视觉"}：${style.method.visualEvent}；保持原始主体和信息层级，不添加人物身份要求。`;
  const modeInstruction = mode === "blend"
    ? "混合规则：原图视觉 DNA 为主，风格方法只用于空间、光线与叙事，不覆盖原图已经明确的色温、主体身份和结构。"
    : "采用规则：保留原图主体身份与结构，按该风格的方法重建构图、光线、材质和叙事。";
  return [
    basePrompt.trim(),
    "",
    `VisualForge 主要风格：${style.name}（${style.englishName}）`,
    modeInstruction,
    `执行方法：${style.method.composition}；${style.method.camera}；${style.method.lighting}；${style.method.color}；${style.method.material}；${style.method.narrative}`,
    `对象模板：${template}`,
    `禁止：${style.prompt.negative.join("；")}`
  ].join("\n");
}

export function createSignatureStyleSelection(
  style: SignatureStyle,
  mode: SignatureStyleSelection["mode"],
  recommendationReason: string,
  selectedAt = Date.now()
): SignatureStyleSelection {
  return signatureStyleSelectionSchema.parse({
    schemaVersion: "1.0.0",
    styleId: style.id,
    styleName: style.name,
    signatureCode: style.signature.code,
    libraryVersion: SIGNATURE_STYLE_LIBRARY_VERSION,
    mode,
    recommendationReason,
    selectedAt,
    styleSnapshot: style
  });
}

export function applySignatureStyleToCreationPlan(
  planItems: CreationSetPlanItem[],
  selection: SignatureStyleSelection
): CreationSetPlanItem[] {
  const style = selection.styleSnapshot;
  return planItems.map((item, index) => {
    const shot = style.fourShotSet[index];
    if (!shot) return item;
    return {
      ...item,
      role: `${style.id}-${shot.order}`,
      userFacingTitle: shot.role,
      shotType: shot.framing,
      composition: style.method.composition,
      camera: style.method.camera,
      lightingVariation: style.method.lighting,
      promptDelta: [
        item.promptDelta,
        `VisualForge 风格镜头：${style.name}（${style.signature.code}）`,
        `当前职责：${shot.direction}`,
        `独家配方：${style.recipe.dominantRule}；${style.recipe.counterRule}；${style.recipe.visualTension}`,
        `验收信号：${style.acceptance.observableSignals.join("；")}`
      ].join("\n"),
      lockedDimensions: Array.from(new Set([...item.lockedDimensions, "style" as const])),
      creativePlan: {
        ...item.creativePlan,
        concept: `${style.name}：${style.valueProposition}`,
        narrativeContext: style.recipe.sequenceLogic,
        storyPurpose: shot.direction,
        cameraLanguage: style.method.camera,
        shotScale: shot.framing,
        composition: style.method.composition,
        lighting: style.method.lighting,
        lightDirection: style.method.lighting,
        lightQuality: style.production.lensLanguage,
        colorSystem: style.method.color,
        material: style.method.material,
        atmosphere: style.method.emotion,
        postProcessing: style.production.postProcessing,
        shotResponsibility: `${shot.role}必须呈现：${style.signature.memoryAnchor}`
      }
    };
  });
}

export function buildSignatureStyleCriticContext(selection: SignatureStyleSelection) {
  const style = selection.styleSnapshot;
  return {
    styleId: style.id,
    styleName: style.name,
    signatureCode: style.signature.code,
    dedicatedDimensions: style.critic.dedicatedDimensions,
    observableSignals: style.acceptance.observableSignals,
    failureSignals: style.acceptance.failureSignals,
    retryStrategy: style.critic.retryStrategy
  };
}
