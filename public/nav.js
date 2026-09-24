// Shared site navigation. Pages include <nav id="sitenav"></nav> and this script.
(() => {
  const here = location.pathname.replace(/\/$/, "/index.html");
  // The public build is read-only: no live tables to watch, no reviews to write.
  const PUBLIC = !!window.AAD_PUBLIC;
  const links = [
    ["/index.html", "Home"],
    ...(PUBLIC ? [] : [["/tables.html", "Tables"]]),
    ["/table.html", PUBLIC ? "Replays" : "Watch"],
    ["/lab.html", "The Lab"],
    ["/archive.html", "Archive"],
    ...(PUBLIC ? [] : [["/review.html", "Review"]]),
  ];
  document.addEventListener("DOMContentLoaded", () => document.querySelectorAll(PUBLIC ? "[data-live-only]" : "[data-public-only]").forEach((n) => n.remove()));
  // Experiment halls (4781+) are just tables: the hub pages live on the main hall.
  const MAIN = "4777";
  const main = !PUBLIC && location.port && location.port !== MAIN ? `${location.protocol}//${location.hostname}:${MAIN}` : "";
  const el = document.getElementById("sitenav");
  if (!el) return;
  el.className = "sitenav";
  el.innerHTML = links
    .map(([href, label]) => `<a href="${href === "/table.html" ? href : main + href}"${here === href ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("");
  // Shared helper: ask this hall for the list of halls, falling back to the main hall.
  window.fetchHalls = async () => {
    for (const base of ["", main || null, `${location.protocol}//${location.hostname}:${MAIN}`]) {
      if (base === null) continue;
      try {
        const r = await fetch(`${base}/api/halls`);
        if (r.ok) return await r.json();
      } catch {}
    }
    return [];
  };
  const css = document.createElement("style");
  css.textContent = `.sitenav{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}.sitenav a{font:14px "EB Garamond",Georgia,serif;color:#a18d74;text-decoration:none;padding:4px 10px;border-radius:6px;border:1px solid transparent}.sitenav a:hover{color:#eadcc2;border-color:#3b2f24}.sitenav a[aria-current=page]{color:#e8a33d;border-color:#5a4020;background:#221a12}`;
  document.head.append(css);
})();
