import type {
  GeometryAssertion,
  GeometryDiagnostic,
  GeometryObject,
  GeometryScene,
} from "./schema";
import { dependenciesOf, lineKinds, pointKinds, validateGeometryScene } from "./validate";

export type Point2D = { x: number; y: number };
export type Line2D = { point: Point2D; direction: Point2D };

export type GeometryEvaluation = {
  points: Record<string, Point2D>;
  lines: Record<string, Line2D>;
  measurements: Record<string, { length: number }>;
  diagnostics: GeometryDiagnostic[];
};

const EPSILON = 1e-8;

function subtract(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

function cross(a: Point2D, b: Point2D) {
  return a.x * b.y - a.y * b.x;
}

function dot(a: Point2D, b: Point2D) {
  return a.x * b.x + a.y * b.y;
}

function length(vector: Point2D) {
  return Math.hypot(vector.x, vector.y);
}

function evaluateAssertion(
  assertion: GeometryAssertion,
  result: GeometryEvaluation,
  path: string,
): GeometryDiagnostic | undefined {
  const tolerance = assertion.tolerance ?? 1e-6;
  let passed = false;
  switch (assertion.kind) {
    case "equal_length": {
      const [first, second] = assertion.segments.map((id) => result.measurements[id]!.length);
      passed = Math.abs(first! - second!) <= tolerance;
      break;
    }
    case "collinear": {
      const [originId, secondId, ...rest] = assertion.points;
      const origin = result.points[originId!]!;
      const direction = subtract(result.points[secondId!]!, origin);
      passed = rest.every((id) => Math.abs(cross(direction, subtract(result.points[id]!, origin))) <= tolerance);
      break;
    }
    case "parallel": {
      const [first, second] = assertion.lines.map((id) => result.lines[id]!.direction);
      passed = Math.abs(cross(first!, second!)) <= tolerance;
      break;
    }
    case "perpendicular": {
      const [first, second] = assertion.lines.map((id) => result.lines[id]!.direction);
      passed = Math.abs(dot(first!, second!)) <= tolerance;
      break;
    }
  }

  if (!passed) {
    return {
      code: "POSTCONDITION_FAILED",
      path,
      message: `Assertion ${assertion.kind} was not satisfied`,
    };
  }
}

export function evaluateGeometryScene(scene: GeometryScene): GeometryEvaluation {
  const result: GeometryEvaluation = { points: {}, lines: {}, measurements: {}, diagnostics: [] };
  const validationDiagnostics = validateGeometryScene(scene);
  if (validationDiagnostics.length > 0) {
    result.diagnostics.push(...validationDiagnostics);
    return result;
  }

  const byId = new Map(scene.objects.map((object) => [object.id, object]));
  const pending = new Set(scene.objects.map((object) => object.id));
  const failed = new Set<string>();

  const evaluateObject = (object: GeometryObject) => {
    switch (object.kind) {
      case "point":
        result.points[object.id] = { x: object.x, y: object.y };
        break;
      case "midpoint": {
        const [a, b] = object.points.map((id) => result.points[id]!);
        result.points[object.id] = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        break;
      }
      case "reflection": {
        const point = result.points[object.point]!;
        const center = result.points[object.center]!;
        result.points[object.id] = { x: 2 * center.x - point.x, y: 2 * center.y - point.y };
        break;
      }
      case "segment": {
        const [a, b] = object.points.map((id) => result.points[id]!);
        if (!a || !b) {
          failed.add(object.id);
          result.diagnostics.push({
            code: "DEGENERATE_CONSTRUCTION",
            path: `objects.${object.id}`,
            message: `Segment "${object.id}" depends on a construction that could not be evaluated`,
          });
          break;
        }
        const direction = subtract(b!, a!);
        if (length(direction) <= EPSILON) {
          result.diagnostics.push({
            code: "DEGENERATE_CONSTRUCTION",
            path: `objects.${object.id}`,
            message: `Segment "${object.id}" has coincident endpoints`,
          });
          failed.add(object.id);
          break;
        }
        result.measurements[object.id] = { length: length(direction) };
        break;
      }
      case "line": {
        const [a, b] = object.points.map((id) => result.points[id]!);
        if (!a || !b) {
          failed.add(object.id);
          result.diagnostics.push({
            code: "DEGENERATE_CONSTRUCTION",
            path: `objects.${object.id}`,
            message: `Line "${object.id}" depends on a construction that could not be evaluated`,
          });
          break;
        }
        const direction = subtract(b!, a!);
        if (length(direction) <= EPSILON) {
          result.diagnostics.push({
            code: "DEGENERATE_CONSTRUCTION",
            path: `objects.${object.id}`,
            message: `Line "${object.id}" needs two distinct points`,
          });
          failed.add(object.id);
          break;
        }
        result.lines[object.id] = { point: a!, direction };
        break;
      }
      case "parallel_line": {
        const source = result.lines[object.line]!;
        result.lines[object.id] = { point: result.points[object.through]!, direction: { ...source.direction } };
        break;
      }
      case "perpendicular_line": {
        const source = result.lines[object.line]!;
        result.lines[object.id] = {
          point: result.points[object.through]!,
          direction: { x: -source.direction.y, y: source.direction.x },
        };
        break;
      }
      case "intersection": {
        const [first, second] = object.lines.map((id) => result.lines[id]!);
        const denominator = cross(first!.direction, second!.direction);
        if (Math.abs(denominator) <= EPSILON) {
          result.diagnostics.push({
            code: "DEGENERATE_CONSTRUCTION",
            path: `objects.${object.id}`,
            message: `Lines for intersection "${object.id}" are parallel or coincident`,
          });
          failed.add(object.id);
          break;
        }
        const offset = subtract(second!.point, first!.point);
        const parameter = cross(offset, second!.direction) / denominator;
        result.points[object.id] = {
          x: first!.point.x + parameter * first!.direction.x,
          y: first!.point.y + parameter * first!.direction.y,
        };
        break;
      }
      case "circle":
      case "polygon":
        break;
    }
  };

  while (pending.size > 0) {
    let progressed = false;
    for (const id of [...pending]) {
      const object = byId.get(id)!;
      const dependencies = dependenciesOf(object);
      if (dependencies.some((dependency) => failed.has(dependency))) {
        failed.add(id);
        pending.delete(id);
        progressed = true;
      } else if (dependencies.every((dependency) => !pending.has(dependency))) {
        evaluateObject(object);
        pending.delete(id);
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  if (result.diagnostics.length === 0) {
    scene.assertions.forEach((assertion, index) => {
      const diagnostic = evaluateAssertion(assertion, result, `assertions[${index}]`);
      if (diagnostic) result.diagnostics.push(diagnostic);
    });
  }

  return result;
}

export function isPointObject(object: GeometryObject) {
  return pointKinds.includes(object.kind);
}

export function isLineObject(object: GeometryObject) {
  return lineKinds.includes(object.kind);
}
