import { describe, expect, it } from "vitest";

import {
  evaluateGeometryScene,
  validateProblemFacts,
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

  it("rejects collinearity assertions with coincident reference points", () => {
    const result = evaluateGeometryScene({
      version: 1,
      objects: [
        { id: "A", kind: "point", x: 0, y: 0 },
        { id: "B", kind: "point", x: 1, y: 1 },
        { id: "C", kind: "point", x: 0, y: 1 },
      ],
      assertions: [{ kind: "collinear", points: ["A", "A", "B", "C"] }],
    });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "DEGENERATE_CONSTRUCTION",
      path: "assertions[0]",
    }));
  });

  it("validates right-angle marker references without changing geometry evaluation", () => {
    const scene: GeometryScene = {
      version: 1,
      objects: [
        { id: "D", kind: "point", x: 0, y: 0 },
        { id: "E", kind: "point", x: 1, y: 0 },
        { id: "F", kind: "point", x: 0, y: 1 },
        { id: "DE", kind: "segment", points: ["D", "E"] },
        { id: "DF", kind: "segment", points: ["D", "F"] },
      ],
      assertions: [],
      markers: [{ id: "rightAngle_D", kind: "right_angle_marker", vertex: "D", arms: ["DE", "DF"] }],
    };

    expect(validateGeometryScene(scene)).toEqual([]);
    expect(evaluateGeometryScene(scene).diagnostics).toEqual([]);
  });

  it("rejects right-angle markers that reference a non-linear arm", () => {
    const diagnostics = validateGeometryScene({
      version: 1,
      objects: [
        { id: "D", kind: "point", x: 0, y: 0 },
        { id: "E", kind: "point", x: 1, y: 0 },
        { id: "DE", kind: "segment", points: ["D", "E"] },
      ],
      assertions: [],
      markers: [{ id: "rightAngle_D", kind: "right_angle_marker", vertex: "D", arms: ["DE", "D"] }],
    });

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: "TYPE_MISMATCH",
      path: "markers[0].arms[1]",
    }));
  });

  it("accepts axes and linear motion metadata on a point", () => {
    const scene: GeometryScene = {
      version: 1,
      objects: [
        { id: "axes", kind: "axes", xRange: [-2, 2], yRange: [-2, 2] },
        { id: "P", kind: "point", x: -1, y: 0, motion: { kind: "linear", to: { x: 1, y: 1 } } },
      ],
      assertions: [],
    };
    expect(validateGeometryScene(scene)).toEqual([]);
    expect(evaluateGeometryScene(scene).diagnostics).toEqual([]);
  });

  it("enforces point-on-curve semantics instead of trusting approximate coordinates", () => {
    const valid = evaluateGeometryScene({
      version: 1,
      objects: [
        { id: "O", kind: "point", x: 0, y: 0 },
        { id: "C", kind: "ellipse", center: "O", radiusX: 2, radiusY: 1 },
        { id: "P", kind: "point", x: Math.sqrt(3), y: 0.5, on: "C" },
      ],
      assertions: [],
    });
    expect(valid.diagnostics).toHaveLength(0);
    const invalid = evaluateGeometryScene({
      version: 1,
      objects: [
        { id: "O", kind: "point", x: 0, y: 0 },
        { id: "C", kind: "ellipse", center: "O", radiusX: 2, radiusY: 1 },
        { id: "P", kind: "point", x: 0, y: 0, on: "C" },
      ],
      assertions: [],
    });
    expect(invalid.diagnostics.some((diagnostic) => diagnostic.path === "objects.P.on")).toBe(true);
  });

  it("validates cross-field references in Stage-1 facts", () => {
    expect(validateProblemFacts({
      problem_type: "平面几何",
      task_goal: "构造点 P",
      objects: [{ id: "A", type: "点", description: "", properties: {}, source: "text" }],
      relations: [{ type: "共线", objects: ["A", "missing"], source: "text" }],
      constraints: [],
      dynamics: [],
      annotations: [],
      ambiguities: [],
      notes: "",
    })).toEqual(["relations[0].objects[1]: object \"missing\" does not exist"]);
  });
});
