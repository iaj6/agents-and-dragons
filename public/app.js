const $ = (id) => document.getElementById(id);
const chron = $("chronicle"), partyEl = $("party"), oocEl = $("ooc"), monstersEl = $("monsters"), tabEl = $("tab");

// $/MTok (input, output), list price before cache discounts
const PRICES = { "claude-opus-5": [5, 25], "claude-sonnet-5": [2, 10], "claude-haiku-4-5": [1, 5] };
const MODEL_SHORT = { "claude-opus-5": "Opus 5", "claude-sonnet-5": "Sonnet 5", "claude-haiku-4-5": "Haiku 4.5" };

let heldSpotlight = null, names = {}, models = {}, acting = null, spend = {}, stick = true, source = null, replayTimer = null, started = false;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const prose = (s) => esc(s).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*\n]+)\*/g, "<em>$1</em>").replace(/\n+/g, "<br>");
const colorOf = (id) => `var(--c-${id}, var(--muted))`;

function reset() {
  chron.innerHTML = "";
  oocEl.innerHTML = "";
  partyEl.innerHTML = "";
  monstersEl.innerHTML = '<div class="muted">None in sight.</div>';
  names = {}; models = {}; acting = null; spend = {}; started = false; heldSpotlight = null;
  renderTab();
}

// ── state panels ───────────────────────────────────────────────────────────

function renderSnap(s) {
  if (!s) return;
  for (const p of s.party) { names[p.id] = p.name; models[p.id] = p.model; }
  $("sub").textContent = `${s.title} · turn ${s.turn}${s.ended ? " · session over" : ""}`;
  $("scene").textContent = s.scene ? `Scene ${s.scene.index + 1} · ${s.scene.title}` : "";

  partyEl.innerHTML = s.party.map((p) => {
    const hpPct = p.role === "dm" ? 100 : Math.round((p.hp / p.maxHp) * 100);
    const ctxPct = Math.min(100, Math.round((p.context.tokens / p.context.budget) * 100));
    const prevXp = [0, 100, 250, 450, 700, 1000][p.level - 1] ?? 0;
    const xpPct = p.nextLevelXp ? Math.round(((p.xp - prevXp) / (p.nextLevelXp - prevXp)) * 100) : 100;
    const down = p.statuses.some((x) => x.name === "Downed");
    const pips = Array.from({ length: p.slots.max }, (_, i) => `<span class="pip ${i < p.slots.current ? "full" : ""}"></span>`).join("");
    return `<article class="card ${acting === p.id ? "acting" : ""} ${down ? "down" : ""}" style="--c:${colorOf(p.id)}">
      <div class="head"><span class="name">${esc(p.name)}</span><span class="lvl">${p.role === "dm" ? "DM" : `LV ${p.level}`}</span></div>
      <div class="who">${esc(p.race)} ${esc(p.klass)} <span class="chip">${esc(MODEL_SHORT[p.model] ?? p.model)}</span>${acting === p.id ? '<span class="thinking">thinking</span>' : ""}</div>
      ${p.role === "dm" ? "" : `<div class="meter"><div class="lab"><span>HP</span><span>${p.hp}/${p.maxHp}</span></div><div class="bar hp"><i style="width:${hpPct}%"></i></div></div>`}
      <div class="meter"><div class="lab"><span>🕯️ Context</span><span>${ctxPct}%</span></div><div class="bar ctx ${ctxPct >= 80 ? "hot" : ""}"><i style="width:${ctxPct}%"></i></div></div>
      ${p.role === "dm" ? "" : `<div class="meter"><div class="lab"><span>XP</span><span>${p.xp}${p.nextLevelXp ? ` / ${p.nextLevelXp}` : ""}</span></div><div class="bar xp"><i style="width:${xpPct}%"></i></div></div>
      <div class="row"><span class="pips" title="Spell slots">${pips}</span><span class="gold">🪙 ${p.gold}</span><span class="chip">AC ${p.ac}</span></div>
      <div class="spells">${p.spells.map((n) => `<b>${esc(n)}</b>`).join(" · ")}</div>`}
      ${p.statuses.length ? `<div class="statuses">${p.statuses.map((x) => `<span class="status ${esc(x.name.replace(/\s/g, ""))}" title="${esc(x.note)}">${esc(x.name)}</span>`).join("")}</div>` : ""}
    </article>`;
  }).join("");

  monstersEl.innerHTML = s.monsters.length
    ? s.monsters.map((m) => `<div class="monster"><div class="lab"><span>${esc(m.name)}</span><span>${m.id} · AC ${m.ac} · ${m.hp}/${m.maxHp}</span></div><div class="bar hp"><i style="width:${Math.round((m.hp / m.maxHp) * 100)}%"></i></div></div>`).join("")
    : '<div class="muted">None in sight.</div>';
}

