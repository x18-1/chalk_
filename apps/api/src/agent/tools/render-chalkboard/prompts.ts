/** Model-facing usage guidance for render_chalkboard. Keep this text in English. */
export const RENDER_CHALKBOARD_PROMPT =
  'Use render_chalkboard to present a read-only teaching scene in the current chat. ' +
  'Before a non-trivial scene, read the chalkboard-scene-design Skill. ' +
  'When to use: use it when a diagram, formula layout, comparison, process map, checkpoint, simulation, or animation makes the current learning goal clearer. ' +
  'When not to use: do not use it for greetings, short definitions, ordinary text explanations, decoration, or repeated identical content. ' +
  'Choose slide with a canvas, quiz with focused questions, or interactive with self-contained HTML or an http(s) URL. ' +
  'Prerequisites: state one learning goal, choose one visual representation, and keep the scene read-only; Chat does not execute actions or submit quizzes. ' +
  'For slide scenes, design a classroom-quality visual composition on a 1000 x 562.5 canvas: use a clear title area, ' +
  'one central diagram/formula/table, and short annotations; prefer shapes, lines, LaTeX, and spatial relationships over a stack of text rows. ' +
  'Keep 50px margins, align related elements, avoid overlaps, use at most 10 purposeful elements, and keep text concise enough to fit its box. ' +
  'For learning roadmaps or process maps, use 3–5 spacious nodes connected by line/arrow shapes; prefer a two-row or generous horizontal path over dense card grids. ' +
  'Give every node and text block explicit x/y/width/height, keep node copy to three short lines, and never use a text glyph as an arrow. ' +
  'For text, use textAlign (or align) with x as the alignment anchor, preserve explicit width/height for dense labels, and use lineHeight as a 1–3 multiplier. ' +
  'Keep learner-facing text at 16px or larger (titles 28px or larger); use smaller text only for optional metadata. ' +
  'Use a light background with dark readable text unless the lesson clearly benefits from a dark board; never emit placeholder copy. ' +
  'For interactive scenes, return a complete self-contained HTML document with inline CSS and JavaScript, a visible canvas or SVG, a clear learning goal, ' +
  'and a small number of safe controls; do not rely on external CDNs or hidden initialization. ' +
  'Output semantics: put a short confirmation in the tool content and the complete renderable scene in details.scene; do not put raw JSON or a long explanation in the confirmation. ' +
  'Do not create classroom actions, mutate existing scenes, submit quiz answers, or use PBL content. ' +
  'Keep the scene focused and do not call the tool repeatedly for the same content.';
