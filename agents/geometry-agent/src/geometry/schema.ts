import { z } from "zod";

const idSchema = z.string().min(1).regex(/^[A-Za-z][A-Za-z0-9_]*$/, {
  message: "IDs must be valid TypeScript identifiers",
});

const taskIdSchema = z.string().min(1);

const pointObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("point"),
  x: z.number().finite(),
  y: z.number().finite(),
});

const midpointObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("midpoint"),
  points: z.tuple([idSchema, idSchema]),
});

const reflectionObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("reflection"),
  point: idSchema,
  center: idSchema,
});

const segmentObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("segment"),
  points: z.tuple([idSchema, idSchema]),
});

const lineObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("line"),
  points: z.tuple([idSchema, idSchema]),
});

const circleObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("circle"),
  center: idSchema,
  radius: z.number().positive().finite(),
});

const intersectionObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("intersection"),
  lines: z.tuple([idSchema, idSchema]),
});

const parallelLineObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("parallel_line"),
  through: idSchema,
  line: idSchema,
});

const perpendicularLineObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("perpendicular_line"),
  through: idSchema,
  line: idSchema,
});

const polygonObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("polygon"),
  points: z.array(idSchema).min(3),
});

export const geometryObjectSchema = z.discriminatedUnion("kind", [
  pointObjectSchema,
  midpointObjectSchema,
  reflectionObjectSchema,
  segmentObjectSchema,
  lineObjectSchema,
  circleObjectSchema,
  intersectionObjectSchema,
  parallelLineObjectSchema,
  perpendicularLineObjectSchema,
  polygonObjectSchema,
]);

export const geometryAssertionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("equal_length"),
    segments: z.tuple([idSchema, idSchema]),
    tolerance: z.number().positive().optional(),
  }),
  z.object({
    kind: z.literal("collinear"),
    points: z.array(idSchema).min(3),
    tolerance: z.number().positive().optional(),
  }),
  z.object({
    kind: z.literal("parallel"),
    lines: z.tuple([idSchema, idSchema]),
    tolerance: z.number().positive().optional(),
  }),
  z.object({
    kind: z.literal("perpendicular"),
    lines: z.tuple([idSchema, idSchema]),
    tolerance: z.number().positive().optional(),
  }),
]);

export const geometrySceneSchema = z.object({
  version: z.literal(1),
  objects: z.array(geometryObjectSchema).min(1),
  assertions: z.array(geometryAssertionSchema),
});

export type GeometryObject = z.infer<typeof geometryObjectSchema>;
export type GeometryAssertion = z.infer<typeof geometryAssertionSchema>;
export type GeometryScene = z.infer<typeof geometrySceneSchema>;

export const problemFactsSchema = z.object({
  problemType: z.enum(["plane_geometry", "analytic_geometry"]),
  tasks: z.array(z.object({ id: taskIdSchema, prompt: z.string().min(1) })).min(1),
  objects: z.array(z.object({
    id: idSchema,
    kind: z.enum(["point", "segment", "line", "circle", "angle", "triangle", "polygon"]),
    source: z.enum(["text", "figure", "derived"]),
    confidence: z.enum(["high", "low"]).optional(),
    description: z.string().optional(),
  })),
  relations: z.array(z.object({
    kind: z.enum([
      "midpoint",
      "collinear",
      "parallel",
      "perpendicular",
      "intersection",
      "on",
      "equal_length",
    ]),
    objects: z.array(idSchema).min(2),
    source: z.enum(["text", "figure", "derived"]),
  })),
  constraints: z.array(z.object({
    expression: z.string().min(1),
    source: z.enum(["text", "figure", "derived"]),
  })),
  ambiguities: z.array(z.string()),
});

export const lessonTimelineSchema = z.object({
  beats: z.array(z.object({
    id: idSchema,
    kind: z.enum(["motivation", "construction", "reasoning", "answer"]),
    narration: z.string().min(1),
    actions: z.array(z.object({
      kind: z.enum(["create", "highlight", "focus"]),
      objectIds: z.array(idSchema).min(1),
    })),
  })).min(1),
});

export type ProblemFacts = z.infer<typeof problemFactsSchema>;
export type LessonTimeline = z.infer<typeof lessonTimelineSchema>;

export type GeometryDiagnostic = {
  code:
    | "TYPE_MISMATCH"
    | "OBJECT_NOT_FOUND"
    | "DUPLICATE_ID"
    | "CYCLIC_DEPENDENCY"
    | "DEGENERATE_CONSTRUCTION"
    | "POSTCONDITION_FAILED";
  path: string;
  message: string;
};
