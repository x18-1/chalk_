import {
  Axes, Circle, Dot, Ellipse, FocusOn, FunctionGraph, Indicate, Line, Polygon, renderLatexToSVG, RightAngle, Scene, Text, ValueTracker,
  type Mobject,
} from "manim-web";

import evaluationResults from "./evaluation-results.json";
import fallbackFixture from "../fixtures/doubled-median.json";
import {
  evaluateGeometryScene,
  geometrySceneSchema,
  lessonTimelineSchema,
  type GeometryObject,
  type GeometryScene,
  type LessonTimeline,
  type Point2D,
  type RightAngleMarker,
} from "../src/geometry";
import { hitTestWorldPoint, screenToWorld, type DragViewport } from "./drag";
import type { GeoGebraScript } from "../src/geogebra";
import { executeGeoGebraScript, type GeoGebraApi } from "../src/geogebra-runtime";

declare global {
  interface Window {
    GGBApplet?: new (parameters: Record<string, unknown>, html5?: boolean) => { inject(elementId: string): void };
  }
}

type EvaluationRecord = {
  id: string;
  index: number;
  text: string;
  imageFile?: string;
  status: "completed" | "failed";
  stage1?: unknown;
  artifact?: { scene?: unknown; geoGebra?: GeoGebraScript; geoGebraSource?: string; lessonTimeline?: unknown; diagnostics?: unknown; problemFacts?: unknown };
  error?: string;
};

const fallbackRecord: EvaluationRecord = {
  id: "fixture-doubled-median",
  index: 0,
  text: fallbackFixture.problem,
  status: "completed",
  artifact: { scene: fallbackFixture.scene, lessonTimeline: fallbackFixture.lessonTimeline },
};
const records: EvaluationRecord[] = evaluationResults.cases.length > 0
  ? evaluationResults.cases as EvaluationRecord[]
  : [fallbackRecord];
const container = document.querySelector<HTMLDivElement>("#scene-container");
if (!container) throw new Error("Scene container is missing");
const scene = new Scene(container, { backgroundColor: "#202c27", frameWidth: 14, frameHeight: 8, autoResize: true });
const objects = new Map<string, Mobject>();
const labels = new Map<string, Text>();
const markers = new Map<string, RightAngle>();
const drawableIds: string[] = [];
const motionTrackers = new Map<string, ValueTracker>();
const draggedCoordinates = new Map<string, Point2D>();
let dragEnabled = false;
let activeDragId: string | undefined;
let activePointerId: number | undefined;
let sceneData: GeometryScene | undefined;
let evaluation: ReturnType<typeof evaluateGeometryScene> | undefined;
let timeline: LessonTimeline | undefined;
let activeRecord = records[0]!;
let busy = false;

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;" })[character]!);
}

function renderMarkdown(value: string): string {
  const escaped = escapeHtml(value.trim());
  const blocks = escaped.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`).join("")}</ul>`;
    }
    const heading = lines.length === 1 ? lines[0]!.match(/^#{1,3}\s+(.+)$/) : undefined;
    if (heading) return `<h3>${heading[1]}</h3>`;
    return `<p>${lines.join("<br />")}</p>`;
  }).join("");
  return blocks
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\$([^$\n]+)\$/g, '<span class="math-inline">$1</span>');
}

function displayPointLabel(id: string): string {
  const match = id.match(/^(?:point|midpoint|reflection|intersection)_(.+)$/);
  return match?.[1] ?? id;
}

async function hydrateMath(container: Element) {
  const spans = Array.from(container.querySelectorAll<HTMLElement>(".math-inline"));
  await Promise.all(spans.map(async (span) => {
    const latex = span.textContent ?? "";
    try {
      const rendered = await renderLatexToSVG(latex, { displayMode: false, color: "#1d2823" });
      span.innerHTML = rendered.svgString;
    } catch {
      span.textContent = latex;
    }
  }));
}
const point = (id: string, evaluationOverride = evaluation): Point2D => {
  const value = evaluationOverride?.points[id];
  if (!value) throw new Error(`Point ${id} was not evaluated`);
  return value;
};
const tuple = (value: Point2D): [number, number, number] => [value.x, value.y, 0];
const axesObject = () => sceneData?.objects.find((object) => object.kind === "axes");
const visualTupleAt = (value: Point2D, evaluationOverride = evaluation): [number, number, number] => {
  const axes = axesObject();
  const mobject = axes ? objects.get(axes.id) : undefined;
  return mobject && "coordsToPoint" in mobject
    ? (mobject as Axes).coordsToPoint(value.x, value.y) as [number, number, number]
    : tuple(value);
};
const visualTuple = (value: Point2D): [number, number, number] => visualTupleAt(value);

