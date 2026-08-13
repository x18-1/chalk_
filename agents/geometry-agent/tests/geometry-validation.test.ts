import { describe, expect, it } from "vitest";

import {
  evaluateGeometryScene,
  validateGeometryScene,
  type GeometryScene,
} from "../src/geometry";

const doubledMedianScene: GeometryScene = {
  version: 1,
  objects: [
    { id: "A", kind: "point", x: 0, y: 3 },
    { id: "B", kind: "point", x: -4, y: 0 },
    { id: "C", kind: "point", x: 4, y: 0 },
    { id: "D", kind: "midpoint", points: ["B", "C"] },
    { id: "E", kind: "reflection", point: "A", center: "D" },
    { id: "AD", kind: "segment", points: ["A", "D"] },
    { id: "DE", kind: "segment", points: ["D", "E"] },
    { id: "BE", kind: "segment", points: ["B", "E"] },
  ],
  assertions: [
    { kind: "equal_length", segments: ["AD", "DE"] },
    { kind: "collinear", points: ["A", "D", "E"] },
  ],
};

describe("geometry DSL", () => {
  it("evaluates the doubled-median construction and verifies its postconditions", () => {
    expect(validateGeometryScene(doubledMedianScene)).toEqual([]);

    const result = evaluateGeometryScene(doubledMedianScene);

    expect(result.diagnostics).toEqual([]);
    expect(result.points.D).toEqual({ x: 0, y: 0 });
    expect(result.points.E).toEqual({ x: 0, y: -3 });
    expect(result.measurements.AD.length).toBeCloseTo(3);
    expect(result.measurements.DE.length).toBeCloseTo(3);
  });

  it("reports a structured diagnostic when a construction depends on an absent object", () => {
    const diagnostics = validateGeometryScene({
      version: 1,
      objects: [{ id: "D", kind: "midpoint", points: ["B", "C"] }],
      assertions: [],
    });

    expect(diagnostics).toContainEqual({
      code: "OBJECT_NOT_FOUND",
      path: "objects[0].points[0]",
      message: 'Object "B" does not exist',
    });
  });

  it("stops safely when an intersection is degenerate", () => {
    const result = evaluateGeometryScene({
      version: 1,
      objects: [
        { id: "A", kind: "point", x: 0, y: 0 },
        { id: "B", kind: "point", x: 1, y: 0 },
        { id: "C", kind: "point", x: 0, y: 1 },
        { id: "D", kind: "point", x: 1, y: 1 },
        { id: "lineAB", kind: "line", points: ["A", "B"] },
        { id: "lineCD", kind: "line", points: ["C", "D"] },
        { id: "P", kind: "intersection", lines: ["lineAB", "lineCD"] },
        { id: "AP", kind: "segment", points: ["A", "P"] },
      ],
      assertions: [],
    });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "DEGENERATE_CONSTRUCTION",
      path: "objects.P",
    }));
  });
});
