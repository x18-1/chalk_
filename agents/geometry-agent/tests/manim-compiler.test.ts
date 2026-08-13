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

    expect(source).toContain('import { Circle, Create, Dot, Line, Polygon, Scene } from "manim-web";');
    expect(source).toContain('const object_A = new Dot({ point: [0, 3, 0] });');
    expect(source).toContain('const object_D = new Dot({ point: [0, 0, 0] });');
    expect(source).toContain('const object_AB = new Line({ start: [0, 3, 0], end: [-4, 0, 0] });');
    expect(source).toContain('const object_circleD = new Circle({ radius: 2 }).moveTo([0, 0, 0]);');
    expect(source).toContain('await this.play(new Create(object_AB), new Create(object_circleD));');
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
});
