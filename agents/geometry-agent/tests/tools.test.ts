import { describe, expect, it } from "vitest";

import { createGeometryStage2Tools, createProblemFactsTool, createRunWorkspace } from "../src/tools";

const facts = {
  problem_type: "平面几何" as const,
  task_goal: "证明 DE = AD",
  objects: [
    { id: "A", type: "点", description: "顶点 A", properties: {}, source: "text" as const },
    { id: "B", type: "点", description: "端点 B", properties: {}, source: "text" as const },
    { id: "C", type: "点", description: "端点 C", properties: {}, source: "text" as const },
    { id: "D", type: "点", description: "BC 的中点", properties: {}, source: "text" as const },
    { id: "E", type: "点", description: "延长后得到的点", properties: {}, source: "figure" as const },
  ],
  relations: [{ type: "中点", objects: ["D", "B", "C"], source: "text" as const }],
  constraints: [{ type: "长度", expression: "DE = AD", description: "题目给定", source: "text" as const }],
  dynamics: [],
  annotations: [],
  ambiguities: [],
  notes: "",
};

const scene = {
  version: 1 as const,
  objects: [
    { id: "A", kind: "point" as const, x: 0, y: 3 },
    { id: "B", kind: "point" as const, x: -4, y: 0 },
    { id: "C", kind: "point" as const, x: 4, y: 0 },
    { id: "D", kind: "midpoint" as const, points: ["B", "C"] as [string, string] },
    { id: "E", kind: "reflection" as const, point: "A", center: "D" },
    { id: "AD", kind: "segment" as const, points: ["A", "D"] as [string, string] },
    { id: "DE", kind: "segment" as const, points: ["D", "E"] as [string, string] },
  ],
  assertions: [{ kind: "equal_length" as const, segments: ["AD", "DE"] as [string, string] }],
};

describe("geometry agent tools", () => {
  it("requires GeoGebra verification before finalization", async () => {
    const workspace = createRunWorkspace();
    await createProblemFactsTool(workspace).execute("facts", facts);
    const byName = new Map(createGeometryStage2Tools(workspace).map((tool) => [tool.name, tool]));
    await byName.get("submit_geogebra_script")!.execute("script", { mode: "2D", commands: ["A = (0, 0)"] });
    await byName.get("submit_lesson_timeline")!.execute("timeline", {
      beats: [{ id: "motivation", kind: "motivation", narration: "观察点 A。", actions: [{ kind: "focus", objectIds: ["A"] }] }],
    });
    await expect(byName.get("finalize_geometry_artifact")!.execute("final", {})).rejects.toThrow("Verify the GeoGebra script");
    await byName.get("verify_geogebra_script")!.execute("verify", {});
    await expect(byName.get("finalize_geometry_artifact")!.execute("final", {})).resolves.toBeTruthy();
  });

  it("returns applet diagnostics to the model for repair", async () => {
    const workspace = createRunWorkspace({ verifyGeoGebra: () => ["commands[1]: undefined variable Q"] });
    await createProblemFactsTool(workspace).execute("facts", facts);
    const byName = new Map(createGeometryStage2Tools(workspace).map((tool) => [tool.name, tool]));
    await byName.get("submit_geogebra_script")!.execute("script", { mode: "2D", commands: ["A = (0, 0)"] });
    await expect(byName.get("verify_geogebra_script")!.execute("verify", {})).rejects.toThrow("undefined variable Q");
    expect(workspace.geoGebraVerification).toBeUndefined();
  });

  it("only finalizes after stage 1 facts, a valid scene, and a timeline", async () => {
    const workspace = createRunWorkspace();
    const stage1 = createProblemFactsTool(workspace);
    const byName = new Map(createGeometryStage2Tools(workspace).map((tool) => [tool.name, tool]));

    await expect(byName.get("finalize_geometry_artifact")!.execute("final", {})).rejects.toThrow(
      "Cannot finalize before problem facts, geometry scene, and lesson timeline are accepted",
    );
    await stage1.execute("facts", facts);
    await byName.get("submit_geometry_scene")!.execute("scene", scene);
    await byName.get("submit_lesson_timeline")!.execute("timeline", {
      beats: [
        {
          id: "motivation",
          kind: "motivation",
          narration: "把中线延长为相等线段，寻找全等关系。",
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
    expect(workspace.artifact?.manimWebSource).toContain("export async function createGeometryLessonScene");
  });

  it("rejects a timeline that does not start with motivation", async () => {
    const workspace = createRunWorkspace();
    await createProblemFactsTool(workspace).execute("facts", facts);
    const byName = new Map(createGeometryStage2Tools(workspace).map((tool) => [tool.name, tool]));
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

  it("requires motion metadata for Stage-1 moving points", async () => {
    const workspace = createRunWorkspace();
    const stage1Facts = { ...facts, dynamics: [{ object_id: "A", type: "动点", constraint: "在线段 AB 上移动", param: "t", param_range: "0≤t≤1", depends_on: ["B"] }] };
    await createProblemFactsTool(workspace).execute("facts", stage1Facts);
    const byName = new Map(createGeometryStage2Tools(workspace).map((tool) => [tool.name, tool]));
    await expect(byName.get("submit_geometry_scene")!.execute("scene", {
      version: 1,
      objects: [
        { id: "A", kind: "point", x: 0, y: 0 },
        { id: "B", kind: "point", x: 2, y: 0 },
        { id: "AB", kind: "segment", points: ["A", "B"] },
      ],
      assertions: [],
    })).rejects.toThrow("Dynamic points must declare motion metadata");
  });
});
