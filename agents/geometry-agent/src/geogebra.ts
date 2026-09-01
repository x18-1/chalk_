import { z } from "zod";

export const geoGebraModeSchema = z.enum(["2D", "3D"]);
export const geoGebraScriptSchema = z.object({
  mode: geoGebraModeSchema,
  commands: z.array(z.string().trim().min(1)).min(1),
});

export type GeoGebraScript = z.infer<typeof geoGebraScriptSchema>;

const assignmentPattern = /^([A-Za-z][A-Za-z0-9_{}]*)\s*=\s*/;
const functionAssignmentPattern = /^([A-Za-z][A-Za-z0-9_{}]*)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)\s*=\s*/;
const colonDefinitionPattern = /^([A-Za-z][A-Za-z0-9_{}]*)\s*:\s*/;
const identifierPattern = /[A-Za-z][A-Za-z0-9_{}]*/g;
const builtins = new Set([
  "x", "y", "z", "pi", "e", "true", "false", "xAxis", "yAxis", "zAxis",
  "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "abs", "exp", "log", "ln",
  "Slider", "Segment", "Line", "Ray", "Midpoint", "Intersect", "Polygon", "Circle", "Ellipse", "Function",
  "PerpendicularLine", "ParallelLine", "Point", "Vector", "Angle", "ShowLabel", "SetLabelMode", "SetColor",
  "SetFilling", "SetLineStyle", "SetFixed", "SetCaption", "ShowObject", "SetVisibleInView", "SetCoordSystem",
  "SetAxesVisible", "SetGridVisible", "ShowAxes", "ShowGrid", "MODE",
]);
const bracketCommands = new Set([
  "Point", "Midpoint", "Intersect", "Center", "Focus", "Vertex", "Line", "Segment", "Ray",
  "Perpendicular", "PerpendicularLine", "ParallelLine", "PerpendicularBisector", "AngleBisector",
  "Vector", "Circle", "Ellipse", "Hyperbola", "Parabola", "Conic", "Polygon", "Angle",
  "Translate", "Rotate", "Reflect", "Dilate", "Derivative", "Integral", "If", "Function",
  "SetColor", "SetLineThickness", "SetPointSize", "SetFilling", "SetLabelVisible", "SetLabelMode",
  "SetCaption", "SetVisible", "SetVisibleInView", "SetLineStyle", "ShowLabel", "ShowObject",
  "Text", "Locus", "Sequence", "Element", "Length", "Distance",
]);

/** GeoGebra input commands use square brackets; parentheses are reserved for
 * coordinates and mathematical functions. Keep this fixer deliberately
 * shallow, matching the mature DeepTutor validator's common-mistake repair. */
export function normalizeGeoGebraCommand(command: string): string {
  let normalized = command;
  for (const name of bracketCommands) {
    const pattern = new RegExp(`\\b${name}\\s*\\(([^()]*)\\)`, "g");
    normalized = normalized.replace(pattern, `${name}[$1]`);
  }
  return normalized;
}

export function normalizeGeoGebraScript(script: GeoGebraScript): GeoGebraScript {
  return { ...script, commands: script.commands.map(normalizeGeoGebraCommand) };
}

function definedName(command: string): string | undefined {
  return command.match(assignmentPattern)?.[1] ?? command.match(functionAssignmentPattern)?.[1] ?? command.match(colonDefinitionPattern)?.[1];
}

function references(command: string, defined: Set<string>): string[] {
  const assignment = command.match(assignmentPattern);
  const functionAssignment = command.match(functionAssignmentPattern);
  const colonDefinition = command.match(colonDefinitionPattern);
  const lhs = assignment?.[1] ?? functionAssignment?.[1] ?? colonDefinition?.[1];
  const local = functionAssignment?.[2];
  const body = command
    .replace(functionAssignmentPattern, "")
    .replace(assignmentPattern, "")
    .replace(colonDefinitionPattern, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, "");
  const commandName = body.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\(/)?.[1];
  const missing = new Set<string>();
  for (const token of body.match(identifierPattern) ?? []) {
    if (token === lhs || token === local || token === commandName || builtins.has(token) || defined.has(token)) continue;
    missing.add(token);
  }
  return [...missing];
}

export function parseGeoGebraScript(text: string): GeoGebraScript {
  let mode: GeoGebraScript["mode"] = "2D";
  const commands: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("```") || line.startsWith("//") || line.startsWith("#")) continue;
    if (/^MODE\s*:/i.test(line)) {
      mode = /3D/i.test(line) ? "3D" : "2D";
      continue;
    }
    commands.push(line);
  }
  const parsed = geoGebraScriptSchema.safeParse({ mode, commands });
  if (!parsed.success) throw new Error(`Invalid GeoGebra script: ${parsed.error.message}`);
  return parsed.data;
}

export function validateGeoGebraScript(script: GeoGebraScript): string[] {
  const diagnostics: string[] = [];
  const names = new Set<string>();
  for (const [index, command] of script.commands.entries()) {
    const normalizedCommand = normalizeGeoGebraCommand(command);
    if (/\b(evalCommand|javascript:|<script|import\s)/i.test(command)) diagnostics.push(`commands[${index}]: JavaScript is not allowed`);
    const assignment = normalizedCommand.match(assignmentPattern);
    const functionAssignment = normalizedCommand.match(functionAssignmentPattern);
    const name = definedName(normalizedCommand);
    const missing = references(normalizedCommand, names);
    if (missing.length > 0) diagnostics.push(`commands[${index}]: undefined object reference(s): ${missing.join(", ")}`);
    if (assignment) {
      const assigned = assignment[1]!;
      if (["x", "y", "z", "xAxis", "yAxis", "zAxis", "i", "e"].includes(assigned)) diagnostics.push(`commands[${index}]: reserved object name "${assigned}"`);
      if (names.has(assigned)) diagnostics.push(`commands[${index}]: duplicate object name "${assigned}"`);
      names.add(assigned);
    } else if (functionAssignment || name) {
      const assigned = name!;
      if (["x", "y", "z", "xAxis", "yAxis", "zAxis", "i", "e"].includes(assigned)) diagnostics.push(`commands[${index}]: reserved object name "${assigned}"`);
      if (names.has(assigned)) diagnostics.push(`commands[${index}]: duplicate object name "${assigned}"`);
      names.add(assigned);
    }
  }
  return diagnostics;
}

export function geoGebraObjectNames(script: GeoGebraScript): Set<string> {
  const names = new Set<string>();
  for (const command of script.commands) {
    const name = definedName(normalizeGeoGebraCommand(command));
    if (name) names.add(name);
  }
  return names;
}