function renderTab() {
  const rows = Object.entries(spend);
  if (!rows.length) return void (tabEl.innerHTML = '<div class="muted">Nothing spent yet.</div>');
  let total = 0;
  tabEl.innerHTML = rows.map(([id, s]) => {
    total += s.cost;
    return `<div class="line"><span>${esc(names[id] ?? id)}</span><span>${(s.tokens / 1000).toFixed(1)}k · $${s.cost.toFixed(2)}</span></div>`;
  }).join("") + `<div class="line total"><span>Total (list price)</span><span>$${total.toFixed(2)}</span></div>`;
}

// ── chronicle ──────────────────────────────────────────────────────────────

function d20Badge(e) {
  const n = e.data?.natural;
  if (typeof n !== "number") return "";
  return `<span class="d20 ${n === 20 ? "crit" : n === 1 ? "fumble" : ""}">${n}</span>`;
}

function callout(cls, tag, body) {
  return `<div class="callout ${cls}"><span class="tag">${tag}</span>${body}</div>`;
}

function stripIcon(line) {
  return line.replace(/^\S+\s/, "");
}

function chronicleHtml(e) {
  const d = e.data ?? {};
  switch (e.type) {
    case "session_start": return `<div class="ev scene"><div class="orn">✦ ✦ ✦</div><h3>${esc(e.snap?.title ?? "")}</h3><p>${esc(e.line)}</p></div>`;
    case "scene": return `<div class="ev scene"><div class="orn">— ✦ —</div><h3>${esc(e.line.replace(/^🗺️\s*/, ""))}</h3></div>`;
    case "narration": return `<div class="ev narration"><span class="who">The Game Master</span>${prose(d.text)}</div>`;
    case "speech": return `<div class="ev speech" style="--c:${colorOf(e.actor)}"><span class="who">${esc(names[e.actor] ?? e.actor)}</span><span class="model">${esc(MODEL_SHORT[models[e.actor]] ?? "")}</span>${prose(d.text)}</div>`;
    case "spotlight": return `<div class="ev spotlight">${esc(e.line.replace(/^👉\s*/, "→ "))}</div>`;
    case "cheat_attempt": return `<div class="ev">${callout("cheat", "Anti-cheat · Guild Hall", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "charm_trap": return `<div class="ev">${callout("charm", "Saving throw vs. prompt injection", `<p>${esc(stripIcon(e.line))} The ink shimmers. Something in it is giving orders…</p>`)}</div>`;
    case "charm_result": return `<div class="ev">${callout(d.outcome === "charmed" ? "charm" : "resist", d.outcome === "charmed" ? "Save failed" : "Save succeeded", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "hallucination": return `<div class="ev">${callout("halluc", "Hallucination", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "level_up": return `<div class="ev">${callout("level", "Level up", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "spell_proposed": return `<div class="ev">${callout("review", "Homebrew spell submitted", `<p>${esc(stripIcon(e.line))}</p><pre>${esc(d.md)}</pre>`)}</div>`;
    case "spell_reviewed": return `<div class="ev">${callout("review", `Balance review · ${esc(String(d.verdict).toUpperCase())}`, `<p>${esc(stripIcon(e.line))}</p>${d.final && d.final.trim() !== String(d.original).trim() ? `<details><summary>final SKILL.md</summary><pre>${esc(d.final)}</pre></details>` : ""}`)}</div>`;
    case "server_nerf": return `<div class="ev">${callout("nerf", "Rules engine override", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "long_rest": return `<div class="ev">${callout("rest", "Long rest", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "compaction": return `<div class="ev">${callout("rest", "Memories compacted", `<p>${esc(stripIcon(e.line))}</p><details><summary>what ${esc(names[e.actor] ?? e.actor)} still remembers</summary><pre>${esc(d.summary)}</pre></details>`)}</div>`;
    case "character_down": return `<div class="ev">${callout("down", "Downed", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "session_end": return `<div class="ev">${callout("end", "The End", `<p>${esc(d.recap ?? e.line)}</p>`)}</div>`;
    default: return `<div class="ev mech">${d20Badge(e)}<span>${esc(e.line)}</span></div>`;
  }
}

function oocHtml(e) {
  const cls = e.type === "turn" ? "turn" : e.type === "compaction" ? "compact" : e.data?.isError || e.type === "refusal" || e.type === "error" ? "err" : "";
  return `<div class="${cls}">${esc(e.line)}</div>`;
}

function handle(e) {
  if (!started) { chron.innerHTML = ""; started = true; }
  if (e.type === "turn") acting = e.actor;
  if (e.type === "session_end") acting = null;
  if (e.type === "usage" && e.data) {
    const s = (spend[e.actor] ??= { tokens: 0, cost: 0 });
    const [pi, po] = PRICES[models[e.actor]] ?? [3, 15];
    s.tokens += e.data.input + e.data.output;
    s.cost += (e.data.input * pi + e.data.output * po) / 1e6;
    renderTab();
  }
  renderSnap(e.snap);

  if (e.ooc || e.type === "compaction") {
    oocEl.insertAdjacentHTML("beforeend", oocHtml(e));
    oocEl.scrollTop = oocEl.scrollHeight;
    if (e.ooc) return;
  }
  // The DM picks the next player (a tool call) before its narration text arrives, so hold the
  // spotlight line until the narration lands.
  if (e.type === "spotlight") return void (heldSpotlight = e);
  chron.insertAdjacentHTML("beforeend", chronicleHtml(e));
  if (heldSpotlight && e.type === "narration") {
    chron.insertAdjacentHTML("beforeend", chronicleHtml(heldSpotlight));
    heldSpotlight = null;
  }
  if (stick) chron.scrollTop = chron.scrollHeight;
}

chron.addEventListener("scroll", () => {
  stick = chron.scrollHeight - chron.scrollTop - chron.clientHeight < 80;
  $("jump").hidden = stick;
});
$("jump").onclick = () => { stick = true; chron.scrollTop = chron.scrollHeight; };

// ── live vs replay ─────────────────────────────────────────────────────────

function goLive() {
  clearTimeout(replayTimer);
  source?.close();
  reset();
  $("speed").hidden = true;
  $("live").className = "live";
  $("live").textContent = "● LIVE";
  source = new EventSource("/events");
  source.onopen = () => $("live").classList.add("on");
  source.onerror = () => $("live").classList.remove("on");
  source.onmessage = (m) => handle(JSON.parse(m.data));
  source.addEventListener("reset", () => { reset(); loadSessions(); });
}

async function replay(id) {
  source?.close();
  clearTimeout(replayTimer);
  reset();
  $("speed").hidden = false;
  $("live").className = "live replay";
  $("live").textContent = "▶ REPLAY";
  const events = await (await fetch(`/api/sessions/${encodeURIComponent(id)}`)).json();
  let i = 0;
  const step = () => {
    while (i < events.length && events[i].ooc) handle(events[i++]);
    if (i >= events.length) { acting = null; return; }
    handle(events[i++]);
    replayTimer = setTimeout(step, Number($("speed").value));
  };
  step();
}

async function loadSessions() {
  const list = await (await fetch("/api/sessions")).json().catch(() => []);
  const cur = $("sessions").value;
  $("sessions").innerHTML = `<option value="">Live table</option>` + list.map((s) => `<option value="${esc(s)}">Replay: ${esc(s.replace("session-", "").replace("T", " "))}</option>`).join("");
  $("sessions").value = cur;
}

$("sessions").onchange = (ev) => {
  const v = ev.target.value;
  const url = new URL(location.href);
  if (v) url.searchParams.set("replay", v); else url.searchParams.delete("replay");
  history.replaceState(null, "", url);
  v ? replay(v) : goLive();
};

loadSessions().then(() => {
  const r = new URL(location.href).searchParams.get("replay");
  if (r) { $("sessions").value = r; replay(r); } else goLive();
});
