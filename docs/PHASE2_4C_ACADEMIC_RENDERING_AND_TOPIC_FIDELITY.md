# Phase 2.4C: Academic rendering and topic fidelity

## Shared academic renderer

StudentOS now uses one shared frontend helper for academic AI text:

- `renderAcademicTextMarkup(content)` for block content.
- `renderAcademicInlineMarkup(content)` for compact inline surfaces.

The helper supports Markdown headings, paragraphs, ordered and unordered lists, bold, italic, inline code, fenced code blocks, block quotes, simple tables, safe links, inline math, and block math.

Raw HTML is escaped before generated markup is restored. The sanitizer allows only the small StudentOS-created tag and attribute set needed for academic content. Script tags, event handlers, arbitrary attributes, and unsafe link protocols are not allowed.

## Math support

KaTeX was not added in this pass. The app keeps lightweight client-side math rendering to avoid adding a frontend build/runtime dependency to the current static app structure.

Supported math delimiters:

- Inline: `$...$` and `\(...\)`
- Block: `$$...$$` and `\[...\]`

The browser UI displays math as styled academic text. The generated-note PDF export converts common LaTeX fragments such as `\frac{a}{b}`, `\sqrt{x}`, `\leq`, `\geq`, Greek letter commands, sums, and integrals into readable PDF text. Advanced LaTeX layout is not guaranteed.

## Renderer coverage

The shared renderer is applied to:

- Generated study notes.
- Generated-note PDF parsing and text cleanup.
- Strict test question prompts.
- Objective answer choices.
- Test instructions.
- Evaluation strengths, weak topics, next steps, and short revision plans.
- Evaluation feedback and correction text.

## Topic locking

StudentOS owns the syllabus queue. Groq can explain or test only the active StudentOS-selected parent topic or subpart.

For generated notes:

- The active parent syllabus topic comes from the Phase 2.4A queue.
- The active subpart title comes from the queue when present.
- The saved note title uses the queue subpart or parent topic.
- The AI prompt says not to rename the topic, not to choose an easier prerequisite as the main topic, and to keep prerequisite reminders short and subordinate.

For generated tests:

- The test scope uses the completed parent syllabus topic.
- The saved test topic and test title are overwritten after provider output with the locked StudentOS parent topic.
- The AI prompt asks for clean Markdown/math while keeping the parent topic immutable.

Old generated notes with missing metadata fall back to clean display labels. User-facing UI and generated-note PDF export do not show `source_generated_*`, `topic_evaluation_*`, or `test_result_*` IDs.

## PDF export cleanup

Generated-note PDF export remains client-side and lightweight. It now uses the same cleaned metadata as the note UI:

- Course name when known.
- Exact parent syllabus topic when known.
- Exact subpart title when present.
- `Generated study note` fallback instead of internal generated IDs.

Export still opens a local browser PDF blob in the existing PDF viewer. It does not save a duplicate Academic Context PDF and does not call upload/source APIs.

## Strict test no-download rule

Strict test papers remain UI-only. Phase 2.4C does not add PDF, export, print, download, or viewer actions to tests.

## Manual browser QA needed

- Generate a note with headings, lists, tables, inline code, `$...$`, `$$...$$`, and `\[...\]`; confirm it renders cleanly.
- Confirm unsafe raw HTML displays as text and does not execute.
- Export the generated note and confirm the PDF title, course, topic, and subpart do not show internal IDs.
- Generate a strict test and confirm prompts, answer choices, and instructions render Markdown/math.
- Submit/evaluate a test and confirm feedback, corrections, next steps, and revision plan render Markdown/math.
- Confirm strict tests still have no export, print, download, or PDF viewer action.
- Confirm Academic Context does not gain a duplicate PDF after generated-note export.
