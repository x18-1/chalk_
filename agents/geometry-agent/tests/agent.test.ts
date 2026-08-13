import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { solveGeometryProblem } from "../src/agent";

describe("geometry Pi Agent", () => {
  it("completes a full geometry artifact through Pi tool calls", async () => {
    const faux = fauxProvider({ models: [{ id: "geometry-test", input: ["text", "image"] }] });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("submit_problem_facts", {
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
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("submit_geometry_scene", {
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
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("submit_lesson_timeline", {
        beats: [
          {
            id: "motivation",
            kind: "motivation",
            narration: "把中线延长为相等线段，寻找全等关系。",
            actions: [{ kind: "focus", objectIds: ["AD"] }],
          },
        ],
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("finalize_geometry_artifact", {}), { stopReason: "toolUse" }),
    ]);
    const models = createModels();
    models.setProvider(faux.provider);

    const result = await solveGeometryProblem({
      problem: "三角形 ABC 中，D 是 BC 中点。延长 AD 到 E，使 DE=AD。证明 DE=AD。",
      modelClient: { models, model: faux.getModel() },
    });

    expect(result.artifact.scene.objects.map((object) => object.id)).toContain("E");
    expect(result.artifact.manimWebSource).toContain("class GeometryLessonScene");
    expect(faux.state.callCount).toBe(4);
  });

  it("feeds deterministic tool failures back to the model for repair", async () => {
    const faux = fauxProvider({ models: [{ id: "geometry-repair", input: ["text", "image"] }] });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("submit_problem_facts", {
        problemType: "plane_geometry",
        tasks: [{ id: "construct", prompt: "构造中点 D" }],
        objects: [
          { id: "B", kind: "point", source: "text" },
          { id: "C", kind: "point", source: "text" },
          { id: "D", kind: "point", source: "derived" },
        ],
        relations: [{ kind: "midpoint", objects: ["D", "B", "C"], source: "text" }],
        constraints: [],
        ambiguities: [],
      }), { stopReason: "toolUse" }),
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
        beats: [{
          id: "motivation",
          kind: "motivation",
          narration: "先找出线段 BC 的两个端点。",
          actions: [{ kind: "focus", objectIds: ["B", "C"] }],
        }],
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("finalize_geometry_artifact", {}), { stopReason: "toolUse" }),
    ]);
    const models = createModels();
    models.setProvider(faux.provider);

    const result = await solveGeometryProblem({
      problem: "B、C 是线段端点，D 是 BC 中点。",
      modelClient: { models, model: faux.getModel() },
    });

    expect(result.artifact.scene.objects).toHaveLength(3);
    expect(faux.state.callCount).toBe(5);
  });
});
