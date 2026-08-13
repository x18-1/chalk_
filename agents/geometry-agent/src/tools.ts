import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type TSchema } from "typebox";
import { toJSONSchema, type ZodType } from "zod";

import {
  compileManimWebScene,
  evaluateGeometryScene,
  geometrySceneSchema,
  lessonTimelineSchema,
  problemFactsSchema,
  type GeometryDiagnostic,
  type GeometryScene,
  type LessonTimeline,
  type ProblemFacts,
} from "./geometry";

export type GeometryArtifact = {
  problemFacts: ProblemFacts;
  scene: GeometryScene;
  lessonTimeline: LessonTimeline;
  diagnostics: GeometryDiagnostic[];
  manimWebSource: string;
};

export type RunWorkspace = {
  problemFacts?: ProblemFacts;
  scene?: GeometryScene;
  lessonTimeline?: LessonTimeline;
  artifact?: GeometryArtifact;
};

export function createRunWorkspace(): RunWorkspace {
  return {};
}

function result(content: string, details: Record<string, unknown>, terminate = false) {
  return {
    content: [{ type: "text" as const, text: content }],
    details,
    ...(terminate ? { terminate: true } : {}),
  };
}

function toolParameters<T>(schema: ZodType<T>) {
  const jsonSchema = toJSONSchema(schema) as TSchema & Record<string, unknown>;
  const { $schema: _schema, "~standard": _standard, ...parameters } = jsonSchema;
  return Type.Unsafe<T>(parameters);
}

const problemFactsParameters = toolParameters(problemFactsSchema);

const geometrySceneParameters = toolParameters(geometrySceneSchema);

const lessonTimelineParameters = toolParameters(lessonTimelineSchema);

const finalizeParameters = Type.Object({});

function formatZodError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

export function createGeometryTools(workspace: RunWorkspace): AgentTool[] {
  const submitProblemFacts: AgentTool<typeof problemFactsParameters> = {
    name: "submit_problem_facts",
    label: "Submit extracted problem facts",
    description: "Submit the directly stated and visually observed geometry facts. Do not include proof conclusions as source facts.",
    parameters: problemFactsParameters,
    async execute(_toolCallId, params) {
      const parsed = problemFactsSchema.safeParse(params);
      if (!parsed.success) throw new Error(`Invalid problem facts: ${JSON.stringify(formatZodError(parsed.error))}`);
      workspace.problemFacts = parsed.data;
      return result("Problem facts accepted.", { status: "accepted", artifact: "problem_facts" });
    },
  };

  const submitGeometryScene: AgentTool<typeof geometrySceneParameters> = {
    name: "submit_geometry_scene",
    label: "Submit a geometry scene",
    description: "Submit a 2D semantic geometry DSL. It is validated and evaluated deterministically before it can be used.",
    parameters: geometrySceneParameters,
    async execute(_toolCallId, params) {
      const parsed = geometrySceneSchema.safeParse(params);
      if (!parsed.success) throw new Error(`Invalid geometry scene: ${JSON.stringify(formatZodError(parsed.error))}`);
      const evaluation = evaluateGeometryScene(parsed.data);
      if (evaluation.diagnostics.length > 0) {
        throw new Error(`Geometry scene rejected: ${JSON.stringify(evaluation.diagnostics)}`);
      }
      workspace.scene = parsed.data;
      return result("Geometry scene accepted.", { status: "accepted", artifact: "geometry_scene" });
    },
  };

  const submitLessonTimeline: AgentTool<typeof lessonTimelineParameters> = {
    name: "submit_lesson_timeline",
    label: "Submit a lesson timeline",
    description: "Submit short student-facing teaching beats. Every nontrivial construction must be motivated before it appears.",
    parameters: lessonTimelineParameters,
    async execute(_toolCallId, params) {
      const parsed = lessonTimelineSchema.safeParse(params);
      if (!parsed.success) throw new Error(`Invalid lesson timeline: ${JSON.stringify(formatZodError(parsed.error))}`);
      if (parsed.data.beats[0]?.kind !== "motivation") {
        throw new Error("Timeline must start with a motivation beat");
      }
      if (!workspace.scene) {
        throw new Error("Submit a valid geometry scene before the lesson timeline");
      }
      const sceneObjectIds = new Set(workspace.scene.objects.map((object) => object.id));
      const unknownObjectIds = parsed.data.beats.flatMap((beat) =>
        beat.actions.flatMap((action) => action.objectIds.filter((id) => !sceneObjectIds.has(id))),
      );
      if (unknownObjectIds.length > 0) {
        throw new Error(`Lesson timeline references unknown scene objects: ${[...new Set(unknownObjectIds)].join(", ")}`);
      }
      workspace.lessonTimeline = parsed.data;
      return result("Lesson timeline accepted.", { status: "accepted", artifact: "lesson_timeline" });
    },
  };

  const finalizeGeometryArtifact: AgentTool<typeof finalizeParameters> = {
    name: "finalize_geometry_artifact",
    label: "Finalize the geometry artifact",
    description: "Create the final artifact only after accepted problem facts, geometry scene, and lesson timeline exist.",
    parameters: finalizeParameters,
    async execute() {
      if (!workspace.problemFacts || !workspace.scene || !workspace.lessonTimeline) {
        throw new Error("Cannot finalize before problem facts, geometry scene, and lesson timeline are accepted");
      }

      const diagnostics = evaluateGeometryScene(workspace.scene).diagnostics;
      if (diagnostics.length > 0) {
        throw new Error(`Cannot finalize invalid geometry: ${JSON.stringify(diagnostics)}`);
      }
      const source = compileManimWebScene(workspace.scene);
      workspace.artifact = {
        problemFacts: workspace.problemFacts,
        scene: workspace.scene,
        lessonTimeline: workspace.lessonTimeline,
        diagnostics,
        manimWebSource: source,
      };
      return result("Geometry artifact finalized.", { status: "finalized" }, true);
    },
  };

  return [submitProblemFacts, submitGeometryScene, submitLessonTimeline, finalizeGeometryArtifact];
}
