import { describe, expect, it } from "vitest";

import { compileManimWebScene, type GeometryScene } from "../src/geometry";

describe("manim-web compiler", () => {
  it("compiles a valid semantic scene to a deterministic manim-web module", () => {
    const scene: GeometryScene = {
      version: 1,
      objects: [
        { id: "A", kind: "point", x: 0, y: 3 },
        { id: "B", kind: "point", x: -4, y: 0 },
        { id: "C", kind: "point", x: 4, y: 0 },
        { id: "D", kind: "midpoint", points: ["B", "C"] },
        { id: "AB", kind: "segment", points: ["A", "B"] },
        { id: "circleD", kind: "circle", center: "D", radius: 2 },
      ],
      assertions: [],
    };

    const source = compileManimWebScene(scene);

    expect(source).toContain('import { Axes, Circle, Create, Dot, Ellipse, FunctionGraph, Line, Polygon, RightAngle, Scene, ValueTracker } from "manim-web";');
    expect(source).toContain('const object_A = new Dot({ point: [0, 3, 0] });');
    expect(source).toContain('const object_D = new Dot({ point: [0, 0, 0] });');
    expect(source).toContain('const object_AB = new Line({ start: [0, 3, 0], end: [-4, 0, 0] });');
    expect(source).toContain('const object_circleD = new Circle({ radius: 2, center: [0, 0, 0] });');
    expect(source).toContain('const scene = new Scene(container, { backgroundColor: "#1C1C1C", headless: container === null });');
    expect(source).toContain('await scene.play(new Create(object_AB), new Create(object_circleD));');
    expect(source).not.toContain("construct():");
  });

  it("keeps valid DSL IDs from colliding with manim-web imports", () => {
    const source = compileManimWebScene({
      version: 1,
      objects: [{ id: "Scene", kind: "point", x: 0, y: 0 }],
      assertions: [],
    });

    expect(source).toContain("const object_Scene = new Dot");
    expect(source).not.toContain("const Scene =");
  });

  it("compiles a figure right-angle marker as a finite RightAngle mobject", () => {
    const source = compileManimWebScene({
      version: 1,
      objects: [
        { id: "D", kind: "point", x: 0, y: 0 },
        { id: "E", kind: "point", x: 2, y: 0 },
        { id: "F", kind: "point", x: 0, y: 2 },
        { id: "DE", kind: "segment", points: ["D", "E"] },
        { id: "DF", kind: "segment", points: ["D", "F"] },
      ],
      assertions: [],
      markers: [{ id: "rightAngle_D", kind: "right_angle_marker", vertex: "D", arms: ["DE", "DF"], size: 0.24 }],
    });

    expect(source).toContain("new RightAngle({ points: [[2, 0, 0], [0, 0, 0], [0, 2, 0]] }, { size: 0.24");
    expect(source).toContain("new Create(object_rightAngle_D)");
  });

  it("compiles coordinate axes and an explicitly moving point", () => {
    const source = compileManimWebScene({
      version: 1,
      objects: [
        { id: "axes", kind: "axes", xRange: [-4, 4, 1], yRange: [-3, 3, 1], tips: true },
        { id: "P", kind: "point", x: -2, y: 0, motion: { kind: "linear", to: { x: 2, y: 1 }, duration: 2 } },
      ],
      assertions: [],
    });

    expect(source).toContain("new Axes({ xRange: [-4, 4, 1], yRange: [-3, 3, 1]");
    expect(source).toContain("new Dot({ point: object_axes.coordsToPoint(-2, 0) })");
    expect(source).toContain("new ValueTracker(0)");
    expect(source).toContain("tracker_P.animateTo(1, { duration: 2 })");
  });

  it("compiles segment and ellipse motion paths", () => {
    const source = compileManimWebScene({
      version: 1,
      objects: [
        { id: "A", kind: "point", x: 0, y: 0 },
        { id: "B", kind: "point", x: 2, y: 0 },
        { id: "AB", kind: "segment", points: ["A", "B"] },
        { id: "P", kind: "point", x: 0, y: 0, motion: { kind: "segment", path: "AB" } },
        { id: "Q", kind: "point", x: 1, y: 0, motion: { kind: "ellipse", center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1, startAngle: 0, endAngle: 3.14 } },
      ],
      assertions: [],
    });
    expect(source).toContain("object_AB");
    expect(source).toContain("tracker_P");
    expect(source).toContain("tracker_Q");
    expect(source).toContain("Math.cos");
  });

  it("keeps ellipse and parabola objects as real manim-web curves", () => {
    const source = compileManimWebScene({
      version: 1,
      objects: [
        { id: "O", kind: "point", x: 0, y: 0 },
        { id: "ellipseC", kind: "ellipse", center: "O", radiusX: 2, radiusY: 1 },
        { id: "parabolaP", kind: "parabola", a: 1, b: 0, c: 0, xRange: [-2, 2] },
      ],
      assertions: [],
    });
    expect(source).toContain("new Ellipse({ width: 4, height: 2");
    expect(source).toContain("new FunctionGraph({ func: (x) => 1 * x * x + 0 * x + 0");
    expect(source).not.toContain("ellipseC = new Dot");
  });
});
