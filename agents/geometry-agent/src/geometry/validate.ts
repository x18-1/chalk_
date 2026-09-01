import type {
  GeometryAssertion,
  GeometryDiagnostic,
  GeometryObject,
  GeometryScene,
} from "./schema";
import { geometrySceneSchema } from "./schema";

type ObjectKind = GeometryObject["kind"];
type KindGroup = "point" | "line" | "segment";

const pointKinds: readonly ObjectKind[] = ["point", "midpoint", "reflection", "intersection"];
const lineKinds: readonly ObjectKind[] = ["line", "parallel_line", "perpendicular_line"];
const markerArmKinds: readonly ObjectKind[] = ["segment", ...lineKinds];

function dependenciesOf(object: GeometryObject): string[] {
  switch (object.kind) {
    case "point":
    case "axes":
      return [];
    case "midpoint":
    case "segment":
    case "line":
    case "polygon":
      return [...object.points];
    case "reflection":
      return [object.point, object.center];
    case "circle":
    case "ellipse":
      return [object.center];
    case "parabola":
      return [];
    case "intersection":
      return [...object.lines];
    case "parallel_line":
    case "perpendicular_line":
      return [object.through, object.line];
  }
}

function dependencyPaths(object: GeometryObject): string[] {
  switch (object.kind) {
    case "point":
    case "axes":
      return [];
    case "midpoint":
    case "segment":
    case "line":
    case "polygon":
      return object.points.map((_, index) => `points[${index}]`);
    case "reflection":
      return ["point", "center"];
    case "circle":
    case "ellipse":
      return ["center"];
    case "parabola":
      return [];
    case "intersection":
      return object.lines.map((_, index) => `lines[${index}]`);
    case "parallel_line":
    case "perpendicular_line":
      return ["through", "line"];
  }
}

function matchesGroup(kind: ObjectKind, group: KindGroup) {
  if (group === "point") return pointKinds.includes(kind);
  if (group === "line") return lineKinds.includes(kind);
  return kind === "segment";
}

function expectedGroups(object: GeometryObject): KindGroup[] {
  switch (object.kind) {
    case "point":
    case "axes":
      return [];
    case "midpoint":
    case "segment":
    case "line":
    case "polygon":
      return object.points.map(() => "point");
    case "reflection":
      return ["point", "point"];
    case "circle":
    case "ellipse":
      return ["point"];
    case "parabola":
      return [];
    case "intersection":
      return ["line", "line"];
    case "parallel_line":
    case "perpendicular_line":
      return ["point", "line"];
  }
}

function assertionReferences(assertion: GeometryAssertion): Array<[string, KindGroup]> {
  switch (assertion.kind) {
    case "equal_length":
      return assertion.segments.map((id) => [id, "segment"]);
    case "collinear":
      return assertion.points.map((id) => [id, "point"]);
    case "parallel":
    case "perpendicular":
      return assertion.lines.map((id) => [id, "line"]);
  }
}

