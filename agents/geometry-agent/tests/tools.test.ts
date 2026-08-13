import { describe, expect, it } from "vitest";

import { createGeometryTools, createRunWorkspace } from "../src/tools";

describe("geometry agent tools", () => {
  it("only finalizes an artifact after facts, a valid scene, and lesson timeline have been accepted", async () => {
    const workspace = createRunWorkspace();
    const tools = createGeometryTools(workspace);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    await expect(byName.get("finalize_geometry_artifact")!.execute("final", {})).rejects.toThrow(
      "Cannot finalize before problem facts, geometry scene, and lesson timeline are accepted",
    );

    await byName.get("submit_problem_facts")!.execute("facts", {
      problemType: "plane_geometry",
      tasks: [{ id: "prove-1", prompt: "证明 DE = AD" }],
      objects: [
        { id: "A", kind: "point", source: "text" },
        { id: "B", kind: "point", source: "text" },
        { id: "C", kind: "point", source: "text" },
        { id: "D", kind: "point", source: "text" },
        { id: "E", kind: "point", source: "derived" },
      ],
      relations: [{ kind: "midpoint", objects: ["D", "B", "C"], source: "text" }],
      constraints: [{ expression: "DE = AD", source: "text" }],
      ambiguities: [],
    });
    await byName.get("submit_geometry_scene")!.execute("scene", {
      version: 1,
      objects: [
        { id: "A", kind: "point", x: 0, y: 3 },
        { id: "B", kind: "point", x: -4, y: 0 },
        { id: "C", kind: "point", x: 4, y: 0 },
        { id: "D", kind: "midpoint", points: ["B", "C"] },
        { id: "E", kind: "reflection", point: "A", center: "D" },
        { id: "AD", kind: "segment", points: ["A", "D"] },
        { id: "DE", kind: "segment", points: ["D", "E"] },
      ],
      assertions: [{ kind: "equal_length", segments: ["AD", "DE"] }],
    });
    await byName.get("submit_lesson_timeline")!.execute("timeline", {
      beats: [
        {
          id: "motivation",
          kind: "motivation",
          narration: "把中线延长为相等线段，寻找全等三角形。",
          actions: [{ kind: "focus", objectIds: ["AD"] }],
        },
        {
          id: "construct",
          kind: "construction",
          narration: "作点 E，使 D 是 AE 的中点。",
          actions: [{ kind: "create", objectIds: ["E", "DE"] }],
        },
      ],
    });

    const result = await byName.get("finalize_geometry_artifact")!.execute("final", {});

    expect(result.details.status).toBe("finalized");
    expect(workspace.artifact?.manimWebSource).toContain("export class GeometryLessonScene");
  });

  it("rejects an unmotivated timeline that references an unknown scene object", async () => {
    const workspace = createRunWorkspace();
    const byName = new Map(createGeometryTools(workspace).map((tool) => [tool.name, tool]));
    await byName.get("submit_problem_facts")!.execute("facts", {
      problemType: "plane_geometry",
      tasks: [{ id: "construct", prompt: "连接 AB" }],
      objects: [
        { id: "A", kind: "point", source: "text" },
        { id: "B", kind: "point", source: "text" },
      ],
      relations: [],
      constraints: [],
      ambiguities: [],
    });
    await byName.get("submit_geometry_scene")!.execute("scene", {
      version: 1,
      objects: [
        { id: "A", kind: "point", x: 0, y: 0 },
        { id: "B", kind: "point", x: 2, y: 0 },
        { id: "AB", kind: "segment", points: ["A", "B"] },
      ],
      assertions: [],
    });

    await expect(byName.get("submit_lesson_timeline")!.execute("timeline", {
      beats: [{
        id: "construct",
        kind: "construction",
        narration: "连接 AB。",
        actions: [{ kind: "create", objectIds: ["missing"] }],
      }],
    })).rejects.toThrow("Timeline must start with a motivation beat");
  });
});
