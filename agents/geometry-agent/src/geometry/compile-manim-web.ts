import type { GeometryObject, GeometryScene, RightAngleMarker } from "./schema";
import { evaluateGeometryScene, isLineObject, isPointObject, type Point2D } from "./evaluate";

function number(value: number) {
  return Object.is(value, -0) ? "0" : Number(value.toFixed(10)).toString();
}

function tuple(point: Point2D) {
  return `[${number(point.x)}, ${number(point.y)}, 0]`;
}

function variableName(id: string) {
  return `object_${id}`;
}

function axesObject(scene: GeometryScene) {
  return scene.objects.find((object) => object.kind === "axes");
}

function isRedundantAxisLine(object: GeometryObject, points: Record<string, Point2D>, axes: Extract<GeometryObject, { kind: "axes" }> | undefined) {
  if (!axes || object.kind !== "line") return false;
  const [first, second] = object.points.map((id) => points[id]!);
  return (Math.abs(first.y) < 1e-8 && Math.abs(second.y) < 1e-8) || (Math.abs(first.x) < 1e-8 && Math.abs(second.x) < 1e-8);
}

function pointExpression(point: Point2D, axes: Extract<GeometryObject, { kind: "axes" }> | undefined) {
  return axes ? `${variableName(axes.id)}.coordsToPoint(${number(point.x)}, ${number(point.y)})` : tuple(point);
}

function lineEndpoints(point: Point2D, direction: Point2D, extent = 6): [Point2D, Point2D] {
  const magnitude = Math.hypot(direction.x, direction.y);
  const unit = { x: direction.x / magnitude, y: direction.y / magnitude };
  return [
    { x: point.x - extent * unit.x, y: point.y - extent * unit.y },
    { x: point.x + extent * unit.x, y: point.y + extent * unit.y },
  ];
}

function markerArmPoint(marker: RightAngleMarker, armId: string, vertex: Point2D, scene: GeometryScene, points: Record<string, Point2D>, lines: ReturnType<typeof evaluateGeometryScene>["lines"]): Point2D {
  const arm = scene.objects.find((object) => object.id === armId);
  if (!arm) throw new Error(`Right-angle marker "${marker.id}" references an unknown arm`);
  if (arm.kind === "segment") {
    const [firstId, secondId] = arm.points;
    const first = points[firstId]!;
    const second = points[secondId]!;
    if (Math.hypot(first.x - vertex.x, first.y - vertex.y) <= 1e-8) return second;
    if (Math.hypot(second.x - vertex.x, second.y - vertex.y) <= 1e-8) return first;
    return Math.hypot(first.x - vertex.x, first.y - vertex.y) < Math.hypot(second.x - vertex.x, second.y - vertex.y) ? first : second;
  }
  if (isLineObject(arm)) {
    const line = lines[arm.id]!;
    const magnitude = Math.hypot(line.direction.x, line.direction.y);
    return { x: vertex.x + line.direction.x / magnitude, y: vertex.y + line.direction.y / magnitude };
  }
  throw new Error(`Right-angle marker "${marker.id}" references a non-linear arm`);
}

function markerDeclaration(marker: RightAngleMarker, scene: GeometryScene, points: Record<string, Point2D>, lines: ReturnType<typeof evaluateGeometryScene>["lines"]): string {
  const vertex = points[marker.vertex];
  if (!vertex) throw new Error(`Right-angle marker "${marker.id}" references an unevaluated vertex`);
  const first = markerArmPoint(marker, marker.arms[0], vertex, scene, points, lines);
  const second = markerArmPoint(marker, marker.arms[1], vertex, scene, points, lines);
  return `const ${variableName(marker.id)} = new RightAngle({ points: [${tuple(first)}, ${tuple(vertex)}, ${tuple(second)}] }, { size: ${number(marker.size ?? 0.3)}, color: "#d8b16d", strokeWidth: 3 });`;
}