function coordinatesFromWorld(world: [number, number, number]): Point2D {
  const axes = axesObject();
  const axesMobject = axes ? objects.get(axes.id) : undefined;
  if (axesMobject && axesMobject instanceof Axes) {
    const [x, y] = axesMobject.pointToCoords(world);
    return { x, y };
  }
  return { x: world[0], y: world[1] };
}

function dragViewport(): DragViewport {
  const canvas = scene.getCanvas();
  const rect = canvas.getBoundingClientRect();
  const cameraPosition = scene.camera.position;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    frameWidth: scene.camera.frameWidth,
    frameHeight: scene.camera.frameHeight,
    centerX: cameraPosition.x,
    centerY: cameraPosition.y,
  };
}

function pointerCoordinates(event: PointerEvent): Point2D {
  const viewport = dragViewport();
  const world = screenToWorld(event.clientX, event.clientY, viewport);
  return coordinatesFromWorld([world.x, world.y, 0]);
}

function projectDraggedPoint(object: Extract<GeometryObject, { kind: "point" }>, value: Point2D): Point2D {
  const motion = object.motion;
  if (!motion) return value;
  if (motion.kind === "segment") {
    const path = sceneData?.objects.find((candidate) => candidate.id === motion.path);
    if (path?.kind === "segment") {
      const a = point(path.points[0]);
      const b = point(path.points[1]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const denominator = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((value.x - a.x) * dx + (value.y - a.y) * dy) / denominator));
      return { x: a.x + dx * t, y: a.y + dy * t };
    }
  }
  if (motion.kind === "ellipse") {
    const angle = Math.atan2((value.y - motion.center.y) / motion.radiusY, (value.x - motion.center.x) / motion.radiusX);
    const start = motion.startAngle;
    const end = motion.endAngle;
    const normalized = end >= start ? Math.max(start, Math.min(end, angle)) : Math.max(end, Math.min(start, angle));
    return { x: motion.center.x + motion.radiusX * Math.cos(normalized), y: motion.center.y + motion.radiusY * Math.sin(normalized) };
  }
  if (motion.kind === "parabola") {
    const curve = sceneData?.objects.find((candidate) => candidate.id === motion.curve);
    if (curve?.kind === "parabola") {
      const x = Math.max(Math.min(motion.xRange[1], value.x), motion.xRange[0]);
      return { x, y: curve.a * x * x + curve.b * x + curve.c };
    }
    return value;
  }
  if (motion.kind !== "linear") return value;
  const dx = motion.to.x - object.x;
  const dy = motion.to.y - object.y;
  const denominator = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((value.x - object.x) * dx + (value.y - object.y) * dy) / denominator));
  return { x: object.x + dx * t, y: object.y + dy * t };
}

function lineEndpoints(line: { point: Point2D; direction: Point2D }): [Point2D, Point2D] {
  const magnitude = Math.hypot(line.direction.x, line.direction.y);
  const unit = { x: line.direction.x / magnitude, y: line.direction.y / magnitude };
  return [
    { x: line.point.x - unit.x * 6, y: line.point.y - unit.y * 6 },
    { x: line.point.x + unit.x * 6, y: line.point.y + unit.y * 6 },
  ];
}