export function parseGeometryScene(input: unknown):
  | { ok: true; value: GeometryScene }
  | { ok: false; diagnostics: GeometryDiagnostic[] } {
  const result = geometrySceneSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };

  return {
    ok: false,
    diagnostics: result.error.issues.map((issue) => ({
      code: "TYPE_MISMATCH",
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function validateGeometryScene(scene: GeometryScene): GeometryDiagnostic[] {
  const diagnostics: GeometryDiagnostic[] = [];
  const objects = new Map<string, { object: GeometryObject; index: number }>();

  for (const [index, object] of scene.objects.entries()) {
    if (objects.has(object.id)) {
      diagnostics.push({
        code: "DUPLICATE_ID",
        path: `objects[${index}].id`,
        message: `Object ID "${object.id}" is duplicated`,
      });
    } else {
      objects.set(object.id, { object, index });
    }
  }

  for (const [index, object] of scene.objects.entries()) {
    const dependencies = dependenciesOf(object);
    const paths = dependencyPaths(object);
    const groups = expectedGroups(object);
    dependencies.forEach((dependency, dependencyIndex) => {
      const target = objects.get(dependency)?.object;
      const path = `objects[${index}].${paths[dependencyIndex]}`;
      if (!target) {
        diagnostics.push({
          code: "OBJECT_NOT_FOUND",
          path,
          message: `Object "${dependency}" does not exist`,
        });
      } else if (!matchesGroup(target.kind, groups[dependencyIndex]!)) {
        diagnostics.push({
          code: "TYPE_MISMATCH",
          path,
          message: `Object "${dependency}" must be a ${groups[dependencyIndex]}`,
        });
      }
    });
    if (object.kind === "point" && object.motion?.kind === "segment") {
      const path = `objects[${index}].motion.path`;
      const target = objects.get(object.motion.path)?.object;
      if (!target) diagnostics.push({ code: "OBJECT_NOT_FOUND", path, message: `Object "${object.motion.path}" does not exist` });
      else if (target.kind !== "segment") diagnostics.push({ code: "TYPE_MISMATCH", path, message: `Motion path "${object.motion.path}" must be a segment` });
    }
    if (object.kind === "point" && object.motion?.kind === "parabola") {
      const path = `objects[${index}].motion.curve`;
      const target = objects.get(object.motion.curve)?.object;
      if (!target) diagnostics.push({ code: "OBJECT_NOT_FOUND", path, message: `Motion curve "${object.motion.curve}" does not exist` });
      else if (target.kind !== "parabola") diagnostics.push({ code: "TYPE_MISMATCH", path, message: `Motion curve "${object.motion.curve}" must be a parabola` });
    }
    if (object.kind === "point" && object.on) {
      const path = `objects[${index}].on`;
      const target = objects.get(object.on)?.object;
      if (!target) diagnostics.push({ code: "OBJECT_NOT_FOUND", path, message: `Locus object "${object.on}" does not exist` });
      else if (!["circle", "ellipse", "parabola", "segment", "line", "parallel_line", "perpendicular_line"].includes(target.kind)) {
        diagnostics.push({ code: "TYPE_MISMATCH", path, message: `Locus object "${object.on}" must be a curve or line` });
      }
    }
  }

  for (const [assertionIndex, assertion] of scene.assertions.entries()) {
    for (const [referenceIndex, [id, group]] of assertionReferences(assertion).entries()) {
      const target = objects.get(id)?.object;
      const path = `assertions[${assertionIndex}][${referenceIndex}]`;
      if (!target) {
        diagnostics.push({ code: "OBJECT_NOT_FOUND", path, message: `Object "${id}" does not exist` });
      } else if (!matchesGroup(target.kind, group)) {
        diagnostics.push({ code: "TYPE_MISMATCH", path, message: `Object "${id}" must be a ${group}` });
      }
    }
  }

  for (const [markerIndex, marker] of (scene.markers ?? []).entries()) {
    const markerPath = `markers[${markerIndex}]`;
    if (objects.has(marker.id)) {
      diagnostics.push({
        code: "DUPLICATE_ID",
        path: `${markerPath}.id`,
        message: `Marker ID "${marker.id}" duplicates a geometry object ID`,
      });
    }
    const vertex = objects.get(marker.vertex)?.object;
    if (!vertex) {
      diagnostics.push({ code: "OBJECT_NOT_FOUND", path: `${markerPath}.vertex`, message: `Object "${marker.vertex}" does not exist` });
    } else if (!pointKinds.includes(vertex.kind)) {
      diagnostics.push({ code: "TYPE_MISMATCH", path: `${markerPath}.vertex`, message: `Object "${marker.vertex}" must be a point` });
    }
    marker.arms.forEach((armId, armIndex) => {
      const arm = objects.get(armId)?.object;
      const path = `${markerPath}.arms[${armIndex}]`;
      if (!arm) {
        diagnostics.push({ code: "OBJECT_NOT_FOUND", path, message: `Object "${armId}" does not exist` });
      } else if (!markerArmKinds.includes(arm.kind)) {
        diagnostics.push({ code: "TYPE_MISMATCH", path, message: `Object "${armId}" must be a segment or line` });
      }
    });
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const entry = objects.get(id);
    const cyclic = entry ? dependenciesOf(entry.object).some((dependency) => objects.has(dependency) && visit(dependency)) : false;
    visiting.delete(id);
    visited.add(id);
    return cyclic;
  };
  for (const [id, entry] of objects) {
    if (visit(id)) {
      diagnostics.push({
        code: "CYCLIC_DEPENDENCY",
        path: `objects[${entry.index}]`,
        message: `Object "${id}" participates in a dependency cycle`,
      });
      break;
    }
  }

  return diagnostics;
}

export { dependenciesOf, lineKinds, pointKinds };