function motionDeclarations(scene: GeometryScene, points: Record<string, Point2D>, axes: Extract<GeometryObject, { kind: "axes" }> | undefined): string[] {
  return scene.objects.flatMap((object) => {
    if (object.kind !== "point" || !object.motion) return [];
    const start = points[object.id]!;
    const motion = object.motion;
    let interpolated: string;
    if (motion.kind === "linear") {
      const end = motion.to;
      interpolated = axes
        ? `${variableName(axes.id)}.coordsToPoint(${number(start.x)} + (${number(end.x)} - ${number(start.x)}) * t, ${number(start.y)} + (${number(end.y)} - ${number(start.y)}) * t)`
        : `[${number(start.x)} + (${number(end.x)} - ${number(start.x)}) * t, ${number(start.y)} + (${number(end.y)} - ${number(start.y)}) * t, 0]`;
    } else if (motion.kind === "segment") {
      const path = scene.objects.find((candidate) => candidate.id === motion.path);
      if (!path || path.kind !== "segment") throw new Error(`Motion path "${motion.path}" is not a segment`);
      const first = points[path.points[0]]!;
      const second = points[path.points[1]]!;
      interpolated = axes
        ? `${variableName(axes.id)}.coordsToPoint(${number(first.x)} + (${number(second.x)} - ${number(first.x)}) * t, ${number(first.y)} + (${number(second.y)} - ${number(first.y)}) * t)`
        : `[${number(first.x)} + (${number(second.x)} - ${number(first.x)}) * t, ${number(first.y)} + (${number(second.y)} - ${number(first.y)}) * t, 0]`;
    } else if (motion.kind === "parabola") {
      const curve = scene.objects.find((candidate) => candidate.id === motion.curve);
      if (!curve || curve.kind !== "parabola") throw new Error(`Motion curve "${motion.curve}" is not a parabola`);
      const x = `${number(motion.xRange[0])} + (${number(motion.xRange[1])} - ${number(motion.xRange[0])}) * t`;
      const y = `(${number(curve.a)}) * (${x}) * (${x}) + (${number(curve.b)}) * (${x}) + (${number(curve.c)})`;
      interpolated = axes ? `${variableName(axes.id)}.coordsToPoint(${x}, ${y})` : `[${x}, ${y}, 0]`;
    } else {
      interpolated = axes
        ? `${variableName(axes.id)}.coordsToPoint(${number(motion.center.x)} + ${number(motion.radiusX)} * Math.cos(${number(motion.startAngle)} + (${number(motion.endAngle)} - ${number(motion.startAngle)}) * t), ${number(motion.center.y)} + ${number(motion.radiusY)} * Math.sin(${number(motion.startAngle)} + (${number(motion.endAngle)} - ${number(motion.startAngle)}) * t))`
        : `[${number(motion.center.x)} + ${number(motion.radiusX)} * Math.cos(${number(motion.startAngle)} + (${number(motion.endAngle)} - ${number(motion.startAngle)}) * t), ${number(motion.center.y)} + ${number(motion.radiusY)} * Math.sin(${number(motion.startAngle)} + (${number(motion.endAngle)} - ${number(motion.startAngle)}) * t), 0]`;
    }
    return [
      `const tracker_${object.id} = new ValueTracker(0);`,
      `object_${object.id}.addUpdater((mobject) => { const t = tracker_${object.id}.getValue(); mobject.moveTo(${interpolated}); });`,
    ];
  });
}

