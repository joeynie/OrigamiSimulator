import ear from "../node_modules/rabbit-ear/module/index.js";
import {
  DEFAULT_FRAMES_PER_STEP,
  applyReplayCrease,
  buildSequentialTrajectory,
  captureCreaseScope,
  createBlankProject,
  normalizeProject,
} from "./trajectory.js";
import {
  DRAW_MODE_META,
  buildAxiom3Solutions,
  createCreaseResolver,
  distanceToSegment,
  extendSegmentToPaper,
  intersectSegments,
  lineRefLabel,
  listStaticLineCandidates,
  makeLineRefKey,
} from "./geometry.js";

const gridValues = [0, 25, 50, 75, 100];
const columnLabels = ["A", "B", "C", "D", "E"];
const rowLabels = ["1", "2", "3", "4", "5"];
const snapDistancePx = 18;
const assignmentMeta = {
  V: { label: "谷线", className: "valley" },
  M: { label: "山线", className: "mountain" },
  F: { label: "辅助线", className: "aux" },
};

Object.assign(assignmentMeta, {
  V: { ...assignmentMeta.V, label: "谷线", stroke: "#3f78b8", dasharray: "1.8 1.35" },
  M: { ...assignmentMeta.M, label: "山线", stroke: "#d96c2b", dasharray: "4.2 1.6 0.6 1.6" },
  F: { ...assignmentMeta.F, label: "辅助线", stroke: "#7e8aa0", dasharray: "1.2 1.2" },
});

const dom = {
  paper: document.querySelector("#paper"),
  gridLayer: document.querySelector("#grid-layer"),
  creaseLayer: document.querySelector("#crease-layer"),
  selectionLayer: document.querySelector("#selection-layer"),
  draftLayer: document.querySelector("#draft-layer"),
  pointLayer: document.querySelector("#point-layer"),
  labelLayer: document.querySelector("#label-layer"),
  hoverRing: document.querySelector("#hover-ring"),
  projectNameInput: document.querySelector("#project-name-input"),
  projectPanelBody: document.querySelector("#project-panel-body"),
  toggleProjectPanelButton: document.querySelector("#toggle-project-panel-button"),
  projectSelect: document.querySelector("#project-select"),
  projectPathHint: document.querySelector("#project-path-hint"),
  loadProjectButton: document.querySelector("#load-project-button"),
  deleteProjectButton: document.querySelector("#delete-project-button"),
  saveProjectButton: document.querySelector("#save-project-button"),
  refreshProjectsButton: document.querySelector("#refresh-projects-button"),
  exportTrajectoryButton: document.querySelector("#export-trajectory-button"),
  framesPerStepInput: document.querySelector("#frames-per-step-input"),
  projectStatus: document.querySelector("#project-status"),
  stepList: document.querySelector("#step-list"),
  creaseList: document.querySelector("#crease-list"),
  addStepButton: document.querySelector("#add-step-button"),
  deleteStepButton: document.querySelector("#delete-step-button"),
  cancelDrawingButton: document.querySelector("#cancel-drawing-button"),
  modeAxiom1Button: document.querySelector("#mode-axiom1-button"),
  modeAxiom3Button: document.querySelector("#mode-axiom3-button"),
  draftValleyButton: document.querySelector("#draft-valley-button"),
  draftMountainButton: document.querySelector("#draft-mountain-button"),
  draftAuxButton: document.querySelector("#draft-aux-button"),
  activeStepName: document.querySelector("#active-step-name"),
  stepCount: document.querySelector("#step-count"),
  statusText: document.querySelector("#status-text"),
  snapText: document.querySelector("#snap-text"),
  previewStage: document.querySelector("#preview-stage"),
  previewNote: document.querySelector("#preview-note"),
};

const gridPoints = gridValues.flatMap((y, row) =>
  gridValues.map((x, column) => ({
    id: `${columnLabels[column]}${rowLabels[row]}`,
    x,
    y,
  })),
);

const blankProject = createBlankProject();

const state = {
  projectName: blankProject.name,
  savedProjects: [],
  selectedProjectName: "",
  projectPanelExpanded: false,
  framesPerStep: blankProject.settings.framesPerStep,
  steps: blankProject.steps,
  activeStepId: blankProject.steps[0].id,
  selectedCreaseId: "",
  editingCreaseId: "",
  drawMode: "axiom1",
  drawingStartId: "",
  selectedLineKey: "",
  hoverPointId: "",
  hoverLineKey: "",
  pendingAssignment: "V",
  pointer: { x: 0, y: 0, visible: false },
  projectStatus: "项目未保存",
  projectStatusTone: "muted",
};

