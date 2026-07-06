# Phase 2.4B: Rendered notes and PDF export

## Rendered markdown behavior

Generated Study and Evaluate notes now render common markdown directly in the workspace instead of showing the raw generated text. Supported formatting includes headings, paragraphs, ordered and unordered lists, bold, italic, inline code, fenced code blocks, block quotes, simple markdown tables, and safe links.

The renderer escapes raw HTML before insertion and sanitizes the small set of generated markup that StudentOS creates. Script tags, unsafe link protocols, event handlers, and arbitrary attributes are not allowed.

Uploaded Academic Context PDFs keep their existing material rendering and viewer behavior. The export action is shown only on generated study notes.

## LaTeX and math support

Math support is lightweight display formatting, not a full LaTeX engine. Inline math written as `$...$` or `\(...\)` is rendered as styled inline math text. Block math written between `$$` delimiters is rendered as a styled block. StudentOS does not run MathJax/KaTeX in this pass, so advanced LaTeX layout is not guaranteed.

## PDF export behavior

Generated study notes can be exported from Study and Evaluate with **Export as PDF**. The browser builds a client-side PDF blob, opens it in the existing PDF viewer modal, and exposes the viewer header's **Download PDF** link for that export blob.

Uploaded Academic Context PDFs still open through the authenticated inline material endpoint. Their raw storage paths are not exposed, and the viewer continues to revoke object URLs when closed.

## Save PDF copy

Save PDF copy to Academic Context is not implemented in this pass. Exporting a generated note creates only a local browser blob and download link.

## No duplicate PDF on export

PDF export does not call the upload/source APIs and does not create a second Academic Context PDF record. The original generated note remains the saved `generated_study_material`.

## Strict test no-download rule

Strict test papers remain UI-only inside Study and Evaluate. Phase 2.4B does not add PDF, print, export, download, or viewer actions to strict test papers.

## Manual browser QA needed

- Generate a note and confirm headings, lists, tables, inline code, and math-style text render cleanly.
- Confirm unsafe raw HTML appears as text and does not execute.
- Click **Export as PDF**, confirm the viewer opens, and download the PDF from the viewer header.
- Close the viewer and reopen an uploaded Academic Context PDF to confirm uploaded PDF behavior still works.
- Confirm Academic Context does not gain an extra PDF after export.
- Generate and start a strict test, then confirm no export, print, download, or PDF viewer action appears.
