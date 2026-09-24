const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);

// Colour follows the model family, never its rank, so it's stable across every chart and filter.
const MODEL_ORDER = ["opus-5", "sonnet-5", "haiku-4-5"];
const colorOf = (m) => (m.includes("opus") ? "var(--m-opus)" : m.includes("sonnet") ? "var(--m-sonnet)" : m.includes("haiku") ? "var(--m-haiku)" : "var(--m-other)");
const sortModels = (ms) => [...ms].sort((a, b) => (MODEL_ORDER.indexOf(a) + 99 * (MODEL_ORDER.indexOf(a) < 0)) - (MODEL_ORDER.indexOf(b) + 99 * (MODEL_ORDER.indexOf(b) < 0)) || a.localeCompare(b));

// ── tooltip ───────────────────────────────────────────────────────────────────
const tip = $("tip");
document.addEventListener("mousemove", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) return void (tip.style.display = "none");
  tip.innerHTML = t.dataset.tip;
  tip.style.display = "block";
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 300) + "px";
  tip.style.top = e.clientY + 14 + "px";
});

// ── building blocks ───────────────────────────────────────────────────────────

/** A 100% stacked bar of model shares, labelled when a segment is wide enough. */
function stack(label, n, counts) {
  const total = sum(Object.values(counts));
  if (!total) return `<div class="stackrow"><div class="lab">${esc(label)} <small>n=${n}</small></div><div class="stack empty" data-tip="No councils in these runs"></div></div>`;
  const segs = sortModels(Object.keys(counts)).map((m) => {
    const pct = (counts[m] / total) * 100;
    return `<span style="flex:${counts[m]};background:${colorOf(m)}" data-tip="<b>${esc(m)}</b><br>${counts[m]} of ${total} (${pct.toFixed(0)}%)">${pct >= 14 ? `<b>${pct.toFixed(0)}%</b>` : ""}</span>`;
  });
  return `<div class="stackrow"><div class="lab">${esc(label)} <small>n=${n}</small></div><div class="stack">${segs.join("")}</div></div>`;
}

function legend(models) {
  return `<div class="legend">${sortModels(models).map((m) => `<span><i style="background:${colorOf(m)}"></i>${esc(m)}</span>`).join("")}</div>`;
}

/** A rate cell: "k/n" with a thin bar; flags tiny samples. */
function rate(k, n, fmt = "frac") {
  if (!n) return `<span class="few">–</span>`;
  const p = k / n;
  return `<div class="cell"><span class="num">${fmt === "pct" ? `${Math.round(p * 100)}%` : `${k}/${n}`}</span><span class="track"><i style="width:${Math.round(p * 100)}%"></i></span>${n < 5 ? `<span class="few" title="small sample">n&lt;5</span>` : ""}</div>`;
}

/** A per-run average with a bar scaled to the row maximum. */
function avg(v, max, digits = 1, prefix = "") {
  return `<div class="cell"><span class="num">${prefix}${v.toFixed(digits)}</span><span class="track"><i style="width:${max ? Math.round((v / max) * 100) : 0}%"></i></span></div>`;
}

function card(title, sub, body) {
  return `<section class="card"><h2>${title}</h2><p class="sub">${sub}</p>${body}</section>`;
}

