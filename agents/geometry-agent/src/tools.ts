import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type TSchema } from "typebox";
import { toJSONSchema, type ZodType } from "zod";

import {
  compileManimWebScene,
  evaluateGeometryScene,
  geometrySceneSchema,
  lessonTimelineSchema,
  problemFactsSchema,
  validateProblemFacts,
  type GeometryDiagnostic,
  type GeometryScene,
  type LessonTimeline,
  type ProblemFacts,
} from "./geometry";
import { geoGebraScriptSchema, geoGebraObjectNames, normalizeGeoGebraScript, validateGeoGebraScript, type GeoGebraScript } from "./geogebra";

export type GeometryArtifact = {
  problemFacts: ProblemFacts;
  scene: GeometryScene;
  lessonTimeline: LessonTimeline;
  diagnostics: GeometryDiagnostic[];
  manimWebSource: string;
  geoGebra?: GeoGebraScript;
  geoGebraSource?: string;
};

export type RunWorkspace = {
  problemFacts?: ProblemFacts;
  scene?: GeometryScene;
  lessonTimeline?: LessonTimeline;
  artifact?: GeometryArtifact;
  geoGebra?: GeoGebraScript;
  geoGebraVerification?: { mode: "static" | "applet"; diagnostics: string[] };
  onStage1?: (facts: ProblemFacts) => void | Promise<void>;
  onScene?: (scene: GeometryScene) => void | Promise<void>;
  onGeoGebra?: (script: GeoGebraScript) => void | Promise<void>;
  verifyGeoGebra?: (script: GeoGebraScript) => Promise<string[]> | string[];
  onTimeline?: (timeline: LessonTimeline) => void | Promise<void>;
};

