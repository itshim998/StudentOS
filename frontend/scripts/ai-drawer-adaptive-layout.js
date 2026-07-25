const adaptiveDrawerState = {
  observer: null,
  resizeHandler: null,
};

const REDUNDANT_LOADING_COPY = /^Preparing your answer(?:\.{3}|…)?$/i;
const TITLE_LIKE_TABLE_HEADER = /\b(?:comparison|overview|summary|difference|differences|versus|vs\.?|quick guide|at a glance)\b/i;

function normalizedVisibleText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isRedundantPreparingState(response) {
  if (!response) return false;
  return REDUNDANT_LOADING_COPY.test(normalizedVisibleText(response.textContent));
}

function responseContainsTable(response) {
  return Boolean(response?.querySelector("table, .study-generated-table-wrap"));
}

function isLikelyCaptionHeaderText(value) {
  const text = normalizedVisibleText(value);
  return text.length >= 24 || TITLE_LIKE_TABLE_HEADER.test(text);
}

function repairShiftedTable(table) {
  if (!table || table.dataset?.studentosColumnAlignment === "repaired") return false;
  const headerRow = table.querySelector?.("thead tr");
  const bodyRows = [...(table.querySelectorAll?.("tbody tr") || [])];
  const headerCells = [...(headerRow?.children || [])].filter((cell) => cell.tagName === "TH");
  if (headerCells.length < 3 || !bodyRows.length || table.querySelector?.("caption")) return false;

  const columnCount = headerCells.length;
  const rowCells = bodyRows.map((row) => [...row.children].filter((cell) => cell.tagName === "TD"));
  if (rowCells.some((cells) => cells.length !== columnCount)) return false;
  if (!rowCells.every((cells) => normalizedVisibleText(cells.at(-1)?.textContent) === "")) return false;

  const titleCell = headerCells[0];
  if (!isLikelyCaptionHeaderText(titleCell.textContent)) return false;
  if (!headerCells.slice(1).every((cell) => normalizedVisibleText(cell.textContent))) return false;
  if (!rowCells.every((cells) => normalizedVisibleText(cells[0]?.textContent))) return false;

  const documentObj = table.ownerDocument;
  if (!documentObj?.createElement) return false;
  const caption = documentObj.createElement("caption");
  caption.className = "study-generated-table-caption";
  caption.innerHTML = titleCell.innerHTML;
  table.prepend(caption);
  titleCell.remove();
  rowCells.forEach((cells) => cells.at(-1)?.remove());
  table.dataset.studentosColumnAlignment = "repaired";
  return true;
}

function repairResponseTables(response) {
  if (!response || typeof response.querySelectorAll !== "function") return 0;
  let repaired = 0;
  response.querySelectorAll("table").forEach((table) => {
    if (repairShiftedTable(table)) repaired += 1;
  });
  return repaired;
}

function setPreparingStateSuppressed(response, suppressed) {
  if (!response) return;
  response.classList.toggle("studentos-ai-loading-suppressed", suppressed);
  if (suppressed) {
    response.dataset.studentosLoadingSuppressed = "true";
    response.setAttribute("aria-hidden", "true");
    return;
  }
  if (response.dataset.studentosLoadingSuppressed === "true") {
    delete response.dataset.studentosLoadingSuppressed;
    response.removeAttribute("aria-hidden");
  }
}

function setTableExpanded(panel, expanded) {
  if (!panel) return;
  panel.classList.toggle("studentos-ai-table-expanded", expanded);
  panel.dataset.studentosLayout = expanded ? "table" : "standard";
}

function syncAdaptiveDrawer(panel, response) {
  if (!panel || !response) return { preparingSuppressed: false, tableExpanded: false };
  const preparingSuppressed = isRedundantPreparingState(response);
  setPreparingStateSuppressed(response, preparingSuppressed);
  if (!preparingSuppressed) repairResponseTables(response);
  const tableExpanded = !preparingSuppressed && responseContainsTable(response);
  setTableExpanded(panel, tableExpanded);
  return { preparingSuppressed, tableExpanded };
}

