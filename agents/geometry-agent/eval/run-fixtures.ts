import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { compileManimWebScene, evaluateGeometryScene, geometrySceneSchema } from "../src/geometry";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(packageRoot, "fixtures/doubled-median.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { scene: unknown };
const scene = geometrySceneSchema.parse(fixture.scene);
const evaluation = evaluateGeometryScene(scene);

if (evaluation.diagnostics.length > 0) {
  throw new Error(JSON.stringify(evaluation.diagnostics));
}

const source = compileManimWebScene(scene);
await build({
  stdin: { contents: source, loader: "ts", resolveDir: packageRoot },
  bundle: true,
  write: false,
  platform: "browser",
  logLevel: "silent",
});
process.stdout.write(`${JSON.stringify({ fixture: "doubled-median", status: "passed" })}\n`);
