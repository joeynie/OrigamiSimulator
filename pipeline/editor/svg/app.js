import ear from "../../node_modules/rabbit-ear/module/index.js";
import {
  DEFAULT_FRAMES_PER_STEP,
  buildStepGraph,
  buildSvgStepTrajectory,
  createBlankSvgProject,
  mergeSvgProjectWithAsset,
  normalizeSvgProject,
  parseSvgAsset,
  resolveRootFacesFromCenter,
} from "../svg_step_pipeline.js";

const BOARD_SCALE = 100;

const assignmentMeta = {
  V: { label: "谷线", className: "valley", stroke: "#3f78b8", dasharray: "8 6" },
  M: { label: "山线", className: "mountain", stroke: "#d96c2b", dasharray: "16 6 3 6" },
  F: { label: "辅助线", className: "aux", stroke: "#7e8aa0", dasharray: "4 5" },
};

const dom = {
  projectNameInput: document.querySelector("#project-name-input"),
  projectPanelBody: document.querySelector("#project-panel-body"),
  toggleProjectPanelButton: document.querySelector("#toggle-project-panel-button"),
  projectSelect: document.querySelector("#project-select"),
  loadProjectButton: document.querySelector("#load-project-button"),
  deleteProjectButton: document.querySelector("#delete-project-button"),
  saveProjectButton: document.querySelector("#save-project-button"),
  assetSelect: document.querySelector("#asset-select"),
  loadAssetButton: document.querySelector("#load-asset-button"),
  refreshAssetsButton: document.querySelector("#refresh-assets-button"),
  exportTrajectoryButton: document.querySelector("#export-trajectory-button"),
  framesPerStepInput: document.querySelector("#frames-per-step-input"),
  sourceHint: document.querySelector("#source-hint"),
  projectStatus: document.querySelector("#project-status"),
  stepCount: document.querySelector("#step-count"),
  creaseCount: document.querySelector("#crease-count"),
  stepList: document.querySelector("#step-list"),
  stepCreaseList: document.querySelector("#step-crease-list"),
  addStepButton: document.querySelector("#add-step-button"),
  deleteStepButton: document.querySelector("#delete-step-button"),
  activeStepName: document.querySelector("#active-step-name"),
  assetPill: document.querySelector("#asset-pill"),
  facePill: document.querySelector("#face-pill"),
  edgePill: document.querySelector("#edge-pill"),
  statusText: document.querySelector("#status-text"),
  selectionText: document.querySelector("#selection-text"),
  board: document.querySelector("#svg-board"),
  boundaryLayer: document.querySelector("#board-boundary-layer"),
  creaseLayer: document.querySelector("#board-crease-layer"),
  labelLayer: document.querySelector("#board-label-layer"),
  previewStage: document.querySelector("#preview-stage"),
  previewNote: document.querySelector("#preview-note"),
};

const state = {
  project: createBlankSvgProject(),
  savedProjects: [],
  assets: [],
  activeStepId: "",
  selectedProjectName: "",
  selectedAssetPath: "",
  selectedCreaseId: "",
  projectPanelExpanded: false,
};

function setProjectStatus(message, tone = "muted") {
  dom.projectStatus.textContent = message;
  dom.projectStatus.className = `project-status${tone === "danger" ? " is-danger" : ""}`;
}

function ensureActiveStepId() {
  if (!state.project.steps.length) {
    state.project.steps = createBlankSvgProject().steps;
  }
  if (!state.activeStepId || !state.project.steps.some((step) => step.id === state.activeStepId)) {
    state.activeStepId = state.project.steps[0].id;
  }
}

function getActiveStep() {
  ensureActiveStepId();
  return state.project.steps.find((step) => step.id === state.activeStepId) ?? state.project.steps[0];
}