function buildMobject(object: GeometryObject): Mobject | undefined {
  if (["point", "midpoint", "reflection", "intersection"].includes(object.kind)) {
    return new Dot({ point: visualTuple(point(object.id)), color: object.kind === "point" ? "#d8b16d" : "#59ad89", radius: object.kind === "point" ? 0.11 : 0.09 });
  }
  if (object.kind === "segment") {
    const [start, end] = object.points.map((id) => point(id));
    return new Line({ start: visualTuple(start!), end: visualTuple(end!), color: "#f0f1ed", strokeWidth: 3 });
  }
  if (["line", "parallel_line", "perpendicular_line"].includes(object.kind)) {
    const line = evaluation?.lines[object.id];
    if (!line) return undefined;
    if (object.kind === "line" && sceneData?.objects.some((candidate) => candidate.kind === "segment" && ((candidate.points[0] === object.points[0] && candidate.points[1] === object.points[1]) || (candidate.points[0] === object.points[1] && candidate.points[1] === object.points[0])))) return undefined;
    if (object.kind === "line" && axesObject()) {
      const [first, second] = object.points.map((id) => point(id));
      if ((Math.abs(first!.x) < 1e-8 && Math.abs(second!.x) < 1e-8) || (Math.abs(first!.y) < 1e-8 && Math.abs(second!.y) < 1e-8)) return undefined;
    }
    const [start, end] = lineEndpoints(line);
    return new Line({ start: visualTuple(start), end: visualTuple(end), color: "#9fcdb8", strokeWidth: 2 });
  }
  if (object.kind === "circle") return new Circle({ radius: object.radius, center: visualTuple(point(object.center)), color: "#d8b16d", strokeWidth: 2 });
  if (object.kind === "ellipse") return new Ellipse({ width: object.radiusX * 2, height: object.radiusY * 2, center: visualTuple(point(object.center)), color: "#d8b16d", strokeWidth: 2 });
  if (object.kind === "parabola") {
    const axes = axesObject();
    const axesMobject = axes ? objects.get(axes.id) as Axes | undefined : undefined;
    return new FunctionGraph({ func: (x) => object.a * x * x + object.b * x + object.c, xRange: object.xRange, axes: axesMobject });
  }
  if (object.kind === "polygon") return new Polygon({ vertices: object.points.map((id) => visualTuple(point(id))), color: "#9fcdb8", fillOpacity: 0.12, strokeWidth: 2 });
  if (object.kind === "axes") return new Axes({ xRange: object.xRange, yRange: object.yRange, xLength: object.xLength ?? 10, yLength: object.yLength ?? 6, tips: object.tips ?? true, color: "#9fcdb8" });
  return undefined;
}

function markerArmPoint(marker: RightAngleMarker, armId: string, vertex: Point2D, evaluationOverride = evaluation): Point2D {
  const arm = sceneData?.objects.find((object) => object.id === armId);
  if (!arm) throw new Error(`Right-angle marker ${marker.id} references an unknown arm`);
  if (arm.kind === "segment") {
    const [firstId, secondId] = arm.points;
    const first = point(firstId, evaluationOverride);
    const second = point(secondId, evaluationOverride);
    if (Math.hypot(first.x - vertex.x, first.y - vertex.y) <= 1e-8) return second;
    if (Math.hypot(second.x - vertex.x, second.y - vertex.y) <= 1e-8) return first;
    return Math.hypot(first.x - vertex.x, first.y - vertex.y) < Math.hypot(second.x - vertex.x, second.y - vertex.y) ? first : second;
  }
  const line = evaluationOverride?.lines[arm.id];
  if (!line) throw new Error(`Right-angle marker ${marker.id} references an unevaluated arm`);
  const magnitude = Math.hypot(line.direction.x, line.direction.y);
  return { x: vertex.x + line.direction.x / magnitude, y: vertex.y + line.direction.y / magnitude };
}

function buildMarker(marker: RightAngleMarker, evaluationOverride = evaluation): RightAngle {
  const vertex = point(marker.vertex, evaluationOverride);
  const first = markerArmPoint(marker, marker.arms[0], vertex, evaluationOverride);
  const second = markerArmPoint(marker, marker.arms[1], vertex, evaluationOverride);
  return new RightAngle({ points: [visualTupleAt(first, evaluationOverride), visualTupleAt(vertex, evaluationOverride), visualTupleAt(second, evaluationOverride)] }, { size: marker.size ?? 0.3, color: "#d8b16d", strokeWidth: 3 });
}

