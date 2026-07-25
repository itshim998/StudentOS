const enhancementState = {
  latestAnswer: "",
  observer: null,
  fetchWrapped: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeMarkdownUrl(value, baseHref = "https://studentos.local") {
  const raw = String(value || "").trim();
  if (!raw || /[\u0000-\u001f\s]/.test(raw)) return null;
  try {
    const url = new URL(raw, baseHref);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Return only the portion of a streamed answer that ends at a completed word.
 * This prevents partially typed words from flashing while still updating the
 * formatted response every time another word becomes complete.
 */
function completeWordPrefix(value) {
  const text = String(value || "");
  if (!text) return "";
  if (/\s$/.test(text)) return text;
  const lastBoundary = text.search(/\s+\S*$/);
  return lastBoundary >= 0 ? text.slice(0, lastBoundary + text.slice(lastBoundary).match(/^\s+/)?.[0].length) : "";
}

/**
 * Models occasionally emit a heading marker after a sentence instead of on a
 * new line. Convert only that loose prose form into a normal Markdown heading.
 * Fenced code is deliberately left untouched.
 */
function normalizeLooseMarkdownHeadings(value) {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line.replace(/([.!?])([ \t]+)(#{1,6})[ \t]+(?=\S)/g, "$1\n\n$3 ");
  }).join("\n");
}

function splitTableRow(row) {
  return String(row || "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableDivider(row) {
  const cells = splitTableRow(row);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMath(value, { displayMode = false } = {}) {
  const source = String(value || "").trim();
  const katex = globalThis.katex;
  if (!source || typeof katex?.renderToString !== "function") {
    return escapeHtml(displayMode ? `$$${source}$$` : `$${source}$`);
  }
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false,
      output: "htmlAndMathml",
    });
  } catch {
    return escapeHtml(displayMode ? `$$${source}$$` : `$${source}$`);
  }
}

function renderInline(value, baseHref) {
  const placeholders = [];
  const hold = (html) => {
    const token = `\u0007STUDENTOS_AI_INLINE_${placeholders.length}\u0007`;
    placeholders.push({ token, html });
    return token;
  };

  let text = String(value || "");
  text = text.replace(/\\\((.+?)\\\)/g, (_, math) => hold(renderMath(math)));
  text = text.replace(/(^|[^\\])\$([^$\n]+)\$/g, (_, prefix, math) => `${prefix}${hold(renderMath(math))}`);
  text = text.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\[([^\]\n]{1,240})\]\(([^)\s]{1,500})\)/g, (_, label, href) => {
    const safeHref = safeMarkdownUrl(href, baseHref);
    return safeHref
      ? hold(`<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`)
      : `${label} (${href})`;
  });

  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[\s(])\*([^*\n]{1,200})\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[\s(])_([^_\n]{1,200})_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  return placeholders.reduce((output, item) => output.replaceAll(item.token, item.html), html);
}

/**
 * Small, dependency-free Markdown renderer for the Ask StudentOS stream.
 * All model text is escaped before supported formatting is applied.
 */