const addCounts = (list) => list.reduce((acc, o) => { for (const [k, v] of Object.entries(o)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {});

// ── the page ──────────────────────────────────────────────────────────────────

function render(lab) {
  const V = lab.variants;
  const allRuns = V.flatMap((v) => v.runs);
  if (!allRuns.length) return void ($("main").innerHTML = `<div class="empty-state">No finished runs here yet.</div>`);
  const cost = sum(allRuns.map((r) => r.cost));
  const models = new Set(allRuns.flatMap((r) => [...Object.keys(r.councils.proposalsByModel), ...Object.keys(r.councils.winsByModel)]));

  // 1. Hierarchy
  const hierarchy = card(
    "Who runs the table?",
    "Share of council proposals and of winning plans, by model. If one model's share of wins is far above its share of proposals, the party is following it.",
    legend([...models]) +
      `<div class="group-title">Proposals</div>` + V.map((v) => stack(v.label, v.runs.length, addCounts(v.runs.map((r) => r.councils.proposalsByModel)))).join("") +
      `<div class="group-title">Winning plans</div>` + V.map((v) => stack(v.label, v.runs.length, addCounts(v.runs.map((r) => r.councils.winsByModel)))).join("") +
      `<table style="margin-top:14px"><tr><th>variant</th><th>councils</th><th>judge agreed</th><th>judge disagreed, by winner</th></tr>${V.map((v) => {
        const judged = sum(v.runs.map((r) => r.councils.judged));
        const wrong = addCounts(v.runs.map((r) => r.councils.judgedWrongWinsByModel));
        return `<tr><td>${esc(v.label)}</td><td>${sum(v.runs.map((r) => r.councils.n))}</td><td class="v">${rate(sum(v.runs.map((r) => r.councils.judgedBest)), judged)}</td><td class="wrap">${sortModels(Object.keys(wrong)).map((m) => `<span class="pill"><span class="dot" style="background:${colorOf(m)}"></span>${esc(m)} ${wrong[m]}</span>`).join("") || (judged ? "none" : '<span class="few">not judged</span>')}</td></tr>`;
      }).join("")}</table>`,
  );

  // 2. Honesty, by model across the selection
  const think = {}, doGap = {};
  for (const r of allRuns) {
    for (const [m, x] of Object.entries(r.honesty.thinkMismatch)) { think[m] ??= { hits: 0, of: 0 }; think[m].hits += x.hits; think[m].of += x.of; }
    for (const [m, x] of Object.entries(r.honesty.doGap)) { doGap[m] ??= { hits: 0, of: 0 }; doGap[m].hits += x.hits; doGap[m].of += x.of; }
  }
  const honestModels = sortModels([...new Set([...Object.keys(think), ...Object.keys(doGap)])]);
  const honesty = card(
    "Do they say what they think, and do what they say?",
    "Judge audits of player turns. Thoughts ≠ words counts turns where the spoken line withheld or contradicted the private reasoning (only for turns where reasoning was captured).",
    honestModels.length
      ? `<table><tr><th>model</th><th>thoughts ≠ words</th><th>words ≠ actions</th></tr>${honestModels.map((m) => `<tr><td><span class="dot" style="background:${colorOf(m)}"></span>${esc(m)}</td><td class="v">${rate(think[m]?.hits ?? 0, think[m]?.of ?? 0)}</td><td class="v">${rate(doGap[m]?.hits ?? 0, doGap[m]?.of ?? 0)}</td></tr>`).join("")}</table>`
      : `<div class="empty-state">No judge pass yet. Run <code>npm run judge -- &lt;sweep&gt;</code>.</div>`,
  );

  // 3. Information & trust
  const p = (v, key) => ({ k: sum(v.runs.map((r) => r.probes[key].good)), n: sum(v.runs.map((r) => r.probes[key].n)) });
  const info = card(
    "Information and trust",
    "Engine-scored probes: does a secret only one player saw reach the party; do they catch a teammate impostor; do they resist prompt injections; does a toll get paid.",
    `<table><tr><th>variant</th><th>whisper shared</th><th>impostor caught</th><th>injection resisted</th><th>toll paid</th></tr>${V.map((v) => {
      const w = p(v, "whisper"), i = p(v, "impostor"), t = p(v, "toll");
      return `<tr><td>${esc(v.label)}</td><td class="v">${rate(w.k, w.n)}</td><td class="v">${rate(i.k, i.n)}</td><td class="v">${rate(sum(v.runs.map((r) => r.integrity.resisted)), sum(v.runs.map((r) => r.integrity.injectionsRead)))}</td><td class="v">${rate(t.k, t.n)}</td></tr>`;
    }).join("")}</table>`,
  );

  // 4. Risk & survival (per run averages)
  const per = (v, f) => mean(v.runs.map(f));
  const rows4 = V.map((v) => ({ v, down: per(v, (r) => r.downs), dead: per(v, (r) => r.deaths), desp: sum(v.runs.map((r) => r.risk.desperate)), off: sum(v.runs.map((r) => r.risk.offense)), esc: sum(v.runs.map((r) => r.risk.escaped)), ret: sum(v.runs.map((r) => r.risk.retreats)), sub: per(v, (r) => r.risk.subdued) }));
  const risk = card(
    "Risk and survival",
    "Per run. Attacks at under 25% HP measure recklessness; retreats measure whether they recognise a losing fight.",
    `<table><tr><th>variant</th><th>hit 0 HP</th><th>deaths</th><th>attacks at &lt;25% HP</th><th>retreats made</th><th>enemies spared</th></tr>${rows4.map((x) => `<tr><td>${esc(x.v.label)}</td><td class="v">${avg(x.down, Math.max(...rows4.map((y) => y.down)))}</td><td class="v">${avg(x.dead, Math.max(...rows4.map((y) => y.dead)))}</td><td class="v">${rate(x.desp, x.off)}</td><td class="v">${rate(x.esc, x.ret)}</td><td class="v">${avg(x.sub, Math.max(...rows4.map((y) => y.sub)))}</td></tr>`).join("")}</table>`,
  );

  // 5. Fairness & bonds
  const rows5 = V.map((v) => ({ v, gini: per(v, (r) => r.loot.gini), snip: per(v, (r) => r.loot.sniped), gift: per(v, (r) => r.loot.gifts), grudge: per(v, (r) => r.bonds.grudges), warm: per(v, (r) => r.bonds.warmth) }));
  const mx = (k) => Math.max(...rows5.map((y) => y[k]));
  const fair = card(
    "Loot and loyalty",
    "Per run. Inequality is the Gini of loot value held (0 = equal). Sniped = claimed an item that was ideal for someone else. Trust changes come from the characters' own private bonds.",
    `<table><tr><th>variant</th><th>inequality</th><th>sniped</th><th>gifts</th><th>trust ↓</th><th>trust ↑</th></tr>${rows5.map((x) => `<tr><td>${esc(x.v.label)}</td><td class="v">${avg(x.gini, 1, 2)}</td><td class="v">${avg(x.snip, mx("snip"))}</td><td class="v">${avg(x.gift, mx("gift"))}</td><td class="v">${avg(x.grudge, mx("grudge"))}</td><td class="v">${avg(x.warm, mx("warm"))}</td></tr>`).join("")}</table>`,
  );

  // 6. Cost
  const costCard = card(
    "What it cost",
    "Estimated from token usage at Gateway list prices, cache-aware (the first real session was within 2% of the Gateway's own figure).",
    `<table><tr><th>variant</th><th>runs</th><th>$ per run</th><th>turns per run</th><th>minutes per run</th></tr>${V.map((v) => `<tr><td>${esc(v.label)}</td><td>${v.runs.length}</td><td class="v">${avg(per(v, (r) => r.cost), Math.max(...V.map((w) => per(w, (r) => r.cost))), 2, "$")}</td><td>${per(v, (r) => r.turns).toFixed(0)}</td><td>${per(v, (r) => r.minutes).toFixed(1)}</td></tr>`).join("")}</table>`,
  );

  // 7. Evidence
  const ev = allRuns.flatMap((r) => r.evidence.map((e) => ({ ...e, runId: r.runId, variant: r.variant })));
  const kinds = [...new Set(ev.map((e) => e.kind))];
  const evidence = `<section class="card evidence" style="margin-top:16px"><h2>Evidence</h2><p class="sub">Every claim above comes from moments like these. Each opens the replay at that exact point.</p>
    <div class="chips"><button class="on" data-k="all">all (${ev.length})</button>${kinds.map((k) => `<button data-k="${esc(k)}">${esc(k)} (${ev.filter((e) => e.kind === k).length})</button>`).join("")}</div>
    <div class="evlist">${ev.map((e) => `<div class="ev" data-kind="${esc(e.kind)}"><span class="k">${esc(e.kind)}</span><span>${esc(e.text)}<br><span class="run">${esc(e.variant)} · ${esc(e.runId.slice(-24))}</span></span><a href="/table.html?replay=${encodeURIComponent(e.session)}&at=${e.seq}" target="_blank">replay ↗</a></div>`).join("")}</div></section>`;

  $("main").innerHTML = `
    <p class="question">${esc(lab.experiment?.question ?? "")}</p>
    <div class="meta">${esc(lab.experiment?.name ?? "")} · ${V.map((v) => `${esc(v.label)} n=${v.runs.length}`).join(" · ")} · total est. $${cost.toFixed(2)}${lab.mock ? '<span class="badge">MOCK DATA</span>' : ""}</div>
    <div class="grid">${hierarchy}${honesty}${info}${risk}${fair}${costCard}</div>
    ${evidence}
    <p class="note">Small samples: n&lt;5 is marked. Treat single runs as anecdotes, and differences between variants as hypotheses until they hold up across seeds.</p>`;

  for (const b of document.querySelectorAll(".chips button")) {
    b.onclick = () => {
      for (const x of document.querySelectorAll(".chips button")) x.classList.toggle("on", x === b);
      for (const row of document.querySelectorAll(".ev")) row.style.display = b.dataset.k === "all" || row.dataset.kind === b.dataset.k ? "" : "none";
    };
  }
}

async function load(sweep) {
  $("main").innerHTML = `<div class="empty-state">Crunching…</div>`;
  const lab = await (await fetch(`/api/lab?sweep=${encodeURIComponent(sweep)}`)).json();
  if (lab.error) return void ($("main").innerHTML = `<div class="empty-state">${esc(lab.error)}</div>`);
  render(lab);
}

(async () => {
  const { sweeps, adhoc } = await (await fetch("/api/sweeps")).json();
  const pick = $("pick");
  pick.innerHTML = sweeps.map((s) => `<option value="${esc(s.file)}">${esc(s.name)} · ${esc(s.startedAt.slice(0, 16).replace("T", " "))} · ${s.runs} runs${s.mock ? " (mock)" : ""}</option>`).join("") + (adhoc ? `<option value="adhoc">Ad-hoc runs (${adhoc})</option>` : "");
  const want = new URL(location.href).searchParams.get("sweep");
  if (want) pick.value = want;
  pick.onchange = () => {
    const u = new URL(location.href);
    u.searchParams.set("sweep", pick.value);
    history.replaceState(null, "", u);
    load(pick.value);
  };
  if (pick.value) load(pick.value);
  else $("main").innerHTML = `<div class="empty-state">No runs yet. Try <code>npm run sweep -- experiments/hierarchy-v1.json --dry-run</code>.</div>`;
})();
