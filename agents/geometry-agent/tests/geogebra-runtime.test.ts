import { describe, expect, it } from "vitest";

import { executeGeoGebraScript, expectedGeoGebraObjectNames, verifyGeoGebraWithApplet } from "../src/geogebra-runtime";
import { normalizeGeoGebraCommand, validateGeoGebraScript } from "../src/geogebra";

describe("GeoGebra command runtime", () => {
  it("executes in order and verifies assigned objects", () => {
    const calls: string[] = [];
    const objects = new Set<string>();
    const results = executeGeoGebraScript({
      evalCommand(command) {
        calls.push(command);
        const name = command.match(/^([A-Za-z][A-Za-z0-9_{}]*)\s*=/)?.[1];
        if (name) objects.add(name);
        return true;
      },
      exists: (name) => objects.has(name),
      getObjectType: () => "point",
    }, { mode: "2D", commands: ["A = (0, 0)", "B = (1, 1)"] });
    expect(calls).toEqual(["A = (0, 0)", "B = (1, 1)"]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results[0]?.objectType).toBe("point");
  });

  it("does not treat a false evalCommand return as an error", () => {
    const results = executeGeoGebraScript({ evalCommand: () => false }, { mode: "2D", commands: ["SetCaption(A, \"A\")"] });
    expect(results).toMatchObject([{ ok: true }]);
  });

  it("handles viewport commands through the applet API instead of evalCommand", () => {
    const evaluated: string[] = [];
    let viewport: number[] | undefined;
    const results = executeGeoGebraScript({
      evalCommand(command) { evaluated.push(command); return false; },
      setCoordSystem(...args) { viewport = args; },
    }, { mode: "2D", commands: ["SetCoordSystem(-2.5, 4.5, -1.5, 5)", "A = (0, 0)"] });
    expect(viewport).toEqual([-2.5, 4.5, -1.5, 5]);
    expect(evaluated).toEqual(["A = (0, 0)"]);
    expect(results).toMatchObject([{ index: 0, ok: true }, { index: 1, ok: true }]);
  });

  it("handles axes and grid visibility through the applet API", () => {
    const visibility: unknown[] = [];
    const results = executeGeoGebraScript({
      evalCommand() { throw new Error("must not evaluate view command"); },
      setAxesVisible: (...args) => visibility.push(["axes", ...args]),
      setGridVisible: (...args) => visibility.push(["grid", ...args]),
    }, { mode: "2D", commands: ["SetAxesVisible(true, false)", "SetGridVisible(true)"] });
    expect(results.every((result) => result.ok)).toBe(true);
    expect(visibility).toEqual([["axes", true, false], ["grid", true]]);
  });

  it("stops at the first failed command and preserves the error", () => {
    const results = executeGeoGebraScript({
      evalCommand(command) {
        if (command.startsWith("bad")) throw new Error("invalid command");
        return true;
      },
    }, { mode: "2D", commands: ["A = (0, 0)", "bad = nope", "B = (1, 1)"] });
    expect(results).toHaveLength(2);
    expect(results[1]).toMatchObject({ index: 1, ok: false, command: "bad = nope", error: "invalid command" });
  });

  it("reports error-handler messages against the active command", () => {
    let report: ((message: string) => void) | undefined;
    const results = executeGeoGebraScript({
      setErrorHandler(handler) { report = handler; },
      evalCommand() { report?.("syntax error"); return true; },
    }, { mode: "2D", commands: ["A = (0, 0)"] });
    expect(results[0]).toMatchObject({ ok: false, error: "syntax error" });
  });

  it("extracts expected assigned object names", () => {
    expect(expectedGeoGebraObjectNames({ mode: "2D", commands: ["A = (0, 0)", "seg = Segment(A, B)"] })).toEqual(["A", "seg"]);
  });

  it("catches undefined object references before browser execution", () => {
    expect(validateGeoGebraScript({ mode: "2D", commands: ["SetCaption(point_O, \"O\")"] })).toEqual([
      "commands[0]: undefined object reference(s): point_O",
    ]);
    expect(validateGeoGebraScript({ mode: "2D", commands: ["O = (0, 0)", "SetCaption(O, \"O\")"] })).toEqual([]);
  });

  it("normalizes GeoGebra command parentheses to brackets", () => {
    expect(normalizeGeoGebraCommand('SetCaption(A, "A")')).toBe('SetCaption[A, "A"]');
    expect(normalizeGeoGebraCommand("Segment(A, B)")).toBe("Segment[A, B]");
    expect(normalizeGeoGebraCommand("P = (cos(t), sin(t))")).toBe("P = (cos(t), sin(t))");
  });

  it("returns real applet command diagnostics for the Agent host", () => {
    const verification = verifyGeoGebraWithApplet({
      evalCommand(command) {
        if (command.includes("Q")) throw new Error("Unknown command Q");
        return true;
      },
    }, { mode: "2D", commands: ["A = (0, 0)", "Segment(A, Q)"] });
    expect(verification.mode).toBe("applet");
    expect(verification.diagnostics).toEqual(["commands[1]: Unknown command Q"]);
  });
});
