export type GeometryPromptId = "stage1.system" | "stage2.system" | "stage2.geogebra.system";

export const GEOMETRY_PROMPT_PROVENANCE: Record<GeometryPromptId, {
  source: string;
  sourceFiles: string[];
  adaptation: string;
}> = {
  "stage1.system": {
    source: "chalk_edu/Chalk/prompt/Geo2Geo/v1.md",
    sourceFiles: ["prompt/Geo2Geo/v1.md", "prompts/stage1_extract.py"],
    adaptation: "Migrated to a filesystem-managed bilingual prompt; JSON contract retained.",
  },
  "stage2.system": {
    source: "chalk_edu/Chalk/prompt/Geo2Geo/v2.md",
    sourceFiles: ["prompt/Geo2Geo/v2.md", "prompts/stage2_construct.py"],
    adaptation: "Historical manim-web migration prompt retained for compatibility; the active Geometry Agent uses stage2.geogebra.system.",
  },
  "stage2.geogebra.system": {
    source: "chalk_edu/Chalk/prompt/Geo2Geo/v2.md",
    sourceFiles: ["prompt/Geo2Geo/v2.md", "pipeline/stage2_construct.py"],
    adaptation: "Restored the original Geo2Geo command semantics, adding the submit_geogebra_script tool contract, bilingual filesystem assets, and incremental TypeScript validation.",
  },
};
