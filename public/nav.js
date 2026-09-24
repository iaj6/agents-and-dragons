// Shared site navigation. Pages include <nav id="sitenav"></nav> and this script.
(() => {
  const here = location.pathname.replace(/\/$/, "/index.html");
  const links = [
    ["/index.html", "Home"],
    ["/tables.html", "Tables"],
    ["/table.html", "Watch"],
    ["/lab.html", "The Lab"],
    ["/archive.html", "Archive"],
    ["/review.html", "Review"],
  ];
  const el = document.getElementById("sitenav");
  if (!el) return;
  el.className = "sitenav";
  el.innerHTML = links.map(([href, label]) => `<a href="${href}"${here === href ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  const css = document.createElement("style");
  css.textContent = `.sitenav{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}.sitenav a{font:14px "EB Garamond",Georgia,serif;color:#a18d74;text-decoration:none;padding:4px 10px;border-radius:6px;border:1px solid transparent}.sitenav a:hover{color:#eadcc2;border-color:#3b2f24}.sitenav a[aria-current=page]{color:#e8a33d;border-color:#5a4020;background:#221a12}`;
  document.head.append(css);
})();