function declarationFor(object: GeometryObject, scene: GeometryScene, points: Record<string, Point2D>, lines: ReturnType<typeof evaluateGeometryScene>["lines"], axes: Extract<GeometryObject, { kind: "axes" }> | undefined): string | undefined {
  if (object.kind === "axes") {
    const xRange = `[${object.xRange.join(", ")}]`;
    const yRange = `[${object.yRange.join(", ")}]`;
    return `const ${variableName(object.id)} = new Axes({ xRange: ${xRange}, yRange: ${yRange}, xLength: ${number(object.xLength ?? 10)}, yLength: ${number(object.yLength ?? 6)}, tips: ${object.tips ?? true}, color: "#9fcdb8" });`;
  }
  if (isPointObject(object)) {
    const point = points[object.id]!;
    const expression = pointExpression(point, axes);
    return `const ${variableName(object.id)} = new Dot({ point: ${expression} });`;
  }
  if (object.kind === "segment") {
    const [start, end] = object.points.map((id) => points[id]!);
    return `const ${variableName(object.id)} = new Line({ start: ${pointExpression(start!, axes)}, end: ${pointExpression(end!, axes)} });`;
  }
  if (isLineObject(object)) {
    const line = lines[object.id]!;
    const [start, end] = lineEndpoints(line.point, line.direction);
    return `const ${variableName(object.id)} = new Line({ start: ${pointExpression(start, axes)}, end: ${pointExpression(end, axes)} });`;
  }
  if (object.kind === "circle") {
    return `const ${variableName(object.id)} = new Circle({ radius: ${number(object.radius)}, center: ${pointExpression(points[object.center]!, axes)} });`;
  }
  if (object.kind === "ellipse") {
    return `const ${variableName(object.id)} = new Ellipse({ width: ${number(object.radiusX * 2)}, height: ${number(object.radiusY * 2)}, center: ${pointExpression(points[object.center]!, axes)}, color: "#d8b16d" });`;
  }
  if (object.kind === "parabola") {
    const axesArgument = axes ? `, axes: ${variableName(axes.id)}` : "";
    return `const ${variableName(object.id)} = new FunctionGraph({ func: (x) => ${number(object.a)} * x * x + ${number(object.b)} * x + ${number(object.c)}, xRange: [${number(object.xRange[0])}, ${number(object.xRange[1])}], color: "#d8b16d"${axesArgument} });`;
  }
  if (object.kind === "polygon") {
    const vertices = object.points.map((id) => pointExpression(points[id]!, axes)).join(", ");
    return `const ${variableName(object.id)} = new Polygon({ vertices: [${vertices}] });`;
  }
  void scene;
  return undefined;
}

export function compileManimWebScene(scene: GeometryScene): string {
  const evaluation = evaluateGeometryScene(scene);
  if (evaluation.diagnostics.length > 0) {
    throw new Error(`Cannot compile invalid geometry scene: ${JSON.stringify(evaluation.diagnostics)}`);
  }

  const axes = axesObject(scene);
  const renderedObjects = scene.objects.filter((object) => !isRedundantAxisLine(object, evaluation.points, axes));
  const declarations = renderedObjects
    .sort((first, second) => (first.kind === "axes" ? -1 : second.kind === "axes" ? 1 : 0))
    .map((object) => declarationFor(object, scene, evaluation.points, evaluation.lines, axesObject(scene)))
    .filter((line): line is string => line !== undefined);
  const markerDeclarations = (scene.markers ?? []).map((marker) => markerDeclaration(marker, scene, evaluation.points, evaluation.lines));
  const motions = motionDeclarations(scene, evaluation.points, axes);
  const pointIds = renderedObjects.filter(isPointObject).map((object) => object.id);
  const drawableIds = [
    ...renderedObjects.filter((object) => !isPointObject(object)).map((object) => object.id),
    ...(scene.markers ?? []).map((marker) => marker.id),
  ];

  return [
    'import { Axes, Circle, Create, Dot, Ellipse, FunctionGraph, Line, Polygon, RightAngle, Scene, ValueTracker } from "manim-web";',
    "",
    "export async function createGeometryLessonScene(container: HTMLElement | null): Promise<Scene> {",
    "  const scene = new Scene(container, { backgroundColor: \"#1C1C1C\", headless: container === null });",
    ...[...declarations, ...markerDeclarations, ...motions].map((line) => `    ${line}`),
    ...(pointIds.length > 0 ? [`    scene.add(${pointIds.map(variableName).join(", ")});`] : []),
    ...(drawableIds.length > 0
      ? [`    await scene.play(${drawableIds.map((id) => `new Create(${variableName(id)})`).join(", ")});`]
      : []),
    ...(scene.objects.some((object) => object.kind === "point" && object.motion)
      ? [`    await scene.play(${scene.objects.filter((object): object is Extract<GeometryObject, { kind: "point" }> => object.kind === "point" && !!object.motion).map((object) => `tracker_${object.id}.animateTo(1, { duration: ${number(object.motion!.duration ?? 1)} })`).join(", ")});`]
      : []),
    "  return scene;",
    "}",
    "",
  ].join("\n");
}