export function createRunWorkspace(hooks: Pick<RunWorkspace, "onStage1" | "onScene" | "onGeoGebra" | "onTimeline" | "verifyGeoGebra"> = {}): RunWorkspace {
  return hooks;
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
const geoGebraScriptParameters = toolParameters(geoGebraScriptSchema);

const lessonTimelineParameters = toolParameters(lessonTimelineSchema);

const finalizeParameters = Type.Object({});

function formatZodError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

export function createProblemFactsTool(workspace: RunWorkspace): AgentTool {
  const submitProblemFacts: AgentTool<typeof problemFactsParameters> = {
    name: "submit_problem_facts",
    label: "Submit extracted problem facts",
    description: "Submit the directly stated and visually observed geometry facts. Do not include proof conclusions as source facts.",
    parameters: problemFactsParameters,
    async execute(_toolCallId, params) {
      const parsed = problemFactsSchema.safeParse(params);
      if (!parsed.success) throw new Error(`Invalid problem facts: ${JSON.stringify(formatZodError(parsed.error))}`);
      const referenceErrors = validateProblemFacts(parsed.data);
      if (referenceErrors.length > 0) throw new Error(`Invalid problem facts: ${JSON.stringify(referenceErrors)}`);
      workspace.problemFacts = parsed.data;
      await workspace.onStage1?.(parsed.data);
      return result("Problem facts accepted.", { status: "accepted", artifact: "problem_facts" }, true);
    },
  };

  return submitProblemFacts;
}

export function createGeometryStage2Tools(workspace: RunWorkspace): AgentTool[] {

  const submitGeoGebraScript: AgentTool<typeof geoGebraScriptParameters> = {
    name: "submit_geogebra_script",
    label: "Submit GeoGebra construction script",
    description: "Submit a MODE header and one GeoGebra command per line. The host executes commands incrementally and checks the resulting object names.",
    parameters: geoGebraScriptParameters,
    async execute(_toolCallId, params) {
      const parsed = geoGebraScriptSchema.safeParse(params);
      if (!parsed.success) throw new Error(`Invalid GeoGebra script: ${JSON.stringify(formatZodError(parsed.error))}`);
      const normalized = normalizeGeoGebraScript(parsed.data);
      const diagnostics = validateGeoGebraScript(normalized);
      if (diagnostics.length > 0) throw new Error(`GeoGebra script rejected: ${JSON.stringify(diagnostics)}`);
      workspace.geoGebra = normalized;
      workspace.geoGebraVerification = undefined;
      await workspace.onGeoGebra?.(parsed.data);
      return result("GeoGebra script accepted and normalized.", { status: "accepted", artifact: "geogebra_script", objectNames: [...geoGebraObjectNames(normalized)] });
    },
  };

  const verifyGeoGebraScript: AgentTool<typeof finalizeParameters> = {
    name: "verify_geogebra_script",
    label: "Verify GeoGebra construction script",
    description: "Verify the submitted GeoGebra script before creating a final artifact. The host may run a real Classic applet and return command-level diagnostics.",
    parameters: finalizeParameters,
    async execute() {
      if (!workspace.geoGebra) throw new Error("Submit a GeoGebra script before verification");
      const staticDiagnostics = validateGeoGebraScript(workspace.geoGebra);
      if (staticDiagnostics.length > 0) throw new Error(`GeoGebra script rejected during verification: ${JSON.stringify(staticDiagnostics)}`);
      const appletDiagnostics = workspace.verifyGeoGebra ? await workspace.verifyGeoGebra(workspace.geoGebra) : [];
      if (appletDiagnostics.length > 0) throw new Error(`GeoGebra applet verification failed: ${JSON.stringify(appletDiagnostics)}`);
      const mode = workspace.verifyGeoGebra ? "applet" : "static";
      workspace.geoGebraVerification = { mode, diagnostics: [] };
      return result(`GeoGebra script verified (${mode}).`, { status: "verified", verificationMode: mode });
    },
  };

  const submitGeometryScene: AgentTool<typeof geometrySceneParameters> = {
    name: "submit_geometry_scene",
    label: "Submit a geometry scene",
    description: "Submit a 2D semantic geometry DSL and optional finite figure markers (such as right-angle squares). It is validated and evaluated deterministically before it can be used.",
    parameters: geometrySceneParameters,
    async execute(_toolCallId, params) {
      const parsed = geometrySceneSchema.safeParse(params);
      if (!parsed.success) throw new Error(`Invalid geometry scene: ${JSON.stringify(formatZodError(parsed.error))}`);
      const evaluation = evaluateGeometryScene(parsed.data);
      if (evaluation.diagnostics.length > 0) {
        throw new Error(`Geometry scene rejected: ${JSON.stringify(evaluation.diagnostics)}`);
      }
      const missingMotions = (workspace.problemFacts?.dynamics ?? [])
        .filter((dynamic) => dynamic.type.includes("动点") || dynamic.type.toLowerCase().includes("moving"))
        .map((dynamic) => dynamic.object_id)
        .filter((objectId) => {
          const object = parsed.data.objects.find((candidate) => candidate.id === objectId);
          return object?.kind === "point" && !object.motion;
        });
      if (missingMotions.length > 0) {
        throw new Error(`Dynamic points must declare motion metadata: ${[...new Set(missingMotions)].join(", ")}`);
      }
      const missingLoci = (workspace.problemFacts?.relations ?? [])
        .filter((relation) => relation.type.includes("点在") && relation.objects.length >= 2)
        .map((relation) => ({ pointId: relation.objects[0]!, locusId: relation.objects[1]! }))
        .filter(({ pointId, locusId }) => {
          const object = parsed.data.objects.find((candidate) => candidate.id === pointId);
          return object?.kind === "point" && object.on !== locusId;
        });
      if (missingLoci.length > 0) {
        throw new Error(`Point-on-locus relations must be explicit in the DSL: ${missingLoci.map(({ pointId, locusId }) => `${pointId} on ${locusId}`).join(", ")}`);
      }
      workspace.scene = parsed.data;
      await workspace.onScene?.(parsed.data);
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
        if (!workspace.geoGebra) throw new Error("Submit a valid geometry scene or GeoGebra script before the lesson timeline");
      }
      const sceneObjectIds = workspace.scene
        ? new Set(workspace.scene.objects.map((object) => object.id))
        : geoGebraObjectNames(workspace.geoGebra!);
      const geoAlias = (id: string) => {
        if (workspace.scene) return false;
        if (id === "axes" || id === "xAxis" || id === "yAxis" || id === "zAxis") return true;
        if (!id.includes("_")) return false;
        const tokens = id.split("_").filter(Boolean);
        const prefixes = new Set(["point", "midpoint", "reflection", "intersection", "segment", "seg", "line", "circle", "ellipse", "parabola", "polygon", "poly", "triangle", "tri", "axis", "coord", "sys"]);
        const knownTokens = new Set([...sceneObjectIds].flatMap((name) => name.split("_")));
        return tokens.length > 1 && prefixes.has(tokens[0]!) && tokens.slice(1).every((token) => /^[A-Za-z0-9{}]+$/.test(token) || knownTokens.has(token));
      };
      // GeoGebra scripts may use the student-facing name (A) while Stage 1 and
      // lesson beats retain a provenance-safe id (point_A). Accept both forms,
      // plus Stage-1 object ids that describe a visible annotation without a
      // separately named GeoGebra object (for example a coordinate system).
      if (!workspace.scene) {
        for (const object of workspace.problemFacts?.objects ?? []) {
          sceneObjectIds.add(object.id);
          const suffix = object.id.match(/^(?:point|midpoint|reflection|intersection|segment|seg|line|circle|ellipse|parabola|polygon|poly|triangle|tri|axis|coord_sys|O_circle)_([^_]+)$/)?.[1];
          if (suffix) sceneObjectIds.add(suffix);
        }
        // Models sometimes keep a presentation-only prefix in lesson beats
        // (point_A/seg_AB) while using A/AB in the executable script. Accept
        // a suffix that appears in either namespace; the script itself remains
        // the source of truth for execution.
        for (const name of [...sceneObjectIds]) {
          const suffix = name.split("_").at(-1);
          if (suffix) sceneObjectIds.add(suffix);
        }
        const pointLabels = new Set([...sceneObjectIds].filter((name) => /^[A-Za-z]$/.test(name)));
        for (const name of [...sceneObjectIds]) {
          const suffix = name.split("_").at(-1);
          if (suffix && suffix.length > 1 && [...suffix].every((character) => pointLabels.has(character))) sceneObjectIds.add(suffix);
        }
      }
      const unknownObjectIds = parsed.data.beats.flatMap((beat) =>
        beat.actions.flatMap((action) => action.objectIds.filter((id) => !sceneObjectIds.has(id) && !geoAlias(id))),
      );
      if (unknownObjectIds.length > 0) {
        throw new Error(`Lesson timeline references unknown scene objects: ${[...new Set(unknownObjectIds)].join(", ")}`);
      }
      workspace.lessonTimeline = parsed.data;
      await workspace.onTimeline?.(parsed.data);
      return result("Lesson timeline accepted.", { status: "accepted", artifact: "lesson_timeline" });
    },
  };

  const finalizeGeometryArtifact: AgentTool<typeof finalizeParameters> = {
    name: "finalize_geometry_artifact",
    label: "Finalize the geometry artifact",
    description: "Create the final artifact only after accepted problem facts, geometry scene, and lesson timeline exist.",
    parameters: finalizeParameters,
    async execute() {
      if (!workspace.problemFacts || (!workspace.scene && !workspace.geoGebra) || !workspace.lessonTimeline) {
        throw new Error("Cannot finalize before problem facts, geometry scene, and lesson timeline are accepted (or a GeoGebra script in place of the scene)");
      }

      if (workspace.geoGebra && !workspace.geoGebraVerification) {
        throw new Error("Verify the GeoGebra script before finalizing the artifact");
      }

      const diagnostics = workspace.scene ? evaluateGeometryScene(workspace.scene).diagnostics : [];
      if (diagnostics.length > 0) {
        throw new Error(`Cannot finalize invalid geometry: ${JSON.stringify(diagnostics)}`);
      }
      const source = workspace.scene ? compileManimWebScene(workspace.scene) : "";
      workspace.artifact = {
        problemFacts: workspace.problemFacts,
        scene: workspace.scene ?? ({ version: 1, objects: [], assertions: [] } as GeometryScene),
        lessonTimeline: workspace.lessonTimeline,
        diagnostics,
        manimWebSource: source,
        geoGebra: workspace.geoGebra,
        geoGebraSource: workspace.geoGebra ? [`MODE: ${workspace.geoGebra.mode}`, ...workspace.geoGebra.commands].join("\n") : undefined,
      };
      return result("Geometry artifact finalized.", { status: "finalized" }, true);
    },
  };

  return [submitGeoGebraScript, verifyGeoGebraScript, submitGeometryScene, submitLessonTimeline, finalizeGeometryArtifact];
}

/** @deprecated Use createProblemFactsTool and createGeometryStage2Tools for the two-stage pipeline. */
export function createGeometryTools(workspace: RunWorkspace): AgentTool[] {
  return [createProblemFactsTool(workspace), ...createGeometryStage2Tools(workspace)];
}
