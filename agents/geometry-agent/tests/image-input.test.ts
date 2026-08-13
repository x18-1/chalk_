import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadProblemImages } from "../src/image-input";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("image input", () => {
  it("encodes a supported local image for Pi vision input", async () => {
    const root = await mkdtemp(join(tmpdir(), "geometry-agent-image-"));
    directories.push(root);
    const imagePath = join(root, "problem.png");
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71]));

    const [image] = await loadProblemImages([imagePath]);

    expect(image?.content).toEqual({ type: "image", mimeType: "image/png", data: "iVBORw==" });
    expect(image?.metadata).toMatchObject({ path: imagePath, mimeType: "image/png", byteLength: 4 });
  });

  it("rejects unsupported image formats before calling the model", async () => {
    await expect(loadProblemImages(["problem.svg"])).rejects.toThrow("Unsupported image format");
  });
});
