import { z } from "zod";

const idSchema = z.string().min(1).regex(/^[A-Za-z][A-Za-z0-9_]*$/, {
  message: "IDs must be valid TypeScript identifiers",
});

const motionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("linear"),
    to: z.object({ x: z.number().finite(), y: z.number().finite() }),
    duration: z.number().positive().finite().optional(),
  }),
  z.object({
    kind: z.literal("segment"),
    path: idSchema,
    duration: z.number().positive().finite().optional(),
  }),
  z.object({
    kind: z.literal("ellipse"),
    center: z.object({ x: z.number().finite(), y: z.number().finite() }),
    radiusX: z.number().positive().finite(),
    radiusY: z.number().positive().finite(),
    startAngle: z.number().finite(),
    endAngle: z.number().finite(),
    duration: z.number().positive().finite().optional(),
  }),
  z.object({
    kind: z.literal("parabola"),
    curve: idSchema,
    xRange: z.tuple([z.number().finite(), z.number().finite()]),
    duration: z.number().positive().finite().optional(),
  }),
]);

const pointObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("point"),
  x: z.number().finite(),
  y: z.number().finite(),
  /** Optional geometric locus this point must lie on (circle/ellipse/parabola/segment/line). */
  on: idSchema.optional(),
  motion: motionSchema.optional(),
});

const axesObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("axes"),
  xRange: z.union([z.tuple([z.number().finite(), z.number().finite()]), z.tuple([z.number().finite(), z.number().finite(), z.number().positive().finite()])]),
  yRange: z.union([z.tuple([z.number().finite(), z.number().finite()]), z.tuple([z.number().finite(), z.number().finite(), z.number().positive().finite()])]),
  xLength: z.number().positive().finite().optional(),
  yLength: z.number().positive().finite().optional(),
  tips: z.boolean().optional(),
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

const ellipseObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("ellipse"),
  center: idSchema,
  radiusX: z.number().positive().finite(),
  radiusY: z.number().positive().finite(),
});

const parabolaObjectSchema = z.object({
  id: idSchema,
  kind: z.literal("parabola"),
  a: z.number().finite(),
  b: z.number().finite(),
  c: z.number().finite(),
  xRange: z.tuple([z.number().finite(), z.number().finite()]),
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

const rightAngleMarkerSchema = z.object({
  id: idSchema,
  kind: z.literal("right_angle_marker"),
  vertex: idSchema,
  arms: z.tuple([idSchema, idSchema]),
  size: z.number().positive().finite().optional(),
});

export const geometryObjectSchema = z.discriminatedUnion("kind", [
  pointObjectSchema,
  axesObjectSchema,
  midpointObjectSchema,
  reflectionObjectSchema,
  segmentObjectSchema,
  lineObjectSchema,
  circleObjectSchema,
  ellipseObjectSchema,
  parabolaObjectSchema,
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
  markers: z.array(rightAngleMarkerSchema).optional(),
});

export type GeometryObject = z.infer<typeof geometryObjectSchema>;
export type GeometryAssertion = z.infer<typeof geometryAssertionSchema>;
export type GeometryScene = z.infer<typeof geometrySceneSchema>;
export type RightAngleMarker = z.infer<typeof rightAngleMarkerSchema>;

export const problemFactsSchema = z.object({
  problem_type: z.enum(["平面几何", "立体几何", "解析几何", "函数", "混合"]),
  task_goal: z.string().min(1),
  objects: z.array(z.object({
    id: idSchema,
    type: z.string().min(1),
    description: z.string(),
    properties: z.record(z.string(), z.unknown()),
    source: z.enum(["text", "figure"]),
    confidence: z.enum(["high", "low"]).optional(),
  })),
  relations: z.array(z.object({
    type: z.string().min(1),
    objects: z.array(idSchema).min(2),
    description: z.string().optional(),
    source: z.enum(["text", "figure"]),
  })),
  constraints: z.array(z.object({
    type: z.string().min(1),
    expression: z.string().min(1),
    description: z.string(),
    source: z.enum(["text", "figure"]),
  })),
  dynamics: z.array(z.object({
    object_id: idSchema,
    type: z.string().min(1),
    constraint: z.string(),
    param: z.string(),
    param_range: z.string(),
    depends_on: z.array(idSchema),
  })),
  annotations: z.array(z.object({
    type: z.string().min(1),
    label: z.string(),
    target: z.string(),
    position: z.string(),
    source: z.literal("figure"),
  })),
  ambiguities: z.array(z.string()),
  notes: z.string(),
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

/** Validate cross-field references that JSON schema cannot express. */
export function validateProblemFacts(facts: ProblemFacts): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  facts.objects.forEach((object, index) => {
    if (ids.has(object.id)) errors.push(`objects[${index}].id: duplicate object ID "${object.id}"`);
    ids.add(object.id);
  });
  const requireObject = (id: string, path: string) => {
    if (!ids.has(id)) errors.push(`${path}: object "${id}" does not exist`);
  };
  facts.relations.forEach((relation, index) => {
    relation.objects.forEach((id, objectIndex) => requireObject(id, `relations[${index}].objects[${objectIndex}]`));
  });
  facts.dynamics.forEach((dynamic, index) => {
    requireObject(dynamic.object_id, `dynamics[${index}].object_id`);
    dynamic.depends_on.forEach((id, objectIndex) => requireObject(id, `dynamics[${index}].depends_on[${objectIndex}]`));
  });
  facts.annotations.forEach((annotation, index) => {
    if (annotation.target) requireObject(annotation.target, `annotations[${index}].target`);
  });
  return errors;
}

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
