export type DragViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  centerX: number;
  centerY: number;
};

export type WorldPoint = { x: number; y: number };

export function screenToWorld(clientX: number, clientY: number, viewport: DragViewport): WorldPoint {
  const normalizedX = (clientX - viewport.left) / viewport.width;
  const normalizedY = (clientY - viewport.top) / viewport.height;
  return {
    x: viewport.centerX + (normalizedX - 0.5) * viewport.frameWidth,
    y: viewport.centerY + (0.5 - normalizedY) * viewport.frameHeight,
  };
}

export function worldToScreen(world: WorldPoint, viewport: DragViewport): { x: number; y: number } {
  return {
    x: viewport.left + (0.5 + (world.x - viewport.centerX) / viewport.frameWidth) * viewport.width,
    y: viewport.top + (0.5 - (world.y - viewport.centerY) / viewport.frameHeight) * viewport.height,
  };
}

export function hitTestWorldPoint(
  clientX: number,
  clientY: number,
  center: WorldPoint,
  bounds: { width: number; height: number },
  viewport: DragViewport,
): boolean {
  const screenCenter = worldToScreen(center, viewport);
  const pixelsPerWorldX = viewport.width / viewport.frameWidth;
  const pixelsPerWorldY = viewport.height / viewport.frameHeight;
  const tolerance = Math.max(
    16,
    (Math.max(bounds.width * pixelsPerWorldX, bounds.height * pixelsPerWorldY) / 2) + 8,
  );
  return Math.hypot(clientX - screenCenter.x, clientY - screenCenter.y) <= tolerance;
}
