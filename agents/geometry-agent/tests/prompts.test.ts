import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { GEOMETRY_PROMPT_PROVENANCE, loadGeometryPrompt } from "../src/prompts";

describe("central geometry prompts", () => {
  it("loads the English execution prompt and keeps the bilingual pair", () => {
    const stage1 = loadGeometryPrompt("stage1.system");
    const stage2 = loadGeometryPrompt("stage2.system");
    expect(stage1).toContain("structured information extractor");
    expect(stage2).toContain("semantic JSON geometry DSL");
    expect(stage2).toContain("right_angle_marker");
    expect(stage2).toContain("companion `line`");
    expect(stage1).not.toContain("{{");
    expect(GEOMETRY_PROMPT_PROVENANCE["stage1.system"].sourceFiles).toContain("prompt/Geo2Geo/v1.md");
    expect(GEOMETRY_PROMPT_PROVENANCE["stage2.system"].sourceFiles).toContain("prompt/Geo2Geo/v2.md");
  });

  it("keeps the active GeoGebra prompt faithful to the legacy contract", () => {
    const prompt = loadGeometryPrompt("stage2.geogebra.system");
    expect(prompt).toContain("submit_geogebra_script");
    expect(prompt).toContain("Segment");
    expect(prompt).toContain("Ray");
    expect(prompt).toContain("Slider");
    expect(prompt).toContain("point on a function/curve");
    expect(prompt).toContain("right-angle");
    expect(prompt).toContain("Do not turn ordinary polygon edges");
    expect(existsSync(resolve("prompts/geometry-agent/stage2.geogebra.system.zh-CN.md"))).toBe(true);
  });
});