function fitCameraToScene() {
  if (!sceneData || !evaluation) return;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (x: number, y: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  for (const value of Object.values(evaluation.points)) include(value.x, value.y);
  for (const object of sceneData.objects) {
    if (object.kind === "circle") {
      const center = evaluation.points[object.center];
      if (center) { include(center.x - object.radius, center.y - object.radius); include(center.x + object.radius, center.y + object.radius); }
    } else if (object.kind === "ellipse") {
      const center = evaluation.points[object.center];
      if (center) { include(center.x - object.radiusX, center.y - object.radiusY); include(center.x + object.radiusX, center.y + object.radiusY); }
    } else if (object.kind === "parabola") {
      const [start, end] = object.xRange;
      include(start, object.a * start * start + object.b * start + object.c);
      include(end, object.a * end * end + object.b * end + object.c);
      if (Math.abs(object.a) > 1e-12) {
        const vertexX = -object.b / (2 * object.a);
        if (vertexX >= start && vertexX <= end) include(vertexX, object.a * vertexX * vertexX + object.b * vertexX + object.c);
      }
    } else if (object.kind === "axes") {
      include(object.xRange[0], object.yRange[0]);
      include(object.xRange[1], object.yRange[1]);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
  const aspect = Math.max(0.5, scene.getCanvas().getBoundingClientRect().width / Math.max(1, scene.getCanvas().getBoundingClientRect().height));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const cameraPosition = scene.camera.position;
  scene.camera.moveTo([(minX + maxX) / 2, (minY + maxY) / 2, cameraPosition.z]);
  scene.camera.frameHeight = Math.max(8, spanY * 1.25, spanX * 1.25 / aspect);
}

function renderGeoGebra(script: GeoGebraScript) {
  const host = $("#geogebra-container");
  host.innerHTML = "";
  host.removeAttribute("hidden");
  $("#scene-container").setAttribute("hidden", "true");
  if (!window.GGBApplet) {
    host.textContent = "GeoGebra 加载失败，请检查网络连接或刷新页面。";
    return;
  }
  const id = `ggb-${Date.now()}`;
  const mount = document.createElement("div");
  mount.id = id;
  host.append(mount);
  const applet = new window.GGBApplet({
    appName: script.mode === "3D" ? "3d" : "classic",
    width: Math.max(640, host.clientWidth || 900),
    height: Math.max(420, host.clientHeight || 560),
    showToolBar: false,
    showAlgebraInput: false,
    showMenuBar: false,
    showResetIcon: true,
    enableLabelDrags: true,
    appletOnLoad(api: GeoGebraApi) {
      const results = executeGeoGebraScript(api, script);
      const failed = results.find((result) => !result.ok);
      const errorBox = $("#error-box");
      if (failed) {
        errorBox.textContent = `GeoGebra 第 ${failed.index + 1} 条命令执行失败：${failed.command}${failed.error ? `\n${failed.error}` : ""}`;
        errorBox.removeAttribute("hidden");
        $("#status-text").textContent = "GeoGebra 构造存在错误";
        $("#status-dot").classList.remove("busy");
      } else {
        errorBox.textContent = "";
        errorBox.setAttribute("hidden", "true");
        $("#status-text").textContent = "GeoGebra 场景已加载";
      }
    },
  }, true);
  applet.inject(id);
}

function motionCoordinate(object: Extract<GeometryObject, { kind: "point" }>, t: number): Point2D {
  const motion = object.motion!;
  if (motion.kind === "linear") {
    return { x: object.x + (motion.to.x - object.x) * t, y: object.y + (motion.to.y - object.y) * t };
  }
  if (motion.kind === "segment") {
    const path = sceneData?.objects.find((candidate) => candidate.id === motion.path);
    if (!path || path.kind !== "segment") return { x: object.x, y: object.y };
    const first = point(path.points[0]);
    const second = point(path.points[1]);
    return { x: first.x + (second.x - first.x) * t, y: first.y + (second.y - first.y) * t };
  }
  if (motion.kind === "parabola") {
    const curve = sceneData?.objects.find((candidate) => candidate.id === motion.curve);
    const x = motion.xRange[0] + (motion.xRange[1] - motion.xRange[0]) * t;
    return curve?.kind === "parabola" ? { x, y: curve.a * x * x + curve.b * x + curve.c } : { x: object.x, y: object.y };
  }
  return {
    x: motion.center.x + motion.radiusX * Math.cos(motion.startAngle + (motion.endAngle - motion.startAngle) * t),
    y: motion.center.y + motion.radiusY * Math.sin(motion.startAngle + (motion.endAngle - motion.startAngle) * t),
  };
}

function updateDynamicDependents() {
  if (!sceneData || !evaluation || (motionTrackers.size === 0 && draggedCoordinates.size === 0)) return;
  const dynamicObjects = sceneData.objects.map((object) => {
    if (object.kind !== "point" || !object.motion) return object;
    const dragged = draggedCoordinates.get(object.id);
    if (dragged) return { ...object, x: dragged.x, y: dragged.y, motion: undefined };
    const t = motionTrackers.get(object.id)?.getValue() ?? 0;
    const value = motionCoordinate(object, t);
    return { ...object, x: value.x, y: value.y, motion: undefined };
  });
  const dynamicEvaluation = evaluateGeometryScene({ ...sceneData, objects: dynamicObjects });
  if (dynamicEvaluation.diagnostics.length > 0) return;
  evaluation = dynamicEvaluation;
  for (const object of dynamicObjects) {
    const mobject = objects.get(object.id);
    if (!mobject) continue;
    if (["point", "midpoint", "reflection", "intersection"].includes(object.kind)) {
      const value = dynamicEvaluation.points[object.id];
      if (value) mobject.moveTo(visualTupleAt(value, dynamicEvaluation));
    } else if (object.kind === "segment") {
      const line = mobject as Line;
      line.setStart(visualTupleAt(dynamicEvaluation.points[object.points[0]]!, dynamicEvaluation));
      line.setEnd(visualTupleAt(dynamicEvaluation.points[object.points[1]]!, dynamicEvaluation));
    } else if (["line", "parallel_line", "perpendicular_line"].includes(object.kind)) {
      const lineValue = dynamicEvaluation.lines[object.id];
      if (!lineValue) continue;
      const [start, end] = lineEndpoints(lineValue);
      const line = mobject as Line;
      line.setStart(visualTupleAt(start, dynamicEvaluation));
      line.setEnd(visualTupleAt(end, dynamicEvaluation));
    } else if (object.kind === "polygon") {
      (mobject as Polygon).setVertices(object.points.map((id) => visualTupleAt(dynamicEvaluation.points[id]!, dynamicEvaluation)));
    }
  }
  for (const object of dynamicObjects) {
    if (!["point", "midpoint", "reflection", "intersection"].includes(object.kind)) continue;
    const label = labels.get(object.id);
    const value = dynamicEvaluation.points[object.id];
    if (label && value) {
      const position = visualTupleAt(value, dynamicEvaluation);
      label.moveTo([position[0] + 0.18, position[1] + 0.18, position[2]]);
    }
  }
  for (const marker of sceneData.markers ?? []) {
    const markerMobject = markers.get(marker.id);
    if (markerMobject) markerMobject.become(buildMarker(marker, dynamicEvaluation));
  }
  showAssertions();
}

function renderLabels() {
  if (!sceneData) return;
  labels.clear();
  const labelMobjects = sceneData.objects.filter((object) => ["point", "midpoint", "reflection", "intersection"].includes(object.kind)).map((object) => {
    const label = new Text({ text: displayPointLabel(object.id), fontSize: 24, color: "#f4e6ca" });
    const position = visualTuple(point(object.id));
    label.moveTo([position[0] + 0.18, position[1] + 0.18, position[2]]);
    labels.set(object.id, label);
    return label;
  });
  scene.add(...labelMobjects);
}

function renderCase() {
  scene.stop();
  scene.clear();
  $("#geogebra-container").innerHTML = "";
  $("#scene-container").removeAttribute("hidden");
  $("#geogebra-container").setAttribute("hidden", "true");
  objects.clear();
  labels.clear();
  markers.clear();
  motionTrackers.clear();
  draggedCoordinates.clear();
  activeDragId = undefined;
  activePointerId = undefined;
  drawableIds.length = 0;
  if (activeRecord.artifact?.geoGebra) renderGeoGebra(activeRecord.artifact.geoGebra);
  const parsed = !activeRecord.artifact?.geoGebra && activeRecord.artifact?.scene ? geometrySceneSchema.safeParse(activeRecord.artifact.scene) : undefined;
  sceneData = parsed?.success ? parsed.data : undefined;
  evaluation = sceneData ? evaluateGeometryScene(sceneData) : undefined;
  fitCameraToScene();
  const parsedTimeline = activeRecord.artifact?.lessonTimeline ? lessonTimelineSchema.safeParse(activeRecord.artifact.lessonTimeline) : undefined;
  timeline = parsedTimeline?.success ? parsedTimeline.data : undefined;
  if (sceneData) {
    const allMobjects: Mobject[] = [];
    const orderedObjects = [...sceneData.objects].sort((first, second) => (first.kind === "axes" ? -1 : second.kind === "axes" ? 1 : 0));
    for (const object of orderedObjects) {
      const mobject = buildMobject(object);
      if (!mobject) continue;
      objects.set(object.id, mobject);
      allMobjects.push(mobject);
      if (!["point", "midpoint", "reflection", "intersection"].includes(object.kind)) drawableIds.push(object.id);
      if (object.kind === "point" && object.motion) {
        const tracker = new ValueTracker(0);
        motionTrackers.set(object.id, tracker);
        const mobject = objects.get(object.id)!;
        mobject.addUpdater(() => {
          updateDynamicDependents();
        });
      }
    }
    for (const marker of sceneData.markers ?? []) {
      const markerMobject = buildMarker(marker);
      markers.set(marker.id, markerMobject);
      objects.set(marker.id, markerMobject);
      drawableIds.push(marker.id);
    }
    scene.add(...allMobjects);
    renderLabels();
    scene.render();
  }
  const problemText = $("#problem-text");
  problemText.innerHTML = renderMarkdown(activeRecord.text);
  void hydrateMath(problemText);
  const axesCount = sceneData?.objects.filter((object) => object.kind === "axes").length ?? 0;
  const movingCount = sceneData?.objects.filter((object) => object.kind === "point" && object.motion).length ?? 0;
  $("#case-meta").textContent = `${activeRecord.index + 1} / ${records.length} · ${activeRecord.status === "completed" ? "已完成" : "失败"} · 坐标系 ${axesCount ? "已绘制" : "无"} · 动点 ${movingCount}`;
  const dragButton = $("#drag-button") as HTMLButtonElement;
  dragButton.hidden = movingCount === 0;
  dragButton.disabled = false;
  dragEnabled = movingCount > 0;
  dragButton.querySelector<HTMLElement>(".drag-toggle-label")!.textContent = movingCount === 0 ? "本题无动点" : "拖动动点";
  dragButton.classList.remove("button-primary");
  const dragHelp = $("#drag-help");
  const motions = sceneData?.objects
    .filter((object): object is Extract<GeometryObject, { kind: "point" }> => object.kind === "point" && Boolean(object.motion))
    .map((object) => {
      const motion = object.motion!;
      if (motion.kind === "segment") {
        const path = sceneData?.objects.find((candidate) => candidate.id === motion.path);
        const pathLabel = path?.kind === "segment" ? path.points.map(displayPointLabel).join("–") : motion.path;
        return `${displayPointLabel(object.id)}：沿 ${pathLabel} 线段`;
      }
      if (motion.kind === "ellipse") return `${displayPointLabel(object.id)}：沿椭圆弧`;
      return `${displayPointLabel(object.id)}：沿声明的直线路径`;
    }) ?? [];
  dragHelp.textContent = motions.length > 0 ? `轨迹约束：${motions.join("；")}。` : "没有声明动点轨迹。";
  const motionControls = $("#motion-controls");
  motionControls.innerHTML = "";
  motionControls.toggleAttribute("hidden", motions.length === 0);
  for (const object of sceneData?.objects ?? []) {
    if (object.kind !== "point" || !object.motion) continue;
    const row = document.createElement("label");
    row.className = "motion-control";
    const name = document.createElement("span");
    name.textContent = displayPointLabel(object.id);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.value = String(motionTrackers.get(object.id)?.getValue() ?? 0);
    const output = document.createElement("output");
    output.textContent = `t=${Number(slider.value).toFixed(2)}`;
    slider.addEventListener("input", () => {
      draggedCoordinates.delete(object.id);
      motionTrackers.get(object.id)?.setValue(Number(slider.value));
      output.textContent = `t=${Number(slider.value).toFixed(2)}`;
      updateDynamicDependents();
      scene.render();
    });
    row.append(name, slider, output);
    motionControls.append(row);
  }
  if (movingCount === 0) {
    activeDragId = undefined;
    activePointerId = undefined;
  }
  const sourceImage = $("#source-image");
  sourceImage.innerHTML = "";
  sourceImage.toggleAttribute("hidden", !activeRecord.imageFile);
  if (activeRecord.imageFile) {
    const image = document.createElement("img");
    image.src = `/eval-image/${activeRecord.imageFile}`;
    image.alt = "题目配图";
    sourceImage.append(image);
  }
  $("#error-box").textContent = activeRecord.error ?? "";
  $("#error-box").toggleAttribute("hidden", !activeRecord.error);
  $("#facts").textContent = JSON.stringify(activeRecord.stage1 ?? activeRecord.artifact?.problemFacts ?? { status: activeRecord.status }, null, 2);
  const hasGeoGebra = Boolean(activeRecord.artifact?.geoGebra);
  const source = $("#geogebra-source");
  source.textContent = activeRecord.artifact?.geoGebra
    ? [`MODE: ${activeRecord.artifact.geoGebra.mode}`, ...activeRecord.artifact.geoGebra.commands].join("\n")
    : "本题使用兼容的 manim-web fixture，无 GeoGebra 命令。";
  const lessonButton = $("#lesson-button") as HTMLButtonElement;
  lessonButton.disabled = hasGeoGebra;
  $("#beat-label").textContent = sceneData || hasGeoGebra ? "准备检查" : "无可渲染场景";
  $("#status-text").textContent = sceneData || hasGeoGebra ? "场景已加载" : "本题未生成场景";
  $("#status-dot").classList.remove("busy");
  showAssertions();
  showTimeline();
  if (dragEnabled) enableDragging();
}

function enableDragging() {
  if (!sceneData) return;
  dragEnabled = true;
  const dragButton = $("#drag-button") as HTMLButtonElement;
  dragButton.hidden = false;
  dragButton.querySelector<HTMLElement>(".drag-toggle-label")!.textContent = "拖动动点";
  dragButton.classList.remove("button-primary");
  scene.getCanvas().style.cursor = "grab";
  $("#status-text").textContent = "按住图中的动点直接拖动";
}

function findDraggedPoint(clientX: number, clientY: number): string | undefined {
  if (!sceneData) return undefined;
  const viewport = dragViewport();
  const candidates = sceneData.objects.filter((object) => object.kind === "point" && object.motion).reverse();
  return candidates.find((object) => {
    const mobject = objects.get(object.id);
    if (!mobject) return false;
    const value = evaluation?.points[object.id];
    if (!value) return false;
    const [visualX, visualY] = visualTupleAt(value);
    const visualHit = hitTestWorldPoint(clientX, clientY, { x: visualX, y: visualY }, mobject.getBoundingBox(), viewport);
    const center = mobject.getCenter();
    return visualHit || hitTestWorldPoint(clientX, clientY, { x: center[0], y: center[1] }, mobject.getBoundingBox(), viewport);
  })?.id;
}

function handlePointerDown(event: PointerEvent) {
  if (!dragEnabled || activePointerId !== undefined || !event.isPrimary) return;
  const id = findDraggedPoint(event.clientX, event.clientY);
  if (!id) return;
  activeDragId = id;
  activePointerId = event.pointerId;
  try { scene.getCanvas().setPointerCapture(event.pointerId); } catch { /* capture is unavailable in some test DOMs */ }
  scene.getCanvas().style.cursor = "grabbing";
  $("#status-text").textContent = `正在拖动 ${id}`;
  event.preventDefault();
}

function handlePointerMove(event: PointerEvent) {
  if (!dragEnabled || activePointerId !== event.pointerId || !activeDragId) return;
  const object = sceneData?.objects.find((candidate) => candidate.id === activeDragId);
  if (!object || object.kind !== "point" || !object.motion) return;
  const coordinates = projectDraggedPoint(object, pointerCoordinates(event));
  draggedCoordinates.set(object.id, coordinates);
  updateDynamicDependents();
  scene.render();
  event.preventDefault();
}

function handlePointerUp(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return;
  try { scene.getCanvas().releasePointerCapture(event.pointerId); } catch { /* capture is unavailable in some test DOMs */ }
  const id = activeDragId;
  activeDragId = undefined;
  activePointerId = undefined;
  scene.getCanvas().style.cursor = dragEnabled ? "grab" : "default";
  if (id) $("#status-text").textContent = `已调整动点 ${id}`;
}

function showAssertions() {
  const host = $("#assertions");
  host.innerHTML = "";
  if (!sceneData || !evaluation) {
    host.innerHTML = "<p class=\"empty-note\">没有可检查的几何场景。</p>";
    return;
  }
  for (const [index, assertion] of sceneData.assertions.entries()) {
    const passed = !evaluation.diagnostics.some((diagnostic) => diagnostic.path === `assertions[${index}]`);
    const row = document.createElement("div");
    row.className = "assertion";
    row.innerHTML = `<span class="assertion-icon ${passed ? "" : "fail"}">${passed ? "✓" : "!"}</span><span>${assertion.kind}<small>${passed ? "通过确定性求值" : "未满足"}</small></span>`;
    host.append(row);
  }
}

function showTimeline() {
  const host = $("#timeline");
  host.innerHTML = "";
  if (!timeline) {
    host.innerHTML = "<p class=\"empty-note\">本题没有时间线结果。</p>";
    return;
  }
  for (const [index, beat] of timeline.beats.entries()) {
    const row = document.createElement("div");
    row.className = "timeline-item";
    row.innerHTML = `<span class="timeline-index">${index + 1}</span><span><span class="timeline-kind">${beat.kind}</span><br />${beat.narration}</span>`;
    host.append(row);
  }
}

async function playLesson() {
  if (busy || !timeline) return;
  busy = true;
  $("#status-dot").classList.add("busy");
  for (const [index, beat] of timeline.beats.entries()) {
    $("#beat-label").textContent = `${index + 1} · ${beat.narration}`;
    for (const action of beat.actions) {
      for (const id of action.objectIds) {
        const mobject = objects.get(id);
        if (!mobject) continue;
        if (action.kind === "focus") await scene.play(new FocusOn(mobject, { duration: 0.7 }));
        else await scene.play(new Indicate(mobject, { duration: 0.7 }));
      }
    }
  }
  $("#status-dot").classList.remove("busy");
  $("#status-text").textContent = "讲解播放完成";
  busy = false;
}

const select = $("#case-select") as HTMLSelectElement;
records.forEach((record, index) => {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = `题目 ${index + 1}${record.status === "failed" ? " · 失败" : ""}`;
  select.append(option);
});
select.addEventListener("change", () => { activeRecord = records[Number(select.value)]!; renderCase(); });
$("#lesson-button").addEventListener("click", () => void playLesson());
$("#drag-button").addEventListener("click", () => enableDragging());
$("#reset-button").addEventListener("click", renderCase);
$("#check-button").addEventListener("click", () => { showAssertions(); $("#status-text").textContent = evaluation?.diagnostics.length === 0 ? "全部约束通过" : "存在未通过约束"; });
const canvas = scene.getCanvas();
canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", handlePointerUp);
renderCase();