function installAdaptiveDrawerStyles(documentObj) {
  if (documentObj.getElementById("studentos-ai-adaptive-drawer-styles")) return;
  const style = documentObj.createElement("style");
  style.id = "studentos-ai-adaptive-drawer-styles";
  style.textContent = `
    #ai-panel.ai-panel {
      box-sizing: border-box;
      max-width: calc(100vw - 48px);
      transition:
        opacity 180ms ease,
        transform 180ms ease,
        width 340ms cubic-bezier(0.22, 1, 0.36, 1),
        max-width 340ms cubic-bezier(0.22, 1, 0.36, 1);
      will-change: width, transform, opacity;
    }

    #ai-panel.ai-panel.studentos-ai-table-expanded {
      width: min(800px, calc(100vw - 48px));
    }

    #ai-response.studentos-ai-loading-suppressed {
      display: none !important;
    }

    #ai-panel.studentos-ai-table-expanded .ai-form,
    #ai-panel.studentos-ai-table-expanded #ai-response,
    #ai-panel.studentos-ai-table-expanded .study-academic-copy,
    #ai-panel.studentos-ai-table-expanded .study-academic-copy > *,
    #ai-panel.studentos-ai-table-expanded textarea,
    #ai-panel.studentos-ai-table-expanded button[type="submit"] {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      max-width: none;
    }

    #ai-panel.studentos-ai-table-expanded .study-generated-table-wrap {
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: thin;
    }

    #ai-panel.studentos-ai-table-expanded .study-generated-table-wrap table {
      width: 100%;
      min-width: 620px;
      table-layout: auto;
    }

    #ai-panel.studentos-ai-table-expanded .study-generated-table-caption {
      caption-side: top;
      padding: 0 0 12px;
      color: inherit;
      font-size: 1rem;
      font-weight: 800;
      line-height: 1.35;
      text-align: left;
    }

    #ai-panel.studentos-ai-table-expanded .study-generated-table-wrap th,
    #ai-panel.studentos-ai-table-expanded .study-generated-table-wrap td {
      min-width: 120px;
      white-space: normal;
      word-break: normal;
      overflow-wrap: break-word;
    }

    #ai-panel.studentos-ai-table-expanded .study-academic-copy p,
    #ai-panel.studentos-ai-table-expanded .study-academic-copy li,
    #ai-panel.studentos-ai-table-expanded .study-academic-copy blockquote,
    #ai-panel.studentos-ai-table-expanded .study-academic-copy h5,
    #ai-panel.studentos-ai-table-expanded .study-academic-copy h6 {
      max-width: none;
      overflow-wrap: anywhere;
    }

    @media (max-width: 860px) {
      #ai-panel.ai-panel.studentos-ai-table-expanded {
        width: auto !important;
        max-width: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #ai-panel.ai-panel {
        transition: none;
        will-change: auto;
      }
    }
  `;
  documentObj.head?.append(style);
}

function installAdaptiveDrawer({ windowObj = window, documentObj = document } = {}) {
  const panel = documentObj.getElementById("ai-panel");
  const response = documentObj.getElementById("ai-response");
  if (!panel || !response || typeof windowObj.MutationObserver !== "function") return null;

  installAdaptiveDrawerStyles(documentObj);

  const update = () => syncAdaptiveDrawer(panel, response);
  adaptiveDrawerState.observer?.disconnect();
  adaptiveDrawerState.observer = new windowObj.MutationObserver(update);
  adaptiveDrawerState.observer.observe(response, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-busy"],
  });

  if (adaptiveDrawerState.resizeHandler) {
    windowObj.removeEventListener("resize", adaptiveDrawerState.resizeHandler);
  }
  adaptiveDrawerState.resizeHandler = update;
  windowObj.addEventListener("resize", update, { passive: true });
  update();

  return {
    update,
    disconnect() {
      adaptiveDrawerState.observer?.disconnect();
      adaptiveDrawerState.observer = null;
      if (adaptiveDrawerState.resizeHandler) {
        windowObj.removeEventListener("resize", adaptiveDrawerState.resizeHandler);
        adaptiveDrawerState.resizeHandler = null;
      }
    },
  };
}

function initAdaptiveDrawer({ windowObj = window, documentObj = document } = {}) {
  const install = () => installAdaptiveDrawer({ windowObj, documentObj });
  if (documentObj.readyState === "loading") {
    documentObj.addEventListener("DOMContentLoaded", install, { once: true });
    return null;
  }
  return install();
}

globalThis.StudentOSAiDrawerAdaptiveLayout = Object.freeze({
  normalizedVisibleText,
  isRedundantPreparingState,
  responseContainsTable,
  isLikelyCaptionHeaderText,
  repairShiftedTable,
  repairResponseTables,
  syncAdaptiveDrawer,
  installAdaptiveDrawer,
  initAdaptiveDrawer,
});

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initAdaptiveDrawer();
}
