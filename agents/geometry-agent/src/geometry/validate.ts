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

function dependenciesOf(object: GeometryObject): string[] {
  switch (object.kind) {
    case "point":
      return [];
    case "midpoint":
    case "segment":
    case "line":
    case "polygon":
      return [...object.points];
    case "reflection":
      return [object.point, object.center];
    case "circle":
      return [object.center];
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
      return [];
    case "midpoint":
    case "segment":
    case "line":
    case "polygon":
      return object.points.map((_, index) => `points[${index}]`);
    case "reflection":
      return ["point", "center"];
    case "circle":
      return ["center"];
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
      return [];
    case "midpoint":
    case "segment":
    case "line":
    case "polygon":
      return object.points.map(() => "point");
    case "reflection":
      return ["point", "point"];
    case "circle":
      return ["point"];
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
