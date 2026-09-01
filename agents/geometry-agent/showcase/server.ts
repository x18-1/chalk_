import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, extname, join, normalize, resolve } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname);
const evaluationImagesRoot = resolve(root, "../fixtures/evaluation/dataset_images");
const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const requestPath = request.url?.split("?", 1)[0] || "/";
  const isEvaluationImage = requestPath.startsWith("/eval-image/");
  const relativePath = requestPath === "/" ? "index.html" : requestPath === "/main.js" ? "dist/main.js" : requestPath.slice(1);
  const base = isEvaluationImage ? evaluationImagesRoot : root;
  const imageName = isEvaluationImage ? basename(relativePath) : relativePath;
  const filePath = resolve(join(base, normalize(imageName)));
  if (!filePath.startsWith(`${base}/`)) {
    response.writeHead(400).end("Bad path");
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

const port = Number(process.env.GEOMETRY_SHOWCASE_PORT ?? 4173);
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Geometry showcase: http://127.0.0.1:${port}\n`);
});
