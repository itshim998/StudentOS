window.StudentOSRuntimeConfig = window.StudentOSRuntimeConfig || {
  apiBase: "",
};

(() => {
  if (!document.getElementById("studentos-auth-redesign-styles")) {
    const stylesheet = document.createElement("link");
    stylesheet.id = "studentos-auth-redesign-styles";
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/styles/auth-redesign.css";
    document.head.append(stylesheet);
  }

  if (!document.getElementById("studentos-auth-redesign-script")) {
    const script = document.createElement("script");
    script.id = "studentos-auth-redesign-script";
    script.src = "/scripts/auth-redesign.js";
    script.async = false;
    document.head.append(script);
  }
})();
