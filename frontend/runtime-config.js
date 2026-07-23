window.StudentOSRuntimeConfig = window.StudentOSRuntimeConfig || {
  apiBase: "",
};

(() => {
  const assets = [
    { id: "studentos-auth-redesign-styles", tag: "link", href: "/styles/auth-redesign.css" },
    { id: "studentos-auth-redesign-script", tag: "script", src: "/scripts/auth-redesign.js" },
    { id: "studentos-auth-accessibility-script", tag: "script", src: "/scripts/auth-accessibility.js" },
  ];

  function writeParserBlockingAssets() {
    for (const asset of assets) {
      if (document.getElementById(asset.id)) continue;
      if (asset.tag === "link") {
        document.write(`<link id="${asset.id}" rel="stylesheet" href="${asset.href}">`);
      } else {
        document.write(`<script id="${asset.id}" src="${asset.src}"><\/script>`);
      }
    }
  }

  function appendAssets() {
    for (const asset of assets) {
      if (document.getElementById(asset.id)) continue;
      if (asset.tag === "link") {
        const stylesheet = document.createElement("link");
        stylesheet.id = asset.id;
        stylesheet.rel = "stylesheet";
        stylesheet.href = asset.href;
        document.head.append(stylesheet);
      } else {
        const script = document.createElement("script");
        script.id = asset.id;
        script.src = asset.src;
        script.async = false;
        document.head.append(script);
      }
    }
  }

  if (document.readyState === "loading") {
    writeParserBlockingAssets();
  } else {
    appendAssets();
  }
})();