function makeId(prefix) {
  const token = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${token}`;
}

function pointKey(point) {
  return `${point.x.toFixed(4)},${point.y.toFixed(4)}`;
}

function dynamicPointId(point) {
  return `P:${pointKey(point)}`;
}

function parseDynamicPoint(pointId) {
  if (!pointId?.startsWith("P:")) {
    return null;
  }
  const [x, y] = pointId.slice(2).split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { id: pointId, x, y, isDynamic: true };
}

function getPoint(pointId) {
  return gridPoints.find((point) => point.id === pointId) ?? parseDynamicPoint(pointId);
}

function getStep(stepId = state.activeStepId) {
  return state.steps.find((step) => step.id === stepId);
}

function pointLabel(pointId) {
  const point = getPoint(pointId);
  if (!point) {
    return "";
  }
  return point.id.startsWith("P:")
    ? `(${point.x.toFixed(1)}, ${point.y.toFixed(1)})`
    : point.id;
}

function selectedStepIndex() {
  return state.steps.findIndex((step) => step.id === state.activeStepId);
}

function moveItem(items, index, offset) {
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }
  const nextItems = [...items];
  [nextItems[index], nextItems[nextIndex]] = [nextItems[nextIndex], nextItems[index]];
  return nextItems;
}

function nextAssignment(assignment) {
  const order = ["V", "M", "F"];
  const index = order.indexOf(assignment);
  return order[(index + 1 + order.length) % order.length];
}

function createResolver(steps = state.steps) {
  return createCreaseResolver(steps, getPoint);
}

function replayableSteps(stepLimit = selectedStepIndex(), activeLimit = activeStepLineLimit()) {
  return state.steps
    .slice(0, stepLimit + 1)
    .map((step, stepIndex) => ({
      ...step,
      creases: stepIndex < stepLimit
        ? step.creases
        : stepIndex === stepLimit
          ? step.creases.slice(0, activeLimit)
          : [],
    }));
}

function buildReplayState(stepLimit = selectedStepIndex(), activeLimit = activeStepLineLimit()) {
  const steps = replayableSteps(stepLimit, activeLimit);
  const resolver = createResolver(steps);
  const graph = ear.graph.square();
  steps.forEach((step) => {
    step.creases.forEach((crease) => {
      crease.scopeFaceIds = captureCreaseScope(graph, resolver, crease);
      applyReplayCrease(graph, resolver, crease);
    });
  });
  return { graph, resolver, steps };
}

function activeStepLineLimit() {
  const activeStep = getStep();
  if (!activeStep) {
    return 0;
  }
  if (!state.editingCreaseId) {
    return activeStep.creases.length;
  }
  const index = activeStep.creases.findIndex((crease) => crease.id === state.editingCreaseId);
  return index >= 0 ? index : activeStep.creases.length;
}

function selectableCreaseEntries() {
  const activeIndex = selectedStepIndex();
  if (activeIndex < 0) {
    return [];
  }

  const activeLimit = activeStepLineLimit();
  return state.steps.flatMap((step, stepIndex) => {
    const visibleCreases = stepIndex < activeIndex
      ? step.creases
      : stepIndex === activeIndex
        ? step.creases.slice(0, activeLimit)
        : [];

    return visibleCreases.map((crease, creaseIndex) => ({
      step,
      stepIndex,
      crease,
      creaseIndex,
    }));
  });
}

function intersectionSnapPoints() {
  const resolver = createResolver();
  const creases = selectableCreaseEntries()
    .map(({ crease }) => resolver.resolveCreaseSegment(crease))
    .filter(Boolean);
  const seen = new Set(gridPoints.map(pointKey));
  const points = [];
  const pushPoint = (point) => {
    const key = pointKey(point);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    points.push({
      id: dynamicPointId(point),
      x: Number(point.x.toFixed(4)),
      y: Number(point.y.toFixed(4)),
      isDynamic: true,
    });
  };

  creases.forEach((segment) => {
    const extended = extendSegmentToPaper(segment);
    if (!extended) {
      return;
    }
    extended.forEach(pushPoint);
  });

  for (let i = 0; i < creases.length; i += 1) {
    for (let j = i + 1; j < creases.length; j += 1) {
      const intersection = intersectSegments(creases[i], creases[j]);
      if (!intersection) {
        continue;
      }
      pushPoint(intersection);
    }
  }

  return points;
}

function snapPoints() {
  return [...gridPoints, ...intersectionSnapPoints()];
}

function lineSelectionState() {
  const resolver = createResolver();
  const candidates = [
    ...listStaticLineCandidates(),
    ...selectableCreaseEntries().flatMap(({ crease }) => {
      const segment = resolver.resolveCreaseSegment(crease);
      return segment
        ? [{
            ref: { kind: "crease", creaseId: crease.id },
            label: lineRefLabel({ kind: "crease", creaseId: crease.id }, resolver),
            segment,
          }]
        : [];
    }),
  ].map((candidate) => ({
    ...candidate,
    key: makeLineRefKey(candidate.ref),
  }));

  return {
    resolver,
    candidates,
    candidateMap: new Map(candidates.map((candidate) => [candidate.key, candidate])),
  };
}

function nearestLineCandidate(position, candidates) {
  const rect = dom.paper.getBoundingClientRect();
  const snapDistance = (100 / rect.width) * snapDistancePx;
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  candidates.forEach((candidate) => {
    const distance = distanceToSegment(position, candidate.segment);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = candidate;
    }
  });

  return nearestDistance <= snapDistance ? nearest : null;
}

function resetDraftSelection({ keepEditing = true } = {}) {
  state.drawingStartId = "";
  state.selectedLineKey = "";
  state.hoverPointId = "";
  state.hoverLineKey = "";
  if (!keepEditing) {
    state.editingCreaseId = "";
  }
}

function getCreaseEntry(creaseId) {
  for (const step of state.steps) {
    const crease = step.creases.find((item) => item.id === creaseId);
    if (crease) {
      return { step, crease };
    }
  }
  return null;
}

function allCreaseEntries() {
  return state.steps.flatMap((step) =>
    step.creases.map((crease) => ({
      step,
      crease,
      isActiveStep: step.id === state.activeStepId,
    })),
  );
}

function previewCreases() {
  const index = selectedStepIndex();
  return state.steps.slice(0, index + 1).flatMap((step) => step.creases);
}

function serializeProject() {
  return {
    name: state.projectName.trim() || "untitled",
    settings: {
      framesPerStep: state.framesPerStep,
    },
    steps: state.steps.map((step) => ({
      id: step.id,
      name: step.name,
      creases: step.creases.map((crease) =>
        crease.mode === "axiom3"
          ? {
              id: crease.id,
              mode: "axiom3",
              lineRefs: crease.lineRefs,
              solutionIndex: crease.solutionIndex ?? 0,
              assignment: crease.assignment,
              scopeFaceIds: crease.scopeFaceIds ?? [],
            }
          : {
              id: crease.id,
              mode: "axiom1",
              startId: crease.startId,
              endId: crease.endId,
              assignment: crease.assignment,
              scopeFaceIds: crease.scopeFaceIds ?? [],
            }),
    })),
  };
}

function applyProject(project) {
  const normalized = normalizeProject(project);
  state.projectName = normalized.name;
  state.selectedProjectName = normalized.name;
  state.framesPerStep = normalized.settings.framesPerStep;
  state.steps = normalized.steps;
  state.activeStepId = normalized.steps[0]?.id ?? "";
  state.drawMode = "axiom1";
  state.selectedCreaseId = "";
  resetDraftSelection({ keepEditing: false });
  dom.projectNameInput.value = state.projectName;
  dom.framesPerStepInput.value = String(state.framesPerStep);
  render();
}

function setProjectStatus(message, tone = "muted") {
  state.projectStatus = message;
  state.projectStatusTone = tone;
  renderProjectStatus();
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

async function refreshProjects() {
  try {
    const payload = await requestJson("/api/projects");
    state.savedProjects = payload.projects ?? [];
    if (!state.selectedProjectName || !state.savedProjects.some((project) => project.name === state.selectedProjectName)) {
      state.selectedProjectName = state.projectName;
    }
    renderProjectList();
    setProjectStatus("项目列表已刷新");
  } catch (error) {
    setProjectStatus(`刷新项目失败：${error.message}`, "danger");
  }
}

async function saveProject() {
  try {
    const project = serializeProject();
    await requestJson("/api/project/save", {
      method: "POST",
      body: JSON.stringify({
        name: project.name,
        project,
      }),
    });
    state.projectName = project.name;
    state.selectedProjectName = project.name;
    dom.projectNameInput.value = project.name;
    await refreshProjects();
    setProjectStatus(`已保存项目：${project.name}`);
  } catch (error) {
    setProjectStatus(`保存失败：${error.message}`, "danger");
  }
}

async function loadProject(name) {
  try {
    const payload = await requestJson(`/api/project?name=${encodeURIComponent(name)}`);
    applyProject(payload.project);
    state.selectedProjectName = name;
    setProjectStatus(`已加载项目：${name}`);
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
    state.savedProjects = state.savedProjects.filter((project) => project.name !== name);
    if (state.selectedProjectName === name) {
      state.selectedProjectName = state.savedProjects[0]?.name ?? "";
    }
    renderProjectList();
    setProjectStatus(`已删除项目：${name}`);
  } catch (error) {
    setProjectStatus(`删除失败：${error.message}`, "danger");
  }
}

async function exportTrajectory() {
  try {
    const project = serializeProject();
    const trajectory = buildSequentialTrajectory(project, {
      framesPerStep: state.framesPerStep,
      getPoint,
    });
    const payload = await requestJson("/api/export/trajectory", {
      method: "POST",
      body: JSON.stringify({
        name: project.name,
        trajectory,
      }),
    });
    setProjectStatus(`已导出到 ${payload.path}：${trajectory.metadata.frame_count} 帧`);
  } catch (error) {
    setProjectStatus(`导出失败：${error.message}`, "danger");
  }
}

function renderProjectStatus() {
  dom.projectStatus.textContent = state.projectStatus;
  dom.projectStatus.className = `project-status${state.projectStatusTone === "danger" ? " is-danger" : ""}`;
}

function renderProjectList() {
  const options = state.savedProjects;
  if (!options.some((project) => project.name === state.selectedProjectName)) {
    state.selectedProjectName = options[0]?.name ?? "";
  }

  dom.projectSelect.innerHTML = "";
  if (!options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "还没有已保存项目";
    dom.projectSelect.appendChild(option);
    dom.projectSelect.disabled = true;
    dom.projectPathHint.textContent = "";
    dom.loadProjectButton.disabled = true;
    dom.deleteProjectButton.disabled = true;
    return;
  }

  options.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.name;
    option.textContent = project.name;
    option.selected = project.name === state.selectedProjectName;
    dom.projectSelect.appendChild(option);
  });

  const selectedProject = options.find((project) => project.name === state.selectedProjectName) ?? options[0];
  dom.projectSelect.disabled = false;
  dom.projectSelect.value = selectedProject.name;
  dom.projectPathHint.textContent = selectedProject.path ?? "";
  dom.loadProjectButton.disabled = false;
  dom.deleteProjectButton.disabled = false;
}

function renderProjectPanel() {
  dom.projectPanelBody.classList.toggle("card__body--collapsed", !state.projectPanelExpanded);
  dom.toggleProjectPanelButton.textContent = state.projectPanelExpanded ? "收起" : "展开";
  dom.toggleProjectPanelButton.setAttribute("aria-expanded", String(state.projectPanelExpanded));
}

function renderGrid() {
  dom.gridLayer.innerHTML = "";
  dom.pointLayer.innerHTML = "";
  dom.labelLayer.innerHTML = "";
  const points = snapPoints();

  gridValues.forEach((value, index) => {
    if (index > 0 && index < gridValues.length - 1) {
      const vertical = document.createElementNS("http://www.w3.org/2000/svg", "line");
      vertical.setAttribute("x1", value);
      vertical.setAttribute("y1", 0);
      vertical.setAttribute("x2", value);
      vertical.setAttribute("y2", 100);
      vertical.setAttribute("class", `guide-line${value === 50 ? " guide-line--center" : ""}`);
      dom.gridLayer.appendChild(vertical);

      const horizontal = document.createElementNS("http://www.w3.org/2000/svg", "line");
      horizontal.setAttribute("x1", 0);
      horizontal.setAttribute("y1", value);
      horizontal.setAttribute("x2", 100);
      horizontal.setAttribute("y2", value);
      horizontal.setAttribute("class", `guide-line${value === 50 ? " guide-line--center" : ""}`);
      dom.gridLayer.appendChild(horizontal);
    }
  });

  points.forEach((point) => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.dataset.pointId = point.id;
    circle.setAttribute("cx", point.x);
    circle.setAttribute("cy", point.y);
    circle.setAttribute("r", point.id === state.hoverPointId ? 1.16 : point.isDynamic ? 0.72 : 0.86);
    circle.setAttribute(
      "class",
      `grid-point${point.isDynamic ? " grid-point--dynamic" : ""}${point.id === state.hoverPointId ? " is-hover" : ""}`,
    );
    dom.pointLayer.appendChild(circle);
  });

  columnLabels.forEach((label, index) => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = label;
    text.setAttribute("x", gridValues[index]);
    text.setAttribute("y", -3.8);
    text.setAttribute("class", "grid-label");
    dom.labelLayer.appendChild(text);
  });

  rowLabels.forEach((label, index) => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = label;
    text.setAttribute("x", -3.8);
    text.setAttribute("y", gridValues[index] + 1.2);
    text.setAttribute("class", "grid-label");
    dom.labelLayer.appendChild(text);
  });
}

function applyLineStyle(line, assignment, options = {}) {
  const meta = assignmentMeta[assignment] ?? assignmentMeta.V;
  line.setAttribute("stroke", meta.stroke ?? "#3f78b8");
  line.setAttribute("stroke-dasharray", meta.dasharray ?? "");
  line.setAttribute("stroke-width", String(options.strokeWidth ?? 1.76));
}

function renderCreases() {
  dom.creaseLayer.innerHTML = "";
  const resolver = createResolver();

  const entries = allCreaseEntries();
  const orderedEntries = [
    ...entries.filter((entry) => !entry.isActiveStep),
    ...entries.filter((entry) => entry.isActiveStep),
  ];

  orderedEntries.forEach(({ step, crease, isActiveStep }) => {
    const segment = resolver.resolveCreaseSegment(crease);
    if (!segment) {
      return;
    }
    const [start, end] = segment;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.dataset.creaseId = crease.id;
    line.dataset.stepId = step.id;
    line.setAttribute("x1", start.x);
    line.setAttribute("y1", start.y);
    line.setAttribute("x2", end.x);
    line.setAttribute("y2", end.y);
    line.setAttribute(
      "class",
      [
        "crease-line",
        `crease-line--${assignmentMeta[crease.assignment].className}`,
        isActiveStep ? "is-active-step" : "is-muted",
        crease.id === state.selectedCreaseId ? "is-selected" : "",
      ].join(" ").trim(),
    );
    applyLineStyle(line, crease.assignment, {
      strokeWidth: crease.id === state.selectedCreaseId ? 2.44 : 1.76,
    });
    dom.creaseLayer.appendChild(line);
  });
}

function appendOverlayLine(layer, segment, className) {
  if (!segment) {
    return;
  }
  const [start, end] = segment;
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", start.x);
  line.setAttribute("y1", start.y);
  line.setAttribute("x2", end.x);
  line.setAttribute("y2", end.y);
  line.setAttribute("class", className);
  layer.appendChild(line);
}

function renderDraftLayer() {
  dom.selectionLayer.innerHTML = "";
  dom.draftLayer.innerHTML = "";

  if (state.drawMode === "axiom1") {
    const start = getPoint(state.drawingStartId);
    if (!start || !state.pointer.visible) {
      return;
    }
    appendOverlayLine(
      dom.draftLayer,
      [start, { x: state.pointer.x, y: state.pointer.y }],
      "draft-line",
    );
    return;
  }

  const { resolver, candidateMap } = lineSelectionState();
  const selectedCandidate = candidateMap.get(state.selectedLineKey);
  const hoverCandidate = candidateMap.get(state.hoverLineKey);

  if (hoverCandidate && hoverCandidate.key !== state.selectedLineKey) {
    appendOverlayLine(dom.selectionLayer, hoverCandidate.segment, "selection-line selection-line--hover");
  }

  if (selectedCandidate) {
    appendOverlayLine(dom.selectionLayer, selectedCandidate.segment, "selection-line selection-line--chosen");
  }

  if (!selectedCandidate || !hoverCandidate || selectedCandidate.key === hoverCandidate.key) {
    return;
  }

  const preview = buildAxiom3Solutions(
    selectedCandidate.ref,
    hoverCandidate.ref,
    resolver,
    state.pointer.visible ? state.pointer : null,
  );

  preview.solutions.forEach((solution) => {
    appendOverlayLine(
      dom.draftLayer,
      solution.segment,
      `draft-line${solution.index === preview.selectedIndex ? "" : " draft-line--secondary"}`,
    );
  });
}

function renderHover() {
  if (state.drawMode === "axiom3") {
    dom.hoverRing.classList.add("hidden");
    const { candidateMap } = lineSelectionState();
    const hoverCandidate = candidateMap.get(state.hoverLineKey);
    const selectedCandidate = candidateMap.get(state.selectedLineKey);

    if (selectedCandidate && hoverCandidate && selectedCandidate.key !== hoverCandidate.key) {
      dom.snapText.textContent = `参考线：${selectedCandidate.label} → ${hoverCandidate.label}`;
      return;
    }
    if (selectedCandidate) {
      dom.snapText.textContent = `已选参考线：${selectedCandidate.label}`;
      return;
    }
    if (hoverCandidate) {
      dom.snapText.textContent = `吸附到 ${hoverCandidate.label}`;
      return;
    }
    dom.snapText.textContent = "未吸附到参考线";
    return;
  }

  const hoverPoint = getPoint(state.hoverPointId);
  if (!hoverPoint) {
    dom.hoverRing.classList.add("hidden");
    dom.snapText.textContent = "未吸附到交点";
    return;
  }

  dom.hoverRing.classList.remove("hidden");
  dom.hoverRing.setAttribute("cx", hoverPoint.x);
  dom.hoverRing.setAttribute("cy", hoverPoint.y);
  dom.snapText.textContent = `吸附到 ${hoverPoint.id}`;
}

function renderStepList() {
  dom.stepList.innerHTML = "";
  dom.stepCount.textContent = `${state.steps.length} 步`;

  state.steps.forEach((step, index) => {
    const item = document.createElement("article");
    item.className = `step-item${step.id === state.activeStepId ? " is-active" : ""}`;

    const row = document.createElement("div");
    row.className = "step-item__row";

    const meta = document.createElement("div");
    meta.className = "step-item__meta";

    const nameInput = document.createElement("input");
    nameInput.className = "step-name-input";
    nameInput.value = step.name;
    nameInput.setAttribute("aria-label", `步骤 ${index + 1} 名称`);
    nameInput.addEventListener("input", (event) => {
      step.name = event.target.value.trimStart() || `步骤 ${index + 1}`;
      if (step.id === state.activeStepId) {
        renderTitles();
        renderStatus();
      }
    });
    nameInput.addEventListener("blur", (event) => {
      step.name = event.target.value.trim() || `步骤 ${index + 1}`;
      render();
    });

    const hint = document.createElement("p");
    hint.className = "step-item__hint";
    hint.textContent = `${step.creases.length} 条折痕`;

    meta.append(nameInput, hint);

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar-group";
    [
      { label: "↑", action: () => moveStep(index, -1), disabled: index === 0 },
      { label: "↓", action: () => moveStep(index, 1), disabled: index === state.steps.length - 1 },
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
      if (event.target.closest("button") || event.target === nameInput) {
        return;
      }
      selectStep(step.id);
    });
    dom.stepList.appendChild(item);
  });
}

function renderCreaseList() {
  dom.creaseList.innerHTML = "";
  const activeStep = getStep();
  const resolver = createResolver();
  if (!activeStep) {
    dom.creaseList.innerHTML = '<p class="empty-state">没有可编辑的步骤。</p>';
    return;
  }

  if (!activeStep.creases.length) {
    dom.creaseList.innerHTML = '<p class="empty-state">当前步骤还没有折痕，按当前模式在画布上添加即可。</p>';
    return;
  }

  activeStep.creases.forEach((crease, index) => {
    const item = document.createElement("article");
    item.className = `crease-item${crease.id === state.selectedCreaseId ? " is-active" : ""}`;

    const row = document.createElement("div");
    row.className = "crease-item__row";

    const meta = document.createElement("div");
    meta.className = "crease-item__meta";
    const summary = crease.mode === "axiom3"
      ? `${lineRefLabel(crease.lineRefs?.[0], resolver)} → ${lineRefLabel(crease.lineRefs?.[1], resolver)}`
      : `${pointLabel(crease.startId)} → ${pointLabel(crease.endId)}`;
    const modeLabel = DRAW_MODE_META[crease.mode ?? "axiom1"]?.label ?? DRAW_MODE_META.axiom1.label;
    meta.innerHTML = `
      <strong>折痕 ${index + 1}</strong>
      <p class="crease-item__hint">${summary}</p>
      <div class="toolbar-group">
        <span class="mode-badge">${modeLabel}</span>
        <span class="assignment-badge assignment-badge--${assignmentMeta[crease.assignment].className}">
          ${assignmentMeta[crease.assignment].label}
        </span>
      </div>
    `;

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar-group";
    [
      { label: assignmentMeta[crease.assignment].label, action: () => toggleCreaseAssignment(crease.id) },
      { label: "重绘", action: () => startCreaseEditing(crease.id) },
      { label: "↑", action: () => moveCrease(index, -1), disabled: index === 0 },
      { label: "↓", action: () => moveCrease(index, 1), disabled: index === activeStep.creases.length - 1 },
      { label: "删", action: () => deleteCrease(crease.id) },
    ].forEach(({ label, action, disabled }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button--ghost";
      button.textContent = label;
      button.disabled = Boolean(disabled);
      button.addEventListener("click", action);
      toolbar.appendChild(button);
    });

    row.append(meta, toolbar);
    item.appendChild(row);
    item.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      selectCrease(crease.id);
    });
    dom.creaseList.appendChild(item);
  });
}

function renderTitles() {
  const activeStep = getStep();
  dom.activeStepName.textContent = activeStep?.name ?? "未选择步骤";
}

function renderStatus() {
  const activeStep = getStep();
  const stepName = activeStep?.name ?? "当前步骤";
  const draftLabel = assignmentMeta[state.pendingAssignment].label;
  const drawModeLabel = DRAW_MODE_META[state.drawMode].label;

  if (state.drawMode === "axiom3") {
    const { candidateMap } = lineSelectionState();
    const selectedCandidate = candidateMap.get(state.selectedLineKey);
    if (state.editingCreaseId) {
      dom.statusText.textContent = selectedCandidate
        ? `正在重绘 ${stepName} 的折痕：已选 ${selectedCandidate.label}，继续选择第二条参考线生成 ${draftLabel}。`
        : `正在重绘 ${stepName} 的折痕：使用 ${drawModeLabel} 依次选择两条参考线。`;
      return;
    }
    if (selectedCandidate) {
      dom.statusText.textContent = `已选中 ${selectedCandidate.label}，继续选择第二条参考线生成 ${draftLabel}。`;
      return;
    }
    dom.statusText.textContent = `当前为 ${stepName}，使用 ${drawModeLabel} 选择两条参考线生成中间折痕。`;
    return;
  }

  if (state.editingCreaseId) {
    dom.statusText.textContent = state.drawingStartId
      ? `正在重绘 ${stepName} 的折痕：选择第二个交点完成修改。`
      : `正在重绘 ${stepName} 的折痕：先选择第一个交点。`;
    return;
  }

  if (state.drawingStartId) {
    dom.statusText.textContent = `已选中 ${state.drawingStartId}，继续选择第二个交点完成 ${draftLabel}。`;
    return;
  }

  dom.statusText.textContent = `当前为 ${stepName}，点击两个交点即可添加 ${draftLabel}。`;
}

function renderButtons() {
  dom.deleteStepButton.disabled = state.steps.length === 0;
  dom.cancelDrawingButton.disabled = !state.drawingStartId && !state.selectedLineKey && !state.editingCreaseId;
  dom.framesPerStepInput.value = String(state.framesPerStep);

  [
    { button: dom.modeAxiom1Button, mode: "axiom1" },
    { button: dom.modeAxiom3Button, mode: "axiom3" },
  ].forEach(({ button, mode }) => {
    button.className = `button button--ghost button--mode${state.drawMode === mode ? " is-active" : ""}`;
  });

  [
    { button: dom.draftValleyButton, assignment: "V", className: "valley" },
    { button: dom.draftMountainButton, assignment: "M", className: "mountain" },
    { button: dom.draftAuxButton, assignment: "F", className: "aux" },
  ].forEach(({ button, assignment, className }) => {
    button.className = `button button--ghost button--assignment is-${className}${
      state.pendingAssignment === assignment ? " is-active" : ""
    }`;
  });
}

function showPreviewMessage(message) {
  dom.previewStage.innerHTML = `<p class="preview-empty">${message}</p>`;
}

function buildPreviewGraph() {
  return buildReplayState().graph;
}

function tryFoldGraph(graph) {
  if (!graph || !graph.edges_vertices?.length) {
    return null;
  }

  const tryMethods = [
    () => graph.clone().flatFolded(),
    () => graph.clone().flatFolded(0),
    () => graph.clone().folded(),
    () => graph.clone().folded(0),
  ];

  for (const attempt of tryMethods) {
    try {
      const folded = attempt();
      if (!folded) {
        continue;
      }
      folded.frame_classes = Array.from(
        new Set([...(folded.frame_classes || []), "foldedState"]),
      );
      if (ear.layer?.solver && folded.faces_vertices?.length) {
        try {
          folded.faces_layer = ear.layer.solver(folded).facesLayer();
        } catch (error) {
          // Layer solving is best-effort.
        }
      }
      return folded;
    } catch (error) {
      continue;
    }
  }

  return null;
}

function stylePreviewDrawing(svg) {
  if (!svg) {
    return;
  }

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
    svg.querySelectorAll(".edges .flat").forEach((node) => node.setAttribute("stroke", "#bcc6d6"));
  } catch (error) {
    // If Rabbit Ear changes its style API, keep raw render visible.
  }
}

function renderFoldPreview() {
  const creases = previewCreases();
  if (!creases.length) {
    dom.previewNote.textContent = "当前步骤之前还没有累计折痕。";
    showPreviewMessage("先在左侧画布添加折痕，这里会显示 Rabbit Ear 顺序折叠预览。");
    return;
  }

  try {
    const graph = buildPreviewGraph();
    const folded = tryFoldGraph(graph);
    const renderGraph = folded || graph;
    const svg = ear.svg();
    svg.origami(renderGraph, {
      viewBox: true,
      strokeWidth: 0.03,
      radius: 0.014,
      padding: 0.12,
    });

    svg.classList.add("preview-svg");
    stylePreviewDrawing(svg);
    dom.previewStage.innerHTML = "";
    dom.previewStage.appendChild(svg);
    dom.previewNote.textContent = folded
      ? `预览当前步骤之前的累计折叠结果，共 ${creases.length} 条折痕。`
      : `当前折痕未能稳定求解层级，右侧显示折痕图预览，共 ${creases.length} 条折痕。`;
  } catch (error) {
    dom.previewNote.textContent = "Rabbit Ear 预览构建失败。";
    showPreviewMessage(`预览失败：${error.message}`);
  }
}

function render() {
  renderProjectStatus();
  renderProjectPanel();
  renderProjectList();
  renderGrid();
  renderCreases();
  renderDraftLayer();
  renderHover();
  renderStepList();
  renderCreaseList();
  renderTitles();
  renderStatus();
  renderButtons();
  renderFoldPreview();
}

function selectStep(stepId) {
  state.activeStepId = stepId;
  state.selectedCreaseId = "";
  resetDraftSelection({ keepEditing: false });
  render();
}

function selectCrease(creaseId) {
  const entry = getCreaseEntry(creaseId);
  if (!entry) {
    return;
  }
  state.activeStepId = entry.step.id;
  state.selectedCreaseId = creaseId;
  resetDraftSelection({ keepEditing: false });
  render();
}

function startCreaseEditing(creaseId) {
  const entry = getCreaseEntry(creaseId);
  if (!entry) {
    return;
  }
  state.activeStepId = entry.step.id;
  state.selectedCreaseId = creaseId;
  state.drawMode = entry.crease.mode ?? "axiom1";
  state.pendingAssignment = entry.crease.assignment;
  state.editingCreaseId = creaseId;
  resetDraftSelection();
  state.editingCreaseId = creaseId;
  render();
}

function addStep() {
  const step = {
    id: makeId("step"),
    name: `步骤 ${state.steps.length + 1}`,
    creases: [],
  };
  state.steps.push(step);
  state.activeStepId = step.id;
  state.selectedCreaseId = "";
  resetDraftSelection({ keepEditing: false });
  render();
}

function deleteStep() {
  const index = selectedStepIndex();
  if (index < 0) {
    return;
  }

  state.steps.splice(index, 1);
  if (!state.steps.length) {
    const project = createBlankProject(state.projectName);
    state.steps = project.steps;
  }

  const nextIndex = Math.min(index, state.steps.length - 1);
  state.activeStepId = state.steps[nextIndex].id;
  state.selectedCreaseId = "";
  resetDraftSelection({ keepEditing: false });
  render();
}

function moveStep(index, offset) {
  state.steps = moveItem(state.steps, index, offset);
  render();
}

function moveCrease(index, offset) {
  const activeStep = getStep();
  if (!activeStep) {
    return;
  }
  activeStep.creases = moveItem(activeStep.creases, index, offset);
  render();
}

function toggleCreaseAssignment(creaseId) {
  const entry = getCreaseEntry(creaseId);
  if (!entry) {
    return;
  }
  entry.crease.assignment = nextAssignment(entry.crease.assignment);
  state.activeStepId = entry.step.id;
  state.selectedCreaseId = creaseId;
  render();
}

function deleteCrease(creaseId) {
  const activeStep = getStep();
  if (!activeStep) {
    return;
  }
  activeStep.creases = activeStep.creases.filter((crease) => crease.id !== creaseId);
  if (state.selectedCreaseId === creaseId) {
    state.selectedCreaseId = "";
  }
  if (state.editingCreaseId === creaseId) {
    cancelDrawing();
  } else {
    render();
  }
}

function setPendingAssignment(assignment) {
  state.pendingAssignment = assignment;
  renderButtons();
  renderStatus();
}

function setDrawMode(mode) {
  if (!DRAW_MODE_META[mode]) {
    return;
  }
  state.drawMode = mode;
  resetDraftSelection();
  if (state.editingCreaseId) {
    state.selectedCreaseId = state.editingCreaseId;
  }
  render();
}

function completeCrease(creaseData) {
  const activeStep = getStep();
  if (!activeStep) {
    return;
  }

  const { graph, resolver } = buildReplayState();
  const scopeFaceIds = captureCreaseScope(graph, resolver, {
    assignment: state.pendingAssignment,
    ...creaseData,
  });

  const nextCrease = {
    id: state.editingCreaseId || makeId("crease"),
    assignment: state.pendingAssignment,
    scopeFaceIds,
    ...creaseData,
  };

  if (state.editingCreaseId) {
    const index = activeStep.creases.findIndex((crease) => crease.id === state.editingCreaseId);
    if (index >= 0) {
      activeStep.creases[index] = nextCrease;
    }
    state.selectedCreaseId = state.editingCreaseId;
  } else {
    activeStep.creases.push(nextCrease);
    state.selectedCreaseId = nextCrease.id;
  }

  resetDraftSelection({ keepEditing: false });
  render();
}

function cancelDrawing() {
  resetDraftSelection({ keepEditing: false });
  render();
}

function svgPointFromEvent(event) {
  const point = dom.paper.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(dom.paper.getScreenCTM().inverse());
  return { x: transformed.x, y: transformed.y };
}

// 画布坐标固定为 100x100，吸附阈值随 SVG 实际像素宽度动态换算。
function nearestSnapPoint(position) {
  const rect = dom.paper.getBoundingClientRect();
  const snapDistance = (100 / rect.width) * snapDistancePx;
  let nearestPoint = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  snapPoints().forEach((point) => {
    const distance = Math.hypot(position.x - point.x, position.y - point.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPoint = point;
    }
  });

  return nearestDistance <= snapDistance ? nearestPoint : null;
}

function commitPoint(pointId) {
  if (state.drawMode !== "axiom1") {
    return;
  }

  if (!state.drawingStartId) {
    state.drawingStartId = pointId;
    render();
    return;
  }

  if (state.drawingStartId === pointId) {
    return;
  }

  completeCrease({
    mode: "axiom1",
    startId: state.drawingStartId,
    endId: pointId,
  });
}

function commitLine(lineKey) {
  if (state.drawMode !== "axiom3") {
    return;
  }

  const { resolver, candidateMap } = lineSelectionState();
  const candidate = candidateMap.get(lineKey);
  if (!candidate) {
    return;
  }

  if (!state.selectedLineKey) {
    state.selectedLineKey = lineKey;
    render();
    return;
  }

  if (state.selectedLineKey === lineKey) {
    return;
  }

  const firstCandidate = candidateMap.get(state.selectedLineKey);
  if (!firstCandidate) {
    state.selectedLineKey = "";
    render();
    return;
  }

  const preview = buildAxiom3Solutions(
    firstCandidate.ref,
    candidate.ref,
    resolver,
    state.pointer.visible ? state.pointer : null,
  );
  if (!preview.solutions.length) {
    setProjectStatus("公理3 在这两条参考线之间没有可用解。", "danger");
    return;
  }

  completeCrease({
    mode: "axiom3",
    lineRefs: [firstCandidate.ref, candidate.ref],
    solutionIndex: preview.selectedIndex,
  });
}

function bindCanvasEvents() {
  dom.paper.addEventListener("pointermove", (event) => {
    state.pointer = { ...svgPointFromEvent(event), visible: true };
    if (state.drawMode === "axiom3") {
      const candidate = nearestLineCandidate(state.pointer, lineSelectionState().candidates);
      state.hoverLineKey = candidate?.key ?? "";
      state.hoverPointId = "";
    } else {
      state.hoverPointId = nearestSnapPoint(state.pointer)?.id ?? "";
      state.hoverLineKey = "";
    }
    renderGrid();
    renderDraftLayer();
    renderHover();
  });

  dom.paper.addEventListener("pointerleave", () => {
    state.pointer.visible = false;
    state.hoverPointId = "";
    state.hoverLineKey = "";
    renderGrid();
    renderDraftLayer();
    renderHover();
  });

  dom.paper.addEventListener("click", () => {
    if (state.drawMode === "axiom3" && state.hoverLineKey) {
      commitLine(state.hoverLineKey);
      return;
    }
    if (state.hoverPointId) {
      commitPoint(state.hoverPointId);
    }
  });

  dom.creaseLayer.addEventListener("click", (event) => {
    const creaseId = event.target.dataset.creaseId;
    if (!creaseId) {
      return;
    }
    if (state.drawMode === "axiom3") {
      return;
    }
    event.stopPropagation();
    selectCrease(creaseId);
  });
}

function bindControls() {
  dom.projectNameInput.addEventListener("input", (event) => {
    state.projectName = event.target.value.trimStart() || "untitled";
  });
  dom.projectSelect.addEventListener("change", (event) => {
    state.selectedProjectName = event.target.value;
    renderProjectList();
  });
  dom.framesPerStepInput.addEventListener("change", (event) => {
    const parsed = Number.parseInt(event.target.value, 10);
    state.framesPerStep = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FRAMES_PER_STEP;
    dom.framesPerStepInput.value = String(state.framesPerStep);
  });
  dom.toggleProjectPanelButton.addEventListener("click", () => {
    state.projectPanelExpanded = !state.projectPanelExpanded;
    renderProjectPanel();
  });
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
  dom.saveProjectButton.addEventListener("click", saveProject);
  dom.refreshProjectsButton.addEventListener("click", refreshProjects);
  dom.exportTrajectoryButton.addEventListener("click", exportTrajectory);
  dom.addStepButton.addEventListener("click", addStep);
  dom.deleteStepButton.addEventListener("click", deleteStep);
  dom.cancelDrawingButton.addEventListener("click", cancelDrawing);
  dom.modeAxiom1Button.addEventListener("click", () => setDrawMode("axiom1"));
  dom.modeAxiom3Button.addEventListener("click", () => setDrawMode("axiom3"));
  dom.draftValleyButton.addEventListener("click", () => setPendingAssignment("V"));
  dom.draftMountainButton.addEventListener("click", () => setPendingAssignment("M"));
  dom.draftAuxButton.addEventListener("click", () => setPendingAssignment("F"));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      cancelDrawing();
    }
  });
}

async function init() {
  state.projectStatus = "项目未保存";
  dom.projectNameInput.value = state.projectName;
  dom.framesPerStepInput.value = String(state.framesPerStep);
  bindCanvasEvents();
  bindControls();
  render();
  await refreshProjects();
}

init();
