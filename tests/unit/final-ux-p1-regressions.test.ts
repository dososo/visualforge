import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
  "utf8"
);
const subjectSource = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/SubjectAssets.tsx", import.meta.url),
  "utf8"
);
const setViewSource = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/CreationSetView.tsx", import.meta.url),
  "utf8"
);
const styleBreakdownSource = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/StyleBreakdown.tsx", import.meta.url),
  "utf8"
);
const hoverSource = readFileSync(
  new URL("../../apps/extension/entrypoints/hover.content.ts", import.meta.url),
  "utf8"
);
const cssSource = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/style.css", import.meta.url),
  "utf8"
);

describe("最终 UX P1 回归", () => {
  it("继续创作只选择未完成任务，不把已完成作品伪装成待继续", async () => {
    const module = await import(
      "../../apps/extension/entrypoints/sidepanel/experience"
    );
    const selectMostRecentCreationTarget = (module as unknown as {
      selectMostRecentCreationTarget?: (
        projects: Array<{ id: string; updatedAt: number; outputAssetIds?: string[] }>,
        creationSets: Array<{ id: string; updatedAt: number; status?: string }>
      ) => { kind: "project" | "set"; id: string } | null;
    }).selectMostRecentCreationTarget;

    expect(selectMostRecentCreationTarget).toBeTypeOf("function");
    expect(selectMostRecentCreationTarget!(
      [{ id: "project-old", updatedAt: 100, outputAssetIds: [] }],
      [{ id: "set-new", updatedAt: 200, status: "GENERATING" }]
    )).toEqual({ kind: "set", id: "set-new" });
    expect(selectMostRecentCreationTarget!(
      [{ id: "project-new", updatedAt: 300, outputAssetIds: [] }],
      [{ id: "set-old", updatedAt: 200, status: "PLANNING" }]
    )).toEqual({ kind: "project", id: "project-new" });
    expect(selectMostRecentCreationTarget!(
      [{ id: "project-done", updatedAt: 500, outputAssetIds: ["output-1"] }],
      [{ id: "set-done", updatedAt: 600, status: "COMPLETED" }]
    )).toBeNull();
    expect(selectMostRecentCreationTarget!(
      [
        { id: "project-done", updatedAt: 500, outputAssetIds: ["output-1"] },
        { id: "project-todo", updatedAt: 300, outputAssetIds: [] }
      ],
      [{ id: "set-done", updatedAt: 600, status: "COMPLETED" }]
    )).toEqual({ kind: "project", id: "project-todo" });
    expect(appSource).toContain('recentCreationTarget.kind === "set"');
    expect(appSource).toContain("openCreationSet(recentCreationTarget.id, false)");
    expect(appSource).toContain('aria-label="继续未完成创作"');
    expect(appSource).not.toContain('aria-label="继续上次创作"');
  });

  it("单张生成公开候选数量，完成后不会暗中追加修复版", () => {
    expect(appSource).toContain("生成几个版本？");
    expect(appSource).toContain("默认生成 1 张");
    expect(appSource).toContain("生成 1 张作品");
    expect(appSource).toContain("生成 ${candidateCount} 个候选版本");
    expect(appSource).not.toContain("autoRetryAttempt");
    expect(appSource).not.toContain("automaticRetry");
    expect(appSource).toContain("是否生成修复版由你决定");
    expect(appSource).toContain("returnedBlobs.slice(0, parameters.count)");
    expect(appSource).toContain("{!subjectReminderOpen && <button");
  });

  it("单张结果页同一时刻只有一个主操作", () => {
    const resultStart = appSource.indexOf('function ResultView');
    const resultEnd = appSource.indexOf('function ProjectCard', resultStart);
    const result = appSource.slice(resultStart, resultEnd);
    expect(result).not.toContain('className="primary" onClick={() => onEdit');
    expect(result).not.toContain('className={criticCompleted ? undefined : "primary"}');
    expect(result).toContain('className="primary" onClick={() => {');
    expect(result).toContain('className={finalAsset ? "primary" : undefined}');
  });

  it("参考图确认页把低频分析与换方向收进同一个调整入口", () => {
    expect(styleBreakdownSource).toContain('className="style-more-adjustments"');
    expect(styleBreakdownSource).toContain("<summary>更多调整</summary>");
    expect(styleBreakdownSource.indexOf("<summary>更多调整</summary>"))
      .toBeLessThan(styleBreakdownSource.indexOf("查看保留、替换与分析细节"));
    expect(styleBreakdownSource.indexOf("<summary>更多调整</summary>"))
      .toBeLessThan(styleBreakdownSource.indexOf("换个方向"));
  });

  it("新建创作恢复单图默认值，不继承上一轮套图规格", () => {
    const startNew = appSource.slice(
      appSource.indexOf("function startNew()"),
      appSource.indexOf("function openCreateHome()")
    );
    expect(startNew).toContain('setMode("direct")');
    expect(startNew).toContain("setRatio(settingsValue.defaultAspectRatio)");
    expect(startNew).toContain("setCount(settingsValue.defaultCount)");
    expect(startNew).toContain('setCreationForm("single")');
    expect(startNew).toContain("setRequestedSetCount(4)");
    expect(startNew).toContain('setDeliveryMode("both")');
    expect(startNew).toContain("setSubjectReminderOpen(false)");
    expect(startNew).toContain('setAutoSelectedSubjectName("")');
  });

  it("完成或失败详情中点击创作会回到真正的新建首页", () => {
    const openCreateHome = appSource.slice(
      appSource.indexOf("function openCreateHome()"),
      appSource.indexOf("function returnToCurrentTask()")
    );
    expect(openCreateHome).toContain('["complete", "error"].includes(stage)');
    expect(openCreateHome).toContain("|| activeCreationSet");
    expect(openCreateHome).toContain("startNew()");
    const backgroundCompletion = appSource.slice(
      appSource.indexOf("if (revealResult)"),
      appSource.indexOf("await refreshProjects()", appSource.indexOf("if (revealResult)"))
    );
    expect(backgroundCompletion).toContain('setStage("complete")');
    expect(backgroundCompletion).toContain("persistTaskNotification");
  });

  it("人物照片检查只作参考，一次点击即保存且检查失败不阻断", () => {
    const saveSubject = appSource.slice(
      appSource.indexOf("async function saveSubjectDraft"),
      appSource.indexOf("async function generateIdentityBoard")
    );
    expect(saveSubject).not.toContain('if (report.overall === "blocked")');
    expect(saveSubject).not.toContain('if (report.overall === "warning")');
    expect(saveSubject).toContain("const report = draft.type === \"person\"");
    expect(saveSubject).toContain('setToast(!report || report.overall === "pass"');
    expect(saveSubject.indexOf("await saveSubjectAsset"))
      .toBeLessThan(saveSubject.indexOf("void checkSubjectQualityNative"));
    expect(saveSubject).toContain(".catch(() => undefined)");
    expect(subjectSource).not.toContain("acceptQualityWarnings?: boolean");
    expect(subjectSource).not.toContain("仍要保存");
    expect(subjectSource).not.toContain("返回调整照片");
    expect(subjectSource).toContain("照片参考建议");
    expect(subjectSource).toContain("仅供参考");
    expect(subjectSource).toContain('open={report.overall !== "pass"}');
  });

  it("设置是辅助页面，不保留一个无选中项且不可聚焦的 tablist", () => {
    const header = appSource.slice(
      appSource.indexOf("<header>"),
      appSource.indexOf("</header>") + "</header>".length
    );
    expect(header).toContain('route !== "settings"');
    expect(header).toContain('role="tablist"');
  });

  it("分析确认和宫格准备后把焦点移到换成我的步骤", () => {
    expect(appSource).toContain("function focusSubjectStep()");
    const focusHelper = appSource.slice(
      appSource.indexOf("function focusSubjectStep()"),
      appSource.indexOf("async function enableCurrentSiteCapture")
    );
    expect(focusHelper).toContain('document.getElementById("subject-step-title")');
    expect(focusHelper).toContain("target?.focus()");
    expect(focusHelper).toContain("target?.scrollIntoView");
    expect(appSource).toContain('<span id="subject-step-title" tabIndex={-1}>');
    expect(appSource.match(/focusSubjectStep\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("零结果的失败、取消和中断状态不再伪装成仍在准备第一张", async () => {
    const module = await import(
      "../../apps/extension/entrypoints/sidepanel/CreationSetView"
    );
    const getEmptyResultPresentation = (module as unknown as {
      getCreationSetEmptyResultPresentation?: (
        status: "GENERATING" | "FAILED" | "CANCELLED" | "INTERRUPTED"
      ) => { title: string; detail: string; busy: boolean };
    }).getCreationSetEmptyResultPresentation;

    expect(getEmptyResultPresentation).toBeTypeOf("function");
    expect(getEmptyResultPresentation!("GENERATING")).toMatchObject({
      title: "正在准备第一张",
      busy: true
    });
    expect(getEmptyResultPresentation!("FAILED")).toMatchObject({
      title: "这一组尚无可用结果",
      busy: false
    });
    expect(getEmptyResultPresentation!("CANCELLED").title).toContain("已停止");
    expect(getEmptyResultPresentation!("INTERRUPTED").title).toContain("已中断");
    expect(setViewSource).toContain("status={creationSet.status}");
  });

  it("整组一致性检查位于结果主区，同时仍允许警告后人工选择", () => {
    const guidanceIndex = setViewSource.indexOf('className="set-quality-guidance"');
    const exportIndex = setViewSource.indexOf('className="set-export-requirement"');
    const moreActionsStart = setViewSource.indexOf('className="set-more-actions"');
    const moreActions = setViewSource.slice(
      moreActionsStart,
      setViewSource.indexOf("</details>", moreActionsStart)
    );
    expect(guidanceIndex).toBeGreaterThan(0);
    expect(guidanceIndex).toBeLessThan(exportIndex);
    expect(setViewSource).toContain("这是推荐步骤，不会阻止你人工选择最终版本");
    expect(setViewSource).toContain("尚未完成整组一致性检查");
    expect(moreActions).not.toContain("检查整组一致性");
    expect(setViewSource).toContain("if (warning && !confirm(warning)) return");
  });

  it("宫格结果先展示可逐张检查的单张，再在下方合成最终宫格", () => {
    expect(setViewSource).toContain("createGridComposite");
    expect(setViewSource).toContain("宫格合成暂不可用");
    expect(setViewSource).toContain("重新合成宫格");
    expect(setViewSource).toContain("gridName && compositeLayout && <GridCompositeResult");
    expect(setViewSource.indexOf('className="creation-set-grid"'))
      .toBeLessThan(setViewSource.indexOf("gridName && compositeLayout && <GridCompositeResult"));
    expect(setViewSource).toContain("最终宫格");
  });

  it("套图详情持续展示待复刻画面和全部主体素材", () => {
    expect(setViewSource).toContain('aria-label="本次参考"');
    expect(setViewSource).toContain("待复刻画面");
    expect(setViewSource).toContain("本次人物素材");
    expect(appSource).toContain("creationSet.sharedReferenceSnapshots");
    expect(appSource).toContain("creationSet.subjectAssetSnapshots");
  });

  it("查看器显式重置全局固定底栏并保证图片不被操作区覆盖", () => {
    expect(cssSource).toMatch(/\.set-viewer > footer\s*\{[^}]*position:\s*static/s);
    expect(cssSource).toMatch(/\.set-viewer > footer\s*\{[^}]*background:\s*rgba\(24,\s*26,\s*27/s);
    expect(cssSource).toMatch(/\.set-viewer-image\s*\{[^}]*min-height:\s*0/s);
  });
});

describe("最终 UX P2 回归", () => {
  it("作品搜索无匹配时说明搜索结果为空，并允许一键清除", () => {
    expect(appSource).toContain("search.trim()");
    expect(appSource).toContain("没有匹配作品");
    expect(appSource).toContain("换个关键词，或清除搜索查看全部作品");
    expect(appSource).toContain('setSearch("")');
  });

  it("单图和套图命名编辑均在 Escape 后恢复焦点，并展示保存失败", () => {
    expect(appSource).toContain("renameTriggerRef.current?.focus()");
    expect(appSource).toContain("名称没有保存成功，请重试。");
    expect(appSource).toContain('className="project-name-error" role="alert"');
    expect(setViewSource).toContain("titleTriggerRef.current?.focus()");
    expect(setViewSource).toContain("套图名称没有保存成功，请重试。");
    expect(setViewSource).toContain('className="creation-set-title-error" role="alert"');
  });

  it("三处提示词复制只有成功后才报成功，失败时给出可重试反馈", () => {
    expect(styleBreakdownSource).toContain("复制失败，请重试");
    expect(styleBreakdownSource).toMatch(/try\s*\{[\s\S]*await navigator\.clipboard\.writeText[\s\S]*catch/);
    expect(appSource.match(/复制失败，请重试/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(appSource).not.toContain("void navigator.clipboard.writeText(finalPrompt)");
  });

  it("Hover 菜单打开后聚焦首项，Escape 回触发按钮，Tab 或焦点移出时关闭", () => {
    expect(hoverSource).toContain("const openMenu = () =>");
    expect(hoverSource).toContain('menu.querySelector<HTMLButtonElement>("[role=\'menuitem\']")?.focus()');
    expect(hoverSource).toContain("more.focus()");
    expect(hoverSource).toContain('key === "Tab"');
    expect(hoverSource).toContain('shadow.addEventListener("focusout"');
  });

  it("首次隐私与同意说明不使用低于 12px 的正文", () => {
    expect(cssSource).toMatch(/\.capture-privacy-disclosure\s*\{[^}]*font-size:\s*12px/s);
    expect(cssSource).toMatch(/\.consent-page \.eyebrow\s*\{[^}]*font-size:\s*12px/s);
    expect(cssSource).toMatch(/\.consent-footnote\s*\{[^}]*font-size:\s*12px/s);
  });

  it("生成候选把第一版称为首版，不与上传参考原图混淆", () => {
    expect(setViewSource).toContain('label={index === 0 ? "首版" : `重试 ${index}`}');
    expect(setViewSource).not.toContain('label={index === 0 ? "原图"');
  });

  it("主体编辑器打开时，当前主导航 tab 控制真实存在的编辑面板", () => {
    expect(appSource).toContain('aria-controls={subjectEditor && route === "create" ? "subject-editor-panel" : "create-panel"}');
    expect(appSource).toContain('aria-controls={subjectEditor && route === "library" ? "subject-editor-panel" : "library-panel"}');
    expect(appSource).toContain('id="subject-editor-panel" role="tabpanel"');
  });

  it("套图单格错误统一经过安全文案转换，不直接展示底层异常", () => {
    expect(setViewSource).toContain("safeCreationSetErrorMessage");
    expect(setViewSource).toContain("safeCreationSetErrorMessage(item.error.message)");
    expect(setViewSource).not.toContain("{item.error.message}");
  });
});
