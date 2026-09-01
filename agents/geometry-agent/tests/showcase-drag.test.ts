import { describe, expect, it } from "vitest";
import { hitTestWorldPoint, screenToWorld, worldToScreen } from "../showcase/drag";

const viewport = {
  left: 100,
  top: 40,
  width: 900,
  height: 600,
  frameWidth: 14,
  frameHeight: 8,
  centerX: 0,
  centerY: 0,
};

describe("showcase pointer dragging", () => {
  it("maps a CSS-scaled canvas through the live camera frame", () => {
    const world = screenToWorld(100 + 675, 40 + 150, viewport);
    expect(world.x).toBeCloseTo(3.5);
    expect(world.y).toBeCloseTo(2);
    const screen = worldToScreen(world, viewport);
    expect(screen.x).toBeCloseTo(775);
    expect(screen.y).toBeCloseTo(190);
  });

  it("hits a point using a pixel-sized tolerance", () => {
    const center = worldToScreen({ x: 0, y: 0 }, viewport);
    expect(hitTestWorldPoint(center.x + 10, center.y + 8, { x: 0, y: 0 }, { width: 0.22, height: 0.22 }, viewport)).toBe(true);
    expect(hitTestWorldPoint(center.x + 80, center.y, { x: 0, y: 0 }, { width: 0.22, height: 0.22 }, viewport)).toBe(false);
  });
});
