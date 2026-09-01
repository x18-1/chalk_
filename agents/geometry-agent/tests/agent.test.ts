import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { solveGeometryProblem } from "../src/agent";

const facts = {
  problem_type: "平面几何",
  task_goal: "证明 DE = AD",
  objects: [
    { id: "A", type: "点", description: "顶点 A", properties: {}, source: "text" },
    { id: "B", type: "点", description: "端点 B", properties: {}, source: "text" },
    { id: "C", type: "点", description: "端点 C", properties: {}, source: "text" },
    { id: "D", type: "点", description: "BC 的中点", properties: {}, source: "text" },
    { id: "E", type: "点", description: "延长后得到的点", properties: {}, source: "figure" },
  ],
  relations: [{ type: "中点", objects: ["D", "B", "C"], source: "text" }],
  constraints: [{ type: "长度", expression: "DE = AD", description: "题目给定", source: "text" }],
  dynamics: [],
  annotations: [],
  ambiguities: [],
  notes: "",
};

const scene = {
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
};

const timeline = {
  beats: [{
    id: "motivation",
    kind: "motivation",
    narration: "把中线延长为相等线段，寻找全等关系。",
    actions: [{ kind: "focus", objectIds: ["AD"] }],
  }],
};

function testClient(id: string) {
  const faux = fauxProvider({ models: [{ id, input: ["text", "image"] }] });
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, modelClient: { models, model: faux.getModel() } };
}

describe("two-stage geometry Pi Agent", () => {
  it("extracts facts first, then constructs and finalizes the artifact", async () => {
    const { faux, modelClient } = testClient("geometry-test");
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("submit_problem_facts", facts), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("submit_geometry_scene", scene), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("submit_lesson_timeline", timeline), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("finalize_geometry_artifact", {}), { stopReason: "toolUse" }),
    ]);

    const result = await solveGeometryProblem({
      problem: "三角形 ABC 中，D 是 BC 中点。延长 AD 到 E，使 DE=AD。",
      modelClient,
    });

    expect(result.stage1.task_goal).toBe("证明 DE = AD");
    expect(result.artifact.scene.objects.map((object) => object.id)).toContain("E");
    expect(faux.state.callCount).toBe(4);
  });

  it("feeds deterministic stage-2 failures back to the model for repair", async () => {
    const { faux, modelClient } = testClient("geometry-repair");
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("submit_problem_facts", facts), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("submit_geometry_scene", {
        version: 1,
        objects: [{ id: "D", kind: "midpoint", points: ["B", "C"] }],
        assertions: [],
      }), { stopReason: "toolUse" }),
      (context) => {
        const lastMessage = context.messages.at(-1);
        expect(lastMessage).toMatchObject({ role: "toolResult", isError: true });
        const text = lastMessage?.role === "toolResult" && lastMessage.content[0]?.type === "text"
          ? lastMessage.content[0].text
          : "";
        expect(text).toContain("OBJECT_NOT_FOUND");
        return fauxAssistantMessage(fauxToolCall("submit_geometry_scene", {
          version: 1,
          objects: [
            { id: "B", kind: "point", x: -2, y: 0 },
            { id: "C", kind: "point", x: 2, y: 0 },
            { id: "D", kind: "midpoint", points: ["B", "C"] },
          ],
          assertions: [],
        }), { stopReason: "toolUse" });
      },
      fauxAssistantMessage(fauxToolCall("submit_lesson_timeline", {
        beats: [{ id: "motivation", kind: "motivation", narration: "先找出线段 BC 的两个端点。", actions: [{ kind: "focus", objectIds: ["B", "C"] }] }],
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("finalize_geometry_artifact", {}), { stopReason: "toolUse" }),
    ]);

    const result = await solveGeometryProblem({ problem: "B、C 是线段端点，D 是 BC 中点。", modelClient });
    expect(result.artifact.scene.objects).toHaveLength(3);
    expect(faux.state.callCount).toBe(5);
  });

  it("forwards the reference image to both extraction and construction stages", async () => {
    const { faux, modelClient } = testClient("geometry-image-input");
    let stage2ContextText = "";
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("submit_problem_facts", facts), { stopReason: "toolUse" }),
      (context) => {
        stage2ContextText = JSON.stringify(context.messages);
        return fauxAssistantMessage(fauxToolCall("submit_geometry_scene", scene), { stopReason: "toolUse" });
      },
      fauxAssistantMessage(fauxToolCall("submit_lesson_timeline", timeline), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("finalize_geometry_artifact", {}), { stopReason: "toolUse" }),
    ]);

    await solveGeometryProblem({
      problem: "三角形 ABC 中，D 是 BC 中点。",
      images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
      modelClient,
    });
    expect(stage2ContextText).toContain("aW1hZ2U=");
  });

  it("finalizes a GeoGebra command script artifact", async () => {
    const { faux, modelClient } = testClient("geometry-geogebra");
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("submit_problem_facts", facts), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("submit_geogebra_script", {
        mode: "2D",
        commands: ["SetAxesVisible(true, true)", "A = (0, 3)", "B = (-1, 0)", "Segment(A, B)"],
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("verify_geogebra_script", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("submit_lesson_timeline", {
        beats: [{ id: "motivation", kind: "motivation", narration: "先观察图形。", actions: [{ kind: "focus", objectIds: ["A", "B"] }] }],
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("finalize_geometry_artifact", {}), { stopReason: "toolUse" }),
    ]);
    const result = await solveGeometryProblem({ problem: "绘制线段 AB。", modelClient });
    expect(result.artifact.geoGebra?.commands).toContain("Segment[A, B]");
    expect(result.artifact.geoGebraSource).toContain("MODE: 2D");
  });
});
