---
name: chalkboard-scene-design
description: "Design clear, visually strong teaching scenes for render_chalkboard. Use when a math explanation benefits from a diagram, formula layout, comparison, process map, quiz, simulation, or animation. Do not use for an explanation that is already clear as short text."
---

# Chalkboard scene design

Use this Skill before calling `render_chalkboard` for a non-trivial scene. The
tool is the renderer and validator; this Skill is the visual teaching plan.

## When to use

Use a scene when a learner will understand the idea better by seeing a spatial
relationship, transformation, worked structure, comparison, data pattern, or
small simulation. Use one scene for one teaching purpose.

Do not use a scene for greetings, short definitions, a single sentence of
feedback, or ordinary algebra that is clearer in the chat transcript. Do not
generate a scene merely to decorate an answer or on every turn.

## Choose the scene type

- **slide**: a read-only explanation with a diagram, formula derivation,
  worked example, timeline, comparison, table, chart, or annotated figure.
- **quiz**: a small checkpoint after the explanation. Include only questions
  the learner can answer from the current context; never put the answer in the
  visible option text.
- **interactive**: use only when manipulating a parameter, tracing a motion,
  or observing a change is itself part of the learning objective. The HTML must
  be self-contained, use inline CSS/JavaScript, and visibly work on first load.

## Plan before writing JSON

1. State the learning objective in one sentence.
2. Pick the one representation that makes that objective visible.
3. Sketch the composition in words: title, focal visual, labels, and reading
   order. Keep the focal visual larger than its annotations.
4. Choose the smallest set of elements that communicates the idea.
5. Check the result against the checklist below, then call the tool once.

## Slide composition

The canvas is 1000 × 562.5 units. Reserve at least 50 units on every edge.
Use this rhythm unless the subject requires another layout:

- title: `left: 60`, `top: 36`, width 880, height 48;
- focal visual: the middle 60–70% of the canvas;
- annotations: short labels placed beside the feature they explain;
- conclusion or takeaway: a compact strip near the bottom, not a paragraph.

Prefer one strong diagram or derivation over many text boxes. Use `shape` for
regions and markers, `line` for relationships, `latex` for mathematics, and
`table`/`chart` only when their structure carries meaning. Keep text to short
phrases; never paste the whole assistant answer into the canvas.

### Roadmaps and process maps

For a learning route, show progression as a path rather than five dense cards.
Prefer 3–5 nodes connected by `line`/arrow shapes on a two-row or spacious
horizontal layout. Give each node an explicit bounding box (usually 150–190 ×
120–160), keep body copy to at most three short lines, and place labels inside
that box. Do not use a text glyph as an arrow, do not rely on implicit text
sizes, and do not place cards edge-to-edge. If the route needs more detail,
split it into a second scene instead of shrinking the type.

Use a light background with dark text by default. Use one accent color for the
teaching focus and semantic colors only when they encode a real distinction.
Align related items, keep 20–40 units of breathing room, and ensure every
element is fully inside the canvas. Elements render in array order, so put
background shapes before labels and formulas.

## Interactive scenes

The iframe is read-only from Chat's perspective. Return a complete HTML
document with a visible `<canvas>` or `<svg>`, a short instruction, and no more
than three meaningful controls. Initialize synchronously or from an inline
script at the end of the document. Do not depend on a CDN, network request,
module import, external asset, or guessed DOM selector. A pure text lesson is
not an interactive scene.

## Quiz scenes

Use 1–3 questions. Each question should test one observable idea from the
current explanation. Keep options parallel in length and grammar. Do not
include grading logic or ask Chat to submit answers: Chat only displays the
checkpoint.

## Quality checklist

Before calling `render_chalkboard`, verify:

- [ ] The scene has one explicit learning purpose.
- [ ] The selected type matches the purpose.
- [ ] The focal visual is spatial, not a stack of prose rows.
- [ ] The title, formulas, diagram, and labels have a clear hierarchy.
- [ ] All coordinates, sizes, and text boxes fit inside the canvas.
- [ ] There are no accidental overlaps or placeholder labels.
- [ ] A quiz has no more than three focused questions.
- [ ] Interactive HTML works without external dependencies.
- [ ] The tool is not being called repeatedly for identical content.

The returned Scene is a read-only presentation in Chat. It does not create a
classroom, execute Chalkboard Actions, mutate an existing scene, or submit a
quiz.
