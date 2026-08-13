export { compileManimWebScene } from "./compile-manim-web";
export { evaluateGeometryScene, type GeometryEvaluation, type Line2D, type Point2D } from "./evaluate";
export {
  geometryAssertionSchema,
  geometryObjectSchema,
  geometrySceneSchema,
  lessonTimelineSchema,
  problemFactsSchema,
  type GeometryAssertion,
  type GeometryDiagnostic,
  type GeometryObject,
  type GeometryScene,
  type LessonTimeline,
  type ProblemFacts,
} from "./schema";
export { parseGeometryScene, validateGeometryScene } from "./validate";
