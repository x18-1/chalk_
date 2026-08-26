import { NextResponse } from "next/server";

const openMaicBaseUrl = (process.env.OPENMAIC_BASE_URL ?? "http://localhost:3310").replace(/\/$/, "");

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const relativePath = path.join("/");
  if (!relativePath || relativePath.includes("..") || relativePath.startsWith("/")) {
    return NextResponse.json({ success: false, error: "Avatar not found" }, { status: 404 });
  }
  try {
    const response = await fetch(`${openMaicBaseUrl}/avatars/${relativePath}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return NextResponse.json({ success: false, error: "Avatar not found" }, { status: 404 });
    const body = await response.arrayBuffer();
    const extension = relativePath.split(".").pop()?.toLowerCase() ?? "";
    return new NextResponse(body, {
      headers: {
        "content-type": response.headers.get("content-type") ?? contentTypes[extension] ?? "application/octet-stream",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "Avatar not found" }, { status: 404 });
  }
}
