import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
  "utf8"
);

describe("运行可靠性契约", () => {
  it("套图开始同时使用实例锁和跨窗口 Web Lock，并在异常路径释放", () => {
    expect(app).toContain("const setRunInFlightRef = useRef(false)");
    const runActiveCreationSet = app.slice(
      app.indexOf("async function runActiveCreationSet"),
      app.indexOf("async function runCreationSetQuality")
    );
    expect(runActiveCreationSet).toContain("if (setRunInFlightRef.current) return");
    expect(runActiveCreationSet).toContain("setRunInFlightRef.current = true");
    expect(runActiveCreationSet).toContain("navigator.locks.request");
    expect(runActiveCreationSet).toContain("ifAvailable: true");
    expect(runActiveCreationSet).toContain("await getCreationSet(initial.id)");
    expect(runActiveCreationSet).toContain("另一窗口正在生成这组作品");
    expect(runActiveCreationSet).toMatch(/finally\s*\{\s*setRunInFlightRef\.current = false/);
  });

  it("单图与套图长生成都周期刷新持久任务心跳", () => {
    expect(app).toContain("refreshTaskHeartbeat");
    expect(app).toContain("startTaskHeartbeat");
  });

  it("单图生成入口使用同步实例锁，快速连点也只会启动一次", () => {
    expect(app).toContain("const singleRunInFlightRef = useRef(false)");
    const runGenerate = app.slice(
      app.indexOf("async function runGenerate"),
      app.indexOf("async function persistActiveCreationSet")
    );
    expect(runGenerate).toContain("if (singleRunInFlightRef.current)");
    expect(runGenerate).toContain("singleRunInFlightRef.current = true");
    expect(runGenerate).toMatch(/finally\s*\{\s*singleRunInFlightRef\.current = false/);
  });

  it("ZIP 预检或压缩失败会在当前页面显示可恢复错误", () => {
    const exportCreationSet = app.slice(
      app.indexOf("async function exportCreationSet("),
      app.indexOf("async function exportCreationSetGrid(")
    );
    expect(exportCreationSet).toContain("try {");
    expect(exportCreationSet).toContain("catch (cause)");
    expect(exportCreationSet).toContain("setToast(");

    const exportCreationSetGrid = app.slice(
      app.indexOf("async function exportCreationSetGrid("),
      app.indexOf("async function updateCreationSetDraft(")
    );
    expect(exportCreationSetGrid).toContain("try {");
    expect(exportCreationSetGrid).toContain("catch (cause)");
    expect(exportCreationSetGrid).toContain("setToast(");
  });

  it("现有项目编辑使用 IndexedDB 原子更新，不以旧 React 快照盲写", () => {
    expect(app).toContain("updateProject");
    const selectProjectOutput = app.slice(
      app.indexOf("async function selectProjectOutput"),
      app.indexOf("async function openProject")
    );
    expect(selectProjectOutput).toContain("persistProjectUpdate");
    expect(selectProjectOutput).not.toContain("saveProject(updated)");
    const renameProject = app.slice(
      app.indexOf("async function renameProject"),
      app.indexOf("function toggleFavorite")
    );
    expect(renameProject).toContain("persistProjectUpdate");
    expect(renameProject).not.toContain("saveProject(updated)");
  });

  it("逐格 Critic 校验实际返回编号，质量错误只持久化安全用户文案", () => {
    const executeCreationSetItem = app.slice(
      app.indexOf("async function executeCreationSetItem"),
      app.indexOf("async function runActiveCreationSet")
    );
    expect(executeCreationSetItem).toContain("safeCreationSetErrorMessage");
    const runActiveCreationSet = app.slice(
      app.indexOf("async function runActiveCreationSet"),
      app.indexOf("async function runCreationSetQuality")
    );
    expect(runActiveCreationSet).toContain("validateSetQualityReportItems");
    expect(runActiveCreationSet).toContain("[item.id]");
    const runCreationSetQuality = app.slice(
      app.indexOf("async function runCreationSetQuality"),
      app.indexOf("async function cancelActiveCreationSet")
    );
    expect(runCreationSetQuality).toContain("safeCreationSetErrorMessage");
    expect(runCreationSetQuality).not.toContain("质量检查未完成：${detail}");
  });

  it("普通逐格重试复用核心安全转换，避免 UI 与 Schema 规则分叉", () => {
    const retry = app.slice(
      app.indexOf("async function retryCreationSetItem"),
      app.indexOf("async function selectCreationSetOutput")
    );
    expect(retry).toContain("prepareCreationSetItemRetry");
  });

  it("离开套图详情后仍接收终态，避免一直显示正在创作", () => {
    const runActiveCreationSet = app.slice(
      app.indexOf("async function runActiveCreationSet"),
      app.indexOf("async function runCreationSetQuality")
    );
    expect(runActiveCreationSet).toContain("activeCreationSetIdRef.current === next.id");
    expect(runActiveCreationSet).not.toContain('routeRef.current === "create"\n          && currentProjectIdRef.current === next.projectId');
  });

  it("只有套图输出的父作品会直接打开套图，不再进入空白详情", () => {
    const openProject = app.slice(
      app.indexOf("async function openProject"),
      app.indexOf("async function openCreationSet")
    );
    expect(openProject).toContain("containerCreationSet");
    expect(openProject).toContain("await openCreationSet(containerCreationSet.id, fromLibrary)");
  });

  it("作品列表隐藏纯套图容器，存在独立单图时才显示父作品", () => {
    expect(app).toContain("standaloneProjects");
    expect(app).toContain("setOutputIdsByProject");
    expect(app).toContain("!setOutputIds.has(assetId)");
    expect(app).toContain("selectMostRecentCreationTarget(standaloneProjects, creationSets)");
  });

  it("人物生成把原始来源和脸部／全身职责传到 Native Host", () => {
    const executeCreationSetItem = app.slice(
      app.indexOf("async function executeCreationSetItem"),
      app.indexOf("async function runActiveCreationSet")
    );
    expect(executeCreationSetItem).toContain("imagePurpose:");
    expect(executeCreationSetItem).toContain("sourceKind: reference.sourceKind");
  });

  it("参考图理解改为单次联合分析缓存，避免串行两轮", () => {
    const analyze = app.slice(
      app.indexOf("async function runAnalyze"),
      app.indexOf("async function persistActiveCreationSet")
    );
    expect(analyze).toContain('analysisCacheKey(source.hash, "joint"');
    expect(analyze).toContain('analysisMode: "joint"');
    expect(analyze).not.toContain('analysisCacheKey(source.hash, "two-stage"');
  });

  it("创作标签在后台任务期间返回当前任务，并显示套图完成数量", () => {
    const openCreateHome = app.slice(
      app.indexOf("function openCreateHome"),
      app.indexOf("function returnToCurrentTask")
    );
    expect(openCreateHome).toContain('activeCreationSet?.status === "GENERATING"');
    expect(openCreateHome).toContain("returnToCurrentTask()");
    expect(app).toContain("activeCreationSet.completedCount}/${activeCreationSet.requestedCount}");
    expect(app).toContain('if (activeCreationSet.status !== "GENERATING") setActiveCreationSet(undefined)');
  });
});
