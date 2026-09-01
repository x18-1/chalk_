export {
  solveGeometryProblem,
  type SolveGeometryProblemInput,
  type SolveGeometryProblemResult,
} from "./agent";
export * from "./geometry";
export { geoGebraModeSchema, geoGebraObjectNames, geoGebraScriptSchema, parseGeoGebraScript, validateGeoGebraScript, type GeoGebraScript } from "./geogebra";
export { createGeoGebraAppletVerifier, executeGeoGebraScript, expectedGeoGebraObjectNames, verifyGeoGebraWithApplet, type GeoGebraApi, type GeoGebraAppletFactory, type GeoGebraCommandResult, type GeoGebraVerification } from "./geogebra-runtime";
export {
  createGeometryModelClient,
  createGeometryModelClientFromEnv,
  resolveModelConfig,
  type GeometryModelClient,
  type GeometryModelConfig,
} from "./model";
export {
  createGeometryTools,
  createGeometryStage2Tools,
  createProblemFactsTool,
  createRunWorkspace,
  type GeometryArtifact,
  type RunWorkspace,
} from "./tools";
export { loadGeometryPrompt, type GeometryPromptId, GEOMETRY_PROMPT_PROVENANCE } from "./prompts";
export { createRunArtifactStore, type RunArtifactStore, type RunInputManifest } from "./artifact-store";
export { loadProblemImages, type LoadedProblemImage } from "./image-input";
