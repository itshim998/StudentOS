const runtimeApiBase = window.StudentOSRuntimeConfig?.apiBase || window.STUDENTOS_API_BASE || "";

window.StudentOSConfig = {
  apiBase: String(runtimeApiBase || "").trim().replace(/\/+$/, ""),
};