function renderProgressiveMarkdown(value, { baseHref = "https://studentos.local" } = {}) {
  const normalized = normalizeLooseMarkdownHeadings(value);
  const lines = normalized.split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = String(lines[index] || "");
    const line = rawLine.trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(String(lines[index] || "").trim())) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre class="study-generated-code"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const tag = heading[1].length <= 2 ? "h5" : "h6";
      blocks.push(`<${tag}>${renderInline(heading[2], baseHref)}</${tag}>`);
      index += 1;
      continue;
    }

    // During word-by-word streaming a heading marker can briefly arrive before
    // its first word. Suppress that marker instead of showing raw hashes.
    if (/^#{1,6}$/.test(line)) {
      index += 1;
      continue;
    }

    if (line.includes("|") && isTableDivider(lines[index + 1] || "")) {
      const headers = splitTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && String(lines[index] || "").includes("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(`
        <div class="study-generated-table-wrap">
          <table>
            <thead><tr>${headers.map((cell) => `<th>${renderInline(cell, baseHref)}</th>`).join("")}</tr></thead>
            <tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInline(row[cellIndex] || "", baseHref)}</td>`).join("")}</tr>`).join("")}</tbody>
          </table>
        </div>
      `);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(String(lines[index] || "").trim())) {
        quote.push(String(lines[index] || "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote class="study-generated-quote">${renderInline(quote.join(" "), baseHref)}</blockquote>`);
      continue;
    }

    const listMatch = line.match(/^(?:[-*+]|(\d+)[.)])\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[1]);
      const items = [];
      while (index < lines.length) {
        const current = String(lines[index] || "").trim();
        const match = current.match(/^(?:[-*+]|(\d+)[.)])\s+(.+)$/);
        if (!match || Boolean(match[1]) !== ordered) break;
        items.push(match[2]);
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${items.map((item) => `<li>${renderInline(item, baseHref)}</li>`).join("")}</${tag}>`);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length) {
      const current = String(lines[index] || "").trim();
      if (!current
        || /^```/.test(current)
        || /^(?:-{3,}|\*{3,}|_{3,})$/.test(current)
        || /^(#{1,6})\s+/.test(current)
        || /^#{1,6}$/.test(current)
        || /^>\s?/.test(current)
        || /^(?:[-*+]|\d+[.)])\s+/.test(current)
        || (current.includes("|") && isTableDivider(lines[index + 1] || ""))) break;
      paragraph.push(current);
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraph.join(" "), baseHref)}</p>`);
  }

  return blocks.join("");
}

function isAiVerbRequest(input, windowObj) {
  try {
    const value = typeof input === "string" ? input : input?.url;
    if (!value) return false;
    const url = new URL(value, windowObj.location?.href || "https://studentos.local");
    return url.pathname.endsWith("/api/ai/verb");
  } catch {
    return false;
  }
}

function wrapAiFetch(windowObj) {
  if (enhancementState.fetchWrapped || typeof windowObj.fetch !== "function") return;
  const previousFetch = windowObj.fetch.bind(windowObj);
  windowObj.fetch = async (input, init) => {
    const response = await previousFetch(input, init);
    if (isAiVerbRequest(input, windowObj)) {
      try {
        const payload = await response.clone().json();
        if (typeof payload?.answer === "string") enhancementState.latestAnswer = payload.answer;
      } catch {
        enhancementState.latestAnswer = "";
      }
    }
    return response;
  };
  enhancementState.fetchWrapped = true;
}

function installReadinessRemoval(windowObj, documentObj) {
  const style = documentObj.createElement("style");
  style.id = "studentos-ai-readiness-removal";
  style.textContent = "#ai-panel > .contract-zone { display: none !important; }";
  documentObj.head?.append(style);

  const removeZone = () => documentObj.querySelector("#ai-panel > .contract-zone")?.remove();
  if (documentObj.readyState === "complete") windowObj.setTimeout(removeZone, 0);
  else windowObj.addEventListener("load", () => windowObj.setTimeout(removeZone, 0), { once: true });
}

function installResponseObserver(windowObj, documentObj) {
  const response = documentObj.getElementById("ai-response");
  if (!response || typeof windowObj.MutationObserver !== "function") return;

  const update = () => {
    const copy = response.querySelector(".study-academic-copy");
    if (!copy) return;
    const cursor = copy.querySelector(".streaming-cursor");

    if (cursor) {
      if (cursor.dataset.studentosProgressive === "true") return;
      const rawPartial = copy.textContent || "";
      const completeWords = completeWordPrefix(rawPartial);
      copy.innerHTML = renderProgressiveMarkdown(completeWords, { baseHref: windowObj.location?.href });
      const formattedCursor = documentObj.createElement("span");
      formattedCursor.className = "streaming-cursor";
      formattedCursor.dataset.studentosProgressive = "true";
      formattedCursor.setAttribute("aria-hidden", "true");
      copy.append(formattedCursor);
      return;
    }

    if (!copy.textContent.trim() || !enhancementState.latestAnswer) return;
    const normalizedAnswer = normalizeLooseMarkdownHeadings(enhancementState.latestAnswer);
    if (normalizedAnswer === enhancementState.latestAnswer) return;
    const normalizedMarkup = renderProgressiveMarkdown(normalizedAnswer, { baseHref: windowObj.location?.href });
    if (copy.innerHTML !== normalizedMarkup) copy.innerHTML = normalizedMarkup;
  };

  enhancementState.observer?.disconnect();
  enhancementState.observer = new windowObj.MutationObserver(update);
  enhancementState.observer.observe(response, { childList: true, subtree: true, characterData: true });
  update();
}

function initAiResponseEnhancements({ windowObj = window, documentObj = document } = {}) {
  wrapAiFetch(windowObj);
  installReadinessRemoval(windowObj, documentObj);
  const installObserver = () => installResponseObserver(windowObj, documentObj);
  if (documentObj.readyState === "loading") documentObj.addEventListener("DOMContentLoaded", installObserver, { once: true });
  else installObserver();
}

globalThis.StudentOSAiResponseEnhancements = Object.freeze({
  completeWordPrefix,
  normalizeLooseMarkdownHeadings,
  renderProgressiveMarkdown,
  initAiResponseEnhancements,
});

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initAiResponseEnhancements();
}