function moveItem(items, index, offset) {
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

function basename(path) {
  return (path || "").split("/").pop() || "";
}

function visibleVertices() {
  return (state.project.fold?.vertices_coords ?? [])
    .filter((point) => Array.isArray(point))
    .map((point) => [point[0] * BOARD_SCALE, point[1] * BOARD_SCALE]);
}

function boardViewBox() {
  const vertices = visibleVertices();
  if (!vertices.length) {
    return "0 0 100 100";
  }
  const minX = Math.min(...vertices.map((point) => point[0]));
  const maxX = Math.max(...vertices.map((point) => point[0]));
  const minY = Math.min(...vertices.map((point) => point[1]));
  const maxY = Math.max(...vertices.map((point) => point[1]));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const pad = Math.max(width, height) * 0.06;
  return `${minX - pad} ${minY - pad} ${width + pad * 2} ${height + pad * 2}`;
}

function stepOwner(creaseId) {
  return state.project.steps.find((step) => step.creaseIds.includes(creaseId)) ?? null;
}

function createSvgNode(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function applyLineStyle(line, assignment, width) {
  const meta = assignmentMeta[assignment] ?? assignmentMeta.F;
  line.setAttribute("stroke", meta.stroke);
  line.setAttribute("stroke-dasharray", meta.dasharray);
  line.setAttribute("stroke-width", String(width));
}

function toBoardPoint(point) {
  return Array.isArray(point)
    ? [point[0] * BOARD_SCALE, point[1] * BOARD_SCALE]
    : null;
}

function serializeProject() {
  return normalizeSvgProject({
    ...state.project,
    name: state.project.name,
    settings: {
      framesPerStep: state.project.settings.framesPerStep,
    },
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function fetchAssetModel(asset) {
  const response = await fetch(`/${asset.path}`);
  if (!response.ok) {
    throw new Error(`无法加载 ${asset.name}`);
  }
  const text = await response.text();
  const documentNode = new DOMParser().parseFromString(text, "image/svg+xml");
  return parseSvgAsset(documentNode.documentElement, asset);
}

function applyProject(project) {
  state.project = normalizeSvgProject(project);
  state.selectedProjectName = state.project.name;
  state.selectedAssetPath = state.project.sourceAsset?.path ?? "";
  ensureActiveStepId();
  dom.projectNameInput.value = state.project.name;
  dom.framesPerStepInput.value = String(state.project.settings.framesPerStep);
  render();
}

async function loadAssetIntoProject(asset, projectBase = null) {
  const assetModel = await fetchAssetModel(asset);
  const baseProject = projectBase ?? createBlankSvgProject(asset.name.replace(/\.[^.]+$/, ""));
  applyProject(mergeSvgProjectWithAsset(baseProject, assetModel));
  state.selectedAssetPath = asset.path;
  setProjectStatus(`已载入 SVG：${asset.name}`);
}

async function refreshProjects() {
  const payload = await requestJson("/api/projects?type=svg-sequence");
  state.savedProjects = payload.projects ?? [];
  if (!state.savedProjects.some((project) => project.name === state.selectedProjectName)) {
    state.selectedProjectName = state.savedProjects[0]?.name ?? "";
  }
  renderProjectList();
}

async function refreshAssets() {
  const payload = await requestJson("/api/svg-assets");
  state.assets = payload.assets ?? [];
  if (!state.assets.some((asset) => asset.path === state.selectedAssetPath)) {
    state.selectedAssetPath = state.assets[0]?.path ?? "";
  }
  renderAssetList();
}

async function saveProject() {
  try {
    const project = serializeProject();
    await requestJson("/api/project/save", {
      method: "POST",
      body: JSON.stringify({ name: project.name, project }),
    });
    state.selectedProjectName = project.name;
    state.project.name = project.name;
    await refreshProjects();
    setProjectStatus(`已保存项目：${project.name}`);
  } catch (error) {
    setProjectStatus(`保存失败：${error.message}`, "danger");
  }
}

async function loadProject(name) {
  try {
    const payload = await requestJson(`/api/project?name=${encodeURIComponent(name)}`);
    const project = normalizeSvgProject(payload.project);
    if (!project.fold && project.sourceAsset?.path) {
      const asset = state.assets.find((item) => item.path === project.sourceAsset.path)
        ?? { name: basename(project.sourceAsset.path), path: project.sourceAsset.path };
      await loadAssetIntoProject(asset, project);
      state.selectedProjectName = project.name;
      return;
    }
    applyProject(project);
    setProjectStatus(`已加载项目：${project.name}`);
  } catch (error) {
    setProjectStatus(`加载失败：${error.message}`, "danger");
  }
}

async function deleteProject(name) {
  try {
    await requestJson("/api/project/delete", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    await refreshProjects();
    setProjectStatus(`已删除项目：${name}`);
  } catch (error) {
    setProjectStatus(`删除失败：${error.message}`, "danger");
  }
}

async function exportTrajectory() {
  try {
    const project = serializeProject();
    const trajectory = buildSvgStepTrajectory(project, {
      framesPerStep: state.project.settings.framesPerStep,
    });
    const payload = await requestJson("/api/export/trajectory", {
      method: "POST",
      body: JSON.stringify({ name: project.name, trajectory }),
    });
    setProjectStatus(`已导出到 ${payload.path}，共 ${trajectory.metadata.frame_count} 帧`);
  } catch (error) {
    setProjectStatus(`导出失败：${error.message}`, "danger");
  }
}

function addStep() {
  state.project.steps.push({
    id: globalThis.crypto?.randomUUID?.() ?? `step-${Date.now()}`,
    name: `步骤 ${state.project.steps.length + 1}`,
    creaseIds: [],
  });
  state.activeStepId = state.project.steps[state.project.steps.length - 1].id;
  render();
}

function deleteStep() {
  const index = state.project.steps.findIndex((step) => step.id === getActiveStep().id);
  if (index < 0) {
    return;
  }
  state.project.steps.splice(index, 1);
  if (!state.project.steps.length) {
    state.project.steps = createBlankSvgProject().steps;
  }
  state.activeStepId = state.project.steps[Math.min(index, state.project.steps.length - 1)].id;
  render();
}

function moveStep(index, offset) {
  state.project.steps = moveItem(state.project.steps, index, offset);
  render();
}

function toggleCreaseForActiveStep(creaseId) {
  const activeStep = getActiveStep();
  const alreadyAssigned = activeStep.creaseIds.includes(creaseId);
  state.project.steps.forEach((step) => {
    step.creaseIds = step.creaseIds.filter((id) => id !== creaseId);
  });
  if (!alreadyAssigned) {
    activeStep.creaseIds = [...activeStep.creaseIds, creaseId];
  }
  state.selectedCreaseId = creaseId;
  render();
}

function renderProjectPanel() {
  dom.projectPanelBody.classList.toggle("card__body--collapsed", !state.projectPanelExpanded);
  dom.toggleProjectPanelButton.textContent = state.projectPanelExpanded ? "收起" : "展开";
  dom.toggleProjectPanelButton.setAttribute("aria-expanded", String(state.projectPanelExpanded));
}

function renderProjectList() {
  dom.projectSelect.innerHTML = "";
  if (!state.savedProjects.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "还没有已保存项目";
    dom.projectSelect.appendChild(option);
    dom.projectSelect.disabled = true;
    return;
  }
  state.savedProjects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.name;
    option.textContent = project.name;
    option.selected = project.name === state.selectedProjectName;
    dom.projectSelect.appendChild(option);
  });
  dom.projectSelect.disabled = false;
}

function renderAssetList() {
  dom.assetSelect.innerHTML = "";
  if (!state.assets.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "没有可用 SVG 素材";
    dom.assetSelect.appendChild(option);
    dom.assetSelect.disabled = true;
    return;
  }
  state.assets.forEach((asset) => {
    const option = document.createElement("option");
    option.value = asset.path;
    option.textContent = asset.name;
    option.selected = asset.path === state.selectedAssetPath;
    dom.assetSelect.appendChild(option);
  });
  dom.assetSelect.disabled = false;
}

function renderHeader() {
  const activeStep = getActiveStep();
  const fold = state.project.fold;
  dom.activeStepName.textContent = activeStep?.name ?? "步骤 1";
  dom.assetPill.textContent = state.project.sourceAsset?.name || "未载入 SVG";
  dom.facePill.textContent = `${fold?.faces_vertices?.length ?? 0} 面`;
  dom.edgePill.textContent = `${(fold?.edges_vertices ?? []).filter((edge) => Array.isArray(edge)).length} 边`;
  dom.stepCount.textContent = `${state.project.steps.length} 步`;
  dom.creaseCount.textContent = `${state.project.creaseGroups.length} 条`;
  dom.sourceHint.textContent = state.project.sourceAsset?.path ? `素材路径：${state.project.sourceAsset.path}` : "";
}

function renderStepList() {
  dom.stepList.innerHTML = "";
  state.project.steps.forEach((step, index) => {
    const item = document.createElement("article");
    item.className = `step-item${step.id === state.activeStepId ? " is-active" : ""}`;

    const row = document.createElement("div");
    row.className = "step-item__row";
    const meta = document.createElement("div");
    meta.className = "step-item__meta";
    const input = document.createElement("input");
    input.className = "step-name-input";
    input.value = step.name;
    input.addEventListener("input", (event) => {
      step.name = event.target.value.trimStart() || `步骤 ${index + 1}`;
      renderHeader();
      renderStatus();
    });
    input.addEventListener("blur", (event) => {
      step.name = event.target.value.trim() || `步骤 ${index + 1}`;
      render();
    });
    const hint = document.createElement("p");
    hint.className = "step-item__hint";
    hint.textContent = `${step.creaseIds.length} 条折痕`;
    meta.append(input, hint);

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar-group";
    [
      { label: "↑", action: () => moveStep(index, -1), disabled: index === 0 },
      { label: "↓", action: () => moveStep(index, 1), disabled: index === state.project.steps.length - 1 },
    ].forEach(({ label, action, disabled }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button--ghost icon-button";
      button.textContent = label;
      button.disabled = Boolean(disabled);
      button.addEventListener("click", action);
      toolbar.appendChild(button);
    });

    row.append(meta, toolbar);
    item.appendChild(row);
    item.addEventListener("click", (event) => {
      if (event.target.closest("button") || event.target === input) {
        return;
      }
      state.activeStepId = step.id;
      render();
    });
    dom.stepList.appendChild(item);
  });
}

function assignmentBadge(assignment) {
  const meta = assignmentMeta[assignment] ?? assignmentMeta.F;
  return `<span class="assignment-badge assignment-badge--${meta.className}">${meta.label}</span>`;
}

function renderStepCreaseList() {
  dom.stepCreaseList.innerHTML = "";
  if (!state.project.creaseGroups.length) {
    dom.stepCreaseList.innerHTML = '<p class="empty-state">先载入 SVG，系统会自动给可选折痕编号。</p>';
    return;
  }
  const activeStep = getActiveStep();
  state.project.creaseGroups.forEach((crease) => {
    const owner = stepOwner(crease.id);
    const isActive = owner?.id === activeStep.id;
    const item = document.createElement("article");
    item.className = `crease-item${state.selectedCreaseId === crease.id ? " is-active" : ""}`;

    const row = document.createElement("div");
    row.className = "crease-item__row";
    const meta = document.createElement("div");
    meta.className = "crease-item__meta";
    meta.innerHTML = `
      <strong>${crease.label}</strong>
      <p class="crease-item__hint">${assignmentMeta[crease.assignment]?.label ?? "折痕"} · ${owner ? `已分配到 ${owner.name}` : "未分配"}</p>
      <div class="toolbar-group">
        ${assignmentBadge(crease.assignment)}
        <span class="svg-badge${isActive ? " is-active-step" : ""}">${isActive ? "当前步骤" : owner ? "其他步骤" : "未分配"}</span>
      </div>
    `;

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button--ghost";
    button.textContent = isActive ? "移出" : "分配";
    button.addEventListener("click", () => toggleCreaseForActiveStep(crease.id));
    toolbar.appendChild(button);

    row.append(meta, toolbar);
    item.appendChild(row);
    item.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      state.selectedCreaseId = crease.id;
      renderSelection();
      renderBoard();
    });
    dom.stepCreaseList.appendChild(item);
  });
}

function renderBoard() {
  dom.board.setAttribute("viewBox", boardViewBox());
  dom.boundaryLayer.innerHTML = "";
  dom.creaseLayer.innerHTML = "";
  dom.labelLayer.innerHTML = "";
  if (!state.project.fold) {
    return;
  }

  const activeStep = getActiveStep();
  const fold = state.project.fold;
  (fold.edges_vertices ?? []).forEach((edgeVertices, edgeIndex) => {
    if (!Array.isArray(edgeVertices) || (fold.edges_assignment?.[edgeIndex] ?? "") !== "B") {
      return;
    }
    const [start, end] = edgeVertices.map((vertexIndex) => toBoardPoint(fold.vertices_coords?.[vertexIndex]));
    if (!Array.isArray(start) || !Array.isArray(end)) {
      return;
    }
    dom.boundaryLayer.appendChild(createSvgNode("line", {
      x1: start[0],
      y1: start[1],
      x2: end[0],
      y2: end[1],
      class: "svg-boundary",
    }));
  });

  state.project.creaseGroups.forEach((crease) => {
    const [start, end] = (crease.segment ?? []).map(toBoardPoint);
    if (!Array.isArray(start) || !Array.isArray(end)) {
      return;
    }
    const owner = stepOwner(crease.id);
    const isActive = owner?.id === activeStep.id;
    const isSelected = state.selectedCreaseId === crease.id;
    const line = createSvgNode("line", {
      x1: start[0],
      y1: start[1],
      x2: end[0],
      y2: end[1],
      class: `svg-crease ${isSelected ? "is-selected" : isActive ? "is-active-step" : owner ? "is-other-step" : "is-unassigned"}`,
    });
    applyLineStyle(line, crease.assignment, isSelected ? 4.4 : 3.1);
    dom.creaseLayer.appendChild(line);

    const hit = createSvgNode("line", {
      x1: start[0],
      y1: start[1],
      x2: end[0],
      y2: end[1],
      class: "svg-hit",
    });
    hit.addEventListener("click", () => toggleCreaseForActiveStep(crease.id));
    dom.creaseLayer.appendChild(hit);

    const labelPoint = Array.isArray(crease.labelPoint)
      ? toBoardPoint(crease.labelPoint)
      : [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const group = createSvgNode("g", {
      class: `svg-label ${isSelected ? "is-selected" : isActive ? "is-active-step" : ""}`,
      transform: `translate(${labelPoint[0]} ${labelPoint[1]})`,
    });
    const text = createSvgNode("text");
    text.textContent = crease.label;
    group.appendChild(text);
    dom.labelLayer.appendChild(group);
    let box = { x: -4.5, y: -3.2, width: 9, height: 6.4 };
    try {
      box = text.getBBox();
    } catch (error) {
      // Fallback when metrics are unavailable.
    }
    const rect = createSvgNode("rect", {
      x: box.x - 1.7,
      y: box.y - 0.9,
      width: box.width + 3.4,
      height: box.height + 1.8,
    });
    group.insertBefore(rect, text);
    group.addEventListener("click", () => toggleCreaseForActiveStep(crease.id));
  });
}

function tryFoldGraph(graph) {
  if (!graph?.edges_vertices?.length) {
    return null;
  }
  const rootFace = resolveRootFacesFromCenter(graph)[0] ?? 0;
  const attempts = [
    () => graph.clone().flatFolded(rootFace),
    () => graph.clone().flatFolded(),
    () => graph.clone().flatFolded(0),
    () => graph.clone().folded(rootFace),
    () => graph.clone().folded(),
    () => graph.clone().folded(0),
  ];
  for (const attempt of attempts) {
    try {
      const folded = attempt();
      if (folded) {
        return folded;
      }
    } catch (error) {
      continue;
    }
  }
  return null;
}

function renderableGraph(graphInput) {
  if (!graphInput?.vertices_coords?.length) {
    return null;
  }
  const vertexMap = new Map();
  const vertices = [];
  const mapVertex = (vertexIndex) => {
    if (vertexMap.has(vertexIndex)) {
      return vertexMap.get(vertexIndex);
    }
    const point = graphInput.vertices_coords?.[vertexIndex];
    if (!Array.isArray(point)) {
      return undefined;
    }
    const nextIndex = vertices.length;
    vertexMap.set(vertexIndex, nextIndex);
    vertices.push(point);
    return nextIndex;
  };

  const edges_vertices = [];
  const edges_assignment = [];
  const edges_foldAngle = [];
  (graphInput.edges_vertices ?? []).forEach((edgeVertices, edgeIndex) => {
    if (!Array.isArray(edgeVertices) || edgeVertices.length !== 2) {
      return;
    }
    const mapped = edgeVertices.map(mapVertex);
    if (mapped.some((vertexIndex) => vertexIndex === undefined)) {
      return;
    }
    edges_vertices.push(mapped);
    edges_assignment.push(graphInput.edges_assignment?.[edgeIndex] ?? "U");
    edges_foldAngle.push(graphInput.edges_foldAngle?.[edgeIndex] ?? 0);
  });

  const faces_vertices = (graphInput.faces_vertices ?? [])
    .map((face) => face?.map(mapVertex))
    .filter((face) => Array.isArray(face) && face.length >= 3 && face.every((vertexIndex) => vertexIndex !== undefined));

  return ear.graph({
    ...structuredClone(graphInput),
    vertices_coords: vertices,
    edges_vertices,
    edges_assignment,
    edges_foldAngle,
    faces_vertices,
  });
}

function stylePreviewDrawing(svg) {
  try {
    svg.querySelectorAll(".vertices").forEach((node) => node.setAttribute("display", "none"));
    svg.querySelectorAll(".boundaries polygon, .boundaries path").forEach((node) => {
      node.setAttribute("fill", "#fffaf2");
      node.setAttribute("stroke", "#96a4bb");
    });
    svg.querySelectorAll(".faces .front").forEach((node) => node.setAttribute("fill", "#f7b87c"));
    svg.querySelectorAll(".faces .back").forEach((node) => node.setAttribute("fill", "#fff8ee"));
    svg.querySelectorAll(".edges .mountain").forEach((node) => {
      node.setAttribute("stroke", assignmentMeta.M.stroke);
      node.setAttribute("stroke-dasharray", assignmentMeta.M.dasharray);
    });
    svg.querySelectorAll(".edges .valley").forEach((node) => {
      node.setAttribute("stroke", assignmentMeta.V.stroke);
      node.setAttribute("stroke-dasharray", assignmentMeta.V.dasharray);
    });
    svg.querySelectorAll(".edges .boundary").forEach((node) => node.setAttribute("stroke", "#96a4bb"));
    svg.querySelectorAll(".edges .flat").forEach((node) => {
      node.setAttribute("stroke", assignmentMeta.F.stroke);
      node.setAttribute("stroke-dasharray", assignmentMeta.F.dasharray);
    });
  } catch (error) {
    // Keep raw render visible.
  }
}

function renderPreview() {
  dom.previewStage.innerHTML = "";
  if (!state.project.fold) {
    dom.previewNote.textContent = "载入 SVG 后，这里会显示当前步骤之前的累计折叠结果。";
    dom.previewStage.innerHTML = '<p class="preview-empty">当前还没有可预览的折痕图。</p>';
    return;
  }
  const stepIndex = state.project.steps.findIndex((step) => step.id === getActiveStep().id);
  const graph = buildStepGraph(state.project, stepIndex, 1);
  const count = state.project.steps.slice(0, stepIndex + 1).reduce((sum, step) => sum + step.creaseIds.length, 0);
  try {
    const renderGraph = renderableGraph(tryFoldGraph(graph) || graph);
    const svg = ear.svg();
    svg.origami(renderGraph, {
      viewBox: true,
      strokeWidth: 0.012,
      radius: 0.014,
      padding: 0.08,
    });
    svg.classList.add("preview-svg");
    stylePreviewDrawing(svg);
    dom.previewStage.appendChild(svg);
    dom.previewNote.textContent = `预览累计到 ${getActiveStep().name}，共启用 ${count} 条折痕。`;
  } catch (error) {
    const fallback = renderableGraph(graph);
    const svg = ear.svg();
    svg.origami(fallback, {
      viewBox: true,
      strokeWidth: 0.012,
      radius: 0.014,
      padding: 0.08,
    });
    svg.classList.add("preview-svg");
    stylePreviewDrawing(svg);
    dom.previewStage.appendChild(svg);
    dom.previewNote.textContent = `折叠预览失败，当前显示折痕图。已启用 ${count} 条折痕。`;
  }
}

function renderStatus() {
  if (!state.project.fold) {
    dom.statusText.textContent = "先载入一个 SVG 素材，再为步骤分配折痕。";
    return;
  }
  dom.statusText.textContent = `当前步骤是 ${getActiveStep().name}。点击纸面编号或左侧列表，把折痕分配到这个步骤。`;
}

function renderSelection() {
  const crease = state.project.creaseGroups.find((item) => item.id === state.selectedCreaseId);
  if (!crease) {
    dom.selectionText.textContent = "当前没有选中折痕";
    return;
  }
  const owner = stepOwner(crease.id);
  dom.selectionText.textContent = `${crease.label} · ${assignmentMeta[crease.assignment]?.label ?? "折痕"} · ${owner ? owner.name : "未分配"}`;
}

function renderButtons() {
  dom.deleteStepButton.disabled = state.project.steps.length <= 1;
  dom.exportTrajectoryButton.disabled = !state.project.fold;
  dom.loadProjectButton.disabled = !state.selectedProjectName;
  dom.deleteProjectButton.disabled = !state.selectedProjectName;
  dom.loadAssetButton.disabled = !state.selectedAssetPath;
}

function render() {
  ensureActiveStepId();
  renderProjectPanel();
  renderProjectList();
  renderAssetList();
  renderHeader();
  renderStepList();
  renderStepCreaseList();
  renderBoard();
  renderStatus();
  renderSelection();
  renderButtons();
  renderPreview();
}

function bindEvents() {
  dom.projectNameInput.addEventListener("input", (event) => {
    state.project.name = event.target.value.trimStart() || "svg_sequence";
  });
  dom.toggleProjectPanelButton.addEventListener("click", () => {
    state.projectPanelExpanded = !state.projectPanelExpanded;
    renderProjectPanel();
  });
  dom.projectSelect.addEventListener("change", (event) => {
    state.selectedProjectName = event.target.value;
  });
  dom.assetSelect.addEventListener("change", (event) => {
    state.selectedAssetPath = event.target.value;
  });
  dom.framesPerStepInput.addEventListener("change", (event) => {
    const parsed = Number.parseInt(event.target.value, 10);
    state.project.settings.framesPerStep = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FRAMES_PER_STEP;
    dom.framesPerStepInput.value = String(state.project.settings.framesPerStep);
  });
  dom.addStepButton.addEventListener("click", addStep);
  dom.deleteStepButton.addEventListener("click", deleteStep);
  dom.saveProjectButton.addEventListener("click", saveProject);
  dom.loadProjectButton.addEventListener("click", () => {
    if (state.selectedProjectName) {
      loadProject(state.selectedProjectName);
    }
  });
  dom.deleteProjectButton.addEventListener("click", () => {
    if (state.selectedProjectName) {
      deleteProject(state.selectedProjectName);
    }
  });
  dom.refreshAssetsButton.addEventListener("click", async () => {
    try {
      await refreshAssets();
      setProjectStatus("SVG 素材列表已刷新");
    } catch (error) {
      setProjectStatus(`刷新素材失败：${error.message}`, "danger");
    }
  });
  dom.loadAssetButton.addEventListener("click", async () => {
    const asset = state.assets.find((item) => item.path === state.selectedAssetPath);
    if (!asset) {
      return;
    }
    try {
      await loadAssetIntoProject(asset);
    } catch (error) {
      setProjectStatus(`载入 SVG 失败：${error.message}`, "danger");
    }
  });
  dom.exportTrajectoryButton.addEventListener("click", exportTrajectory);
}

async function init() {
  bindEvents();
  dom.projectNameInput.value = state.project.name;
  dom.framesPerStepInput.value = String(state.project.settings.framesPerStep);
  render();
  try {
    await Promise.all([refreshProjects(), refreshAssets()]);
    render();
  } catch (error) {
    setProjectStatus(`初始化失败：${error.message}`, "danger");
  }
}

init();
