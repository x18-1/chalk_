---
name: Chalk
description: A warm, focused learning desk for guided mathematical thinking.
colors:
  clay: "#C15F3C"
  clay-hover: "#A94F32"
  warm-canvas: "#F7F4EF"
  paper: "#FFFDF9"
  ink: "#2B2926"
  stone-700: "#514C47"
  stone-500: "#6D655F"
  stone-300: "#C4BBB2"
  stone-200: "#DDD6CE"
  stone-100: "#EBE6DF"
  success: "#42604A"
  info: "#356A78"
  warning: "#A76024"
  danger: "#A8453D"
typography:
  title:
    fontFamily: 'Georgia, "Noto Serif SC", "Songti SC", serif'
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0"
  body:
    fontFamily: '"Noto Sans SC Variable", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0"
  label:
    fontFamily: '"Noto Sans SC Variable", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
rounded:
  control: "6px"
  card: "12px"
  popover: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.clay-hover}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
---

# Design System: Chalk

## Overview

**Creative North Star: "Warm Learning Desk"**

Chalk should feel like sitting down at a well-kept desk with a patient tutor: warm enough to lower pressure, precise enough to support mathematical thinking. It inherits Creatorflow main's warm paper, charcoal ink, restrained clay accent and selective serif titles, but shifts the content from editorial operations to explanation, questions and visible learning context.

The interface is an operating surface, not a decorative education portal. Navigation, messages and tools remain familiar; character comes from material, proportion and the calm pacing between dense reasoning and quiet working space.

**Key Characteristics:**

- Warm paper regions separated by tonal changes and fine dividers.
- Charcoal primary actions; clay appears rarely for selection, focus and teaching emphasis.
- Generous reading measure in the conversation, compact information in side rails.
- Agent activity is visible and inspectable without becoming the visual focus.

## Colors

The palette is restrained: warm neutrals carry the application, ink establishes hierarchy, and clay marks the current choice or the next meaningful action.

- **Warm Canvas**: application background and learning-context rail.
- **Paper**: conversation, inputs, selected rows and floating working surfaces.
- **Warm Ink**: primary text, icons and primary buttons.
- **Editorial Clay**: active navigation signal, focus, links and teaching emphasis.
- **Warm Stone**: secondary text, borders and inactive controls.
- **Semantic Colors**: success, info, warning and danger appear only with matching text or icon.

**The Rare Accent Rule.** Clay identifies attention or action; it never washes a whole routine workspace.

**The No Invented Brand Color Rule.** Do not add a new product-wide green, blue or purple accent. Semantic colors remain local to status.

## Typography

Conversation and controls use Noto Sans SC with system Chinese fallbacks. Serif is reserved for the Chalk wordmark and occasional empty-state or page titles; it does not appear in buttons, labels or operational metadata.

- **Surface title**: 18px, 600, compact leading.
- **Section title**: 14-16px, 600.
- **Conversation body**: 14-15px, relaxed 1.7-1.8 leading, maximum 68ch.
- **Control text**: 13px, 500 where action hierarchy requires it.
- **Metadata**: 11-12px only when it explains source, state, consequence or recovery.

**The Useful Small Type Rule.** Small copy must change understanding or action; it never paraphrases the heading above it.

## Layout

Desktop routes use stable working regions: a 248px global rail, a flexible reading or lesson workspace, and an optional context rail. Each region owns its own scrolling behavior. Chalkboard adds a scene rail inside that workspace because page navigation is part of lesson playback rather than global navigation.

At tablet widths, Chalkboard prioritizes the lesson and scene rail; the global rail is removed from the focused classroom and Notes/Chat becomes a dismissible side layer. At phone widths, scenes become a horizontal page strip, the lesson and discussion stack vertically, and Notes/Chat becomes a full-width layer. The same information architecture and controls remain available at every width. Touch targets are at least 44px on coarse pointers, and safe-area insets are respected.

Spacing follows a 4/8/16/24/32px rhythm. Reading and lesson content receive more space than navigation and context because understanding and answering are the primary tasks. Other routes may remain desktop-oriented until they receive their own explicit adaptation; do not compress a desktop grid and call it mobile support.

## Elevation & Depth

The system is flat by default. Region boundaries come from warm tonal shifts and borders. Shadows are reserved for the composer, popovers, menus, confirmations and selected floating surfaces.

- **Working surface**: `0 1px 2px rgba(43, 41, 38, 0.04), 0 8px 24px rgba(43, 41, 38, 0.045)`.
- **Popover**: `0 18px 44px rgba(43, 41, 38, 0.14)`.

**The Flat-by-Default Rule.** A surface earns elevation through interaction or consequence, never decoration.

## Shapes

Controls use 6px corners, independent task surfaces use 12px corners and floating popovers use 14px corners. Pills are limited to compact status or count indicators. Borders are warm and visible; nested cards are not used.

## Components

### Buttons

- Primary buttons use Warm Ink with Paper text and move to Clay on hover.
- Secondary buttons use Paper, a warm border and Ink text.
- Icon-only buttons have a stable 32px square hit area and a tooltip or accessible name.
- Focus uses a visible Clay outline; disabled labels remain readable.

### Conversation Rail

- Selected conversations sit on Paper with a fine Clay edge signal.
- Titles remain one line; summaries and dates appear only when useful for recognition.
- New conversation is a clear command, not a decorative promotional block.

### Messages

- Student messages use a muted warm surface aligned to the right.
- Tutor messages remain mostly unboxed for comfortable reading.
- Thinking and tool execution are progressive disclosures with explicit running, completed, failed and approval states.

### Composer

- The composer is the primary floating working surface and stays anchored below the conversation.
- Attachment, model and send actions use familiar icons and stable dimensions.
- Empty, typing, streaming, blocked and error states must not resize the layout.

### Learning Context

- The right rail shows only information that changes the current learning interaction: active problem, recognized topic, relevant knowledge points and Agent activity.
- It is not an analytics dashboard and does not display decorative scores or fabricated mastery data.

## Do's and Don'ts

### Do

- **Do** preserve Creatorflow main's warm paper, charcoal and restrained clay relationship.
- **Do** keep mathematical explanation readable at a stable line length.
- **Do** make tool activity, approvals and failure recovery visible in plain language.
- **Do** pair every semantic color with text or an icon.

### Don't

- **Don't** add deep green or another invented primary brand color.
- **Don't** use gradients, glass, glow, decorative blobs or generic SaaS illustration.
- **Don't** wrap every message, section or rail item in a card.
- **Don't** gamify errors or use childish classroom decoration.
- **Don't** claim a learning state that has not been produced by real data.
