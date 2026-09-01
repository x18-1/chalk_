import { geoGebraObjectNames, normalizeGeoGebraCommand, type GeoGebraScript } from "./geogebra";

export type GeoGebraApi = {
  evalCommand(command: string): boolean | void;
  setCoordSystem?: (xmin: number, xmax: number, ymin: number, ymax: number) => void;
  setAxesVisible?: (xVisible: boolean, yVisible: boolean) => void;
  setGridVisible?: (visible: boolean) => void;
  exists?: (name: string) => boolean;
  getObjectType?: (name: string) => string;
  setErrorHandler?: (handler: (message: string) => void) => void;
};

export type GeoGebraCommandResult = {
  index: number;
  command: string;
  ok: boolean;
  error?: string;
  objectName?: string;
  objectType?: string;
};

export type GeoGebraVerification = {
  mode: "applet";
  results: GeoGebraCommandResult[];
  diagnostics: string[];
};

export type GeoGebraAppletFactory = (mode: GeoGebraScript["mode"]) => Promise<GeoGebraApi> | GeoGebraApi;

const assignmentPattern = /^([A-Za-z][A-Za-z0-9_{}]*)\s*=\s*/;
const coordSystemPattern = /^SetCoordSystem\s*\(\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*\)$/i;
const axesPattern = /^(?:SetAxesVisible|ShowAxes)\s*\(\s*(true|false)\s*,\s*(true|false)\s*\)$/i;
const gridPattern = /^(?:SetGridVisible|ShowGrid)\s*\(\s*(true|false)\s*\)$/i;

/** Execute a validated script one command at a time and retain command-level diagnostics. */
export function executeGeoGebraScript(api: GeoGebraApi, script: GeoGebraScript): GeoGebraCommandResult[] {
  const results: GeoGebraCommandResult[] = [];
  let activeResult: GeoGebraCommandResult | undefined;
  api.setErrorHandler?.((message) => {
    if (activeResult && !activeResult.error) activeResult.error = message;
  });

  for (const [index, rawCommand] of script.commands.entries()) {
    const command = normalizeGeoGebraCommand(rawCommand);
    const viewport = command.match(coordSystemPattern);
    if (viewport) {
      const result: GeoGebraCommandResult = { index, command, ok: true };
      try {
        if (!api.setCoordSystem) throw new Error("GeoGebra applet does not expose setCoordSystem");
        api.setCoordSystem(...viewport.slice(1).map(Number) as [number, number, number, number]);
      } catch (error) {
        result.ok = false;
        result.error = error instanceof Error ? error.message : String(error);
      }
      results.push(result);
      if (!result.ok) break;
      continue;
    }
    const axes = command.match(axesPattern);
    if (axes) {
      const result: GeoGebraCommandResult = { index, command, ok: true };
      try {
        if (!api.setAxesVisible) throw new Error("GeoGebra applet does not expose setAxesVisible");
        api.setAxesVisible(axes[1]!.toLowerCase() === "true", axes[2]!.toLowerCase() === "true");
      } catch (error) {
        result.ok = false;
        result.error = error instanceof Error ? error.message : String(error);
      }
      results.push(result);
      if (!result.ok) break;
      continue;
    }
    const grid = command.match(gridPattern);
    if (grid) {
      const result: GeoGebraCommandResult = { index, command, ok: true };
      try {
        if (!api.setGridVisible) throw new Error("GeoGebra applet does not expose setGridVisible");
        api.setGridVisible(grid[1]!.toLowerCase() === "true");
      } catch (error) {
        result.ok = false;
        result.error = error instanceof Error ? error.message : String(error);
      }
      results.push(result);
      if (!result.ok) break;
      continue;
    }
    const objectName = command.match(assignmentPattern)?.[1];
    const result: GeoGebraCommandResult = { index, command, ok: true, ...(objectName ? { objectName } : {}) };
    activeResult = result;
    try {
      // GeoGebra Classic's evalCommand return value is not a reliable
      // success indicator across applet builds (the legacy Chalk runner only
      // treated thrown exceptions as failures). Keep that compatibility:
      // errorHandler/exception is the diagnostic signal.
      api.evalCommand(command);
    } catch (error) {
      result.ok = false;
      result.error = error instanceof Error ? error.message : String(error);
    }
    if (result.error) result.ok = false;
    if (result.ok && objectName && api.getObjectType) {
      try {
        result.objectType = api.getObjectType(objectName);
      } catch {
        // Some applet builds expose getObjectType but reject transient objects; keep execution success.
      }
    }
    results.push(result);
    if (!result.ok) break;
  }
  activeResult = undefined;
  return results;
}

export function expectedGeoGebraObjectNames(script: GeoGebraScript): string[] {
  return [...geoGebraObjectNames(script)];
}

/**
 * Adapter used by an Agent host that owns a real Classic applet. The browser
 * callback returns only diagnostics; successful verification is an empty list.
 */
export function verifyGeoGebraWithApplet(api: GeoGebraApi, script: GeoGebraScript): GeoGebraVerification {
  const results = executeGeoGebraScript(api, script);
  const failed = results.find((result) => !result.ok);
  return {
    mode: "applet",
    results,
    diagnostics: failed
      ? [`commands[${failed.index}]: ${failed.error ?? "GeoGebra command failed"}`]
      : [],
  };
}

/** Build the callback passed to solveGeometryProblem({ verifyGeoGebra }). */
export function createGeoGebraAppletVerifier(factory: GeoGebraAppletFactory) {
  return async (script: GeoGebraScript): Promise<string[]> => {
    const verification = verifyGeoGebraWithApplet(await factory(script.mode), script);
    return verification.diagnostics;
  };
}
