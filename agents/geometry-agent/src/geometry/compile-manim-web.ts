import type { GeometryObject, GeometryScene } from "./schema";
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

function lineEndpoints(point: Point2D, direction: Point2D, extent = 6): [Point2D, Point2D] {
  const magnitude = Math.hypot(direction.x, direction.y);
  const unit = { x: direction.x / magnitude, y: direction.y / magnitude };
  return [
    { x: point.x - extent * unit.x, y: point.y - extent * unit.y },
    { x: point.x + extent * unit.x, y: point.y + extent * unit.y },
  ];
}

function declarationFor(object: GeometryObject, scene: GeometryScene, points: Record<string, Point2D>, lines: ReturnType<typeof evaluateGeometryScene>["lines"]): string | undefined {
  if (isPointObject(object)) {
    return `const ${variableName(object.id)} = new Dot({ point: ${tuple(points[object.id]!)} });`;
  }
  if (object.kind === "segment") {
    const [start, end] = object.points.map((id) => points[id]!);
    return `const ${variableName(object.id)} = new Line({ start: ${tuple(start!)}, end: ${tuple(end!)} });`;
  }
  if (isLineObject(object)) {
    const line = lines[object.id]!;
    const [start, end] = lineEndpoints(line.point, line.direction);
    return `const ${variableName(object.id)} = new Line({ start: ${tuple(start)}, end: ${tuple(end)} });`;
  }
  if (object.kind === "circle") {
    return `const ${variableName(object.id)} = new Circle({ radius: ${number(object.radius)} }).moveTo(${tuple(points[object.center]!)});`;
  }
  if (object.kind === "polygon") {
    const vertices = object.points.map((id) => tuple(points[id]!)).join(", ");
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

  const declarations = scene.objects
    .map((object) => declarationFor(object, scene, evaluation.points, evaluation.lines))
    .filter((line): line is string => line !== undefined);
  const pointIds = scene.objects.filter(isPointObject).map((object) => object.id);
  const drawableIds = scene.objects
    .filter((object) => !isPointObject(object))
    .map((object) => object.id);

  return [
    'import { Circle, Create, Dot, Line, Polygon, Scene } from "manim-web";',
    "",
    "export class GeometryLessonScene extends Scene {",
    "  async construct(): Promise<void> {",
    ...declarations.map((line) => `    ${line}`),
    ...(pointIds.length > 0 ? [`    this.add(${pointIds.map(variableName).join(", ")});`] : []),
    ...(drawableIds.length > 0
      ? [`    await this.play(${drawableIds.map((id) => `new Create(${variableName(id)})`).join(", ")});`]
      : []),
    "  }",
    "}",
    "",
  ].join("\n");
}
