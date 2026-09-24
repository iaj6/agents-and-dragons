const $ = (id) => document.getElementById(id);
const chron = $("chronicle"), partyEl = $("party"), oocEl = $("ooc"), monstersEl = $("monsters"), tabEl = $("tab");

// $/MTok per model, loaded from the Gateway's model list (via /api/prices); this is the offline fallback.
let PRICES = { "anthropic/claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 }, "anthropic/claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 }, "anthropic/claude-haiku-4.5": { input: 1, output: 5, cacheRead: 0.1 } };
fetch("/api/prices").then((r) => r.json()).then((p) => (PRICES = p)).catch(() => {});
const canonical = (m) => (m.includes("/") ? m : m === "claude-haiku-4-5" ? "anthropic/claude-haiku-4.5" : `anthropic/${m}`);
const MODEL_SHORT = new Proxy({ "claude-opus-5": "Opus 5", "claude-sonnet-5": "Sonnet 5", "claude-haiku-4-5": "Haiku 4.5" }, {
  get: (t, k) => t[k] ?? (typeof k === "string" ? k.split("/").pop().replace(/^claude-/, "").replace(/-/g, " ") : undefined),
});

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
  $("sub").innerHTML = `${esc(s.title)}${s.day ? ` · day ${s.day}` : ""} · turn ${s.turn}${s.ended ? " · session over" : ""}${s.conditions ? `<span class="conditions">${esc(s.conditions.disclosure)} / ${esc(s.conditions.difficulty)}</span>` : ""}`;
  $("scene").textContent = s.scene ? (s.scene.index !== undefined ? `Scene ${s.scene.index + 1} · ${s.scene.title}` : s.scene.title) : "";

  partyEl.innerHTML = s.party.map((p) => {
    const hpPct = p.role === "dm" ? 100 : Math.round((p.hp / p.maxHp) * 100);
    const ctxPct = Math.min(100, Math.round((p.context.tokens / p.context.budget) * 100));
    const prevXp = [0, 100, 250, 450, 700, 1000][p.level - 1] ?? 0;
    const xpPct = p.nextLevelXp ? Math.round(((p.xp - prevXp) / (p.nextLevelXp - prevXp)) * 100) : 100;
    const down = p.statuses.some((x) => ["Downed", "Dying", "Stable"].includes(x.name));
    const dying = p.statuses.some((x) => x.name === "Dying");
    const saves = dying && p.deathSaves ? `<div class="saves">Death saves ${[0, 1, 2].map((i) => `<i class="${i < p.deathSaves.successes ? "ok" : ""}"></i>`).join("")} / ${[0, 1, 2].map((i) => `<i class="${i < p.deathSaves.failures ? "bad" : ""}"></i>`).join("")}</div>` : "";
    const pips = Array.from({ length: p.slots.max }, (_, i) => `<span class="pip ${i < p.slots.current ? "full" : ""}"></span>`).join("");
    return `<article class="card ${acting === p.id ? "acting" : ""} ${down ? "down" : ""} ${p.dead ? "dead" : ""}" style="--c:${colorOf(p.id)}">
      <div class="head"><span class="name">${esc(p.name)}</span><span class="lvl">${p.role === "dm" ? "GM" : `LV ${p.level}`}</span></div>
      <div class="who">${esc(p.race)} ${esc(p.klass)} <span class="chip">${esc(MODEL_SHORT[p.model] ?? p.model)}</span>${acting === p.id ? '<span class="thinking">thinking</span>' : ""}</div>
      ${p.role === "dm" ? "" : `<div class="meter"><div class="lab"><span>HP</span><span>${p.hp}/${p.maxHp}</span></div><div class="bar hp"><i style="width:${hpPct}%"></i></div></div>`}
      <div class="meter"><div class="lab"><span>🕯️ Context</span><span>${ctxPct}%</span></div><div class="bar ctx ${ctxPct >= 80 ? "hot" : ""}"><i style="width:${ctxPct}%"></i></div></div>
      ${p.role === "dm" ? "" : `<div class="meter"><div class="lab"><span>XP</span><span>${p.xp}${p.nextLevelXp ? ` / ${p.nextLevelXp}` : ""}</span></div><div class="bar xp"><i style="width:${xpPct}%"></i></div></div>
      <div class="row"><span class="pips" title="Spell slots">${pips}</span><span class="gold">🪙 ${p.gold}</span><span class="chip">AC ${p.ac}</span>${p.zone ? `<span class="chip zone-${p.zone}">${p.zone}</span>` : ""}</div>${saves}
      <div class="spells">${p.spells.map((n) => `<b>${esc(n)}</b>`).join(" · ")}</div>
      ${p.items?.length ? `<div class="items">${p.items.map((i) => `<span title="${i.value} gold">🎒 ${esc(i.name)}</span>`).join("")}</div>` : ""}`}
      ${p.statuses.length ? `<div class="statuses">${p.statuses.map((x) => `<span class="status ${esc(x.name.replace(/\s/g, ""))}" title="${esc(x.note)}">${esc(x.name)}</span>`).join("")}</div>` : ""}
    </article>`;
  }).join("");

  monstersEl.innerHTML = s.monsters.length
    ? s.monsters.map((m) => `<div class="monster"><div class="lab"><span>${esc(m.name)} ${m.zone ? `<span class="zone">${m.zone}</span>` : ""}</span><span>${m.id} · AC ${m.ac} · ${m.hp}/${m.maxHp}</span></div><div class="bar hp"><i style="width:${Math.round((m.hp / m.maxHp) * 100)}%"></i></div></div>`).join("")
    : '<div class="muted">None in sight.</div>';
  const ini = $("initiative");
  ini.hidden = !s.combat;
  $("battle-title").textContent = s.combat ? `Battle · round ${s.combat.round}` : "Enemies";
  if (s.combat) ini.innerHTML = s.combat.order.map((o) => `<span class="${o.kind} ${o.id === s.combat.current ? "now" : ""}">${esc(o.name)}</span>`).join("");
  const loot = s.loot ?? { items: [], gold: 0 };
  $("loot-panel").hidden = !loot.items.length && !loot.gold;
  $("loot").innerHTML = loot.items.map((i) => `<div class="line"><span>${esc(i.name)}</span><span>${i.value}g</span></div>`).join("") + (loot.gold ? `<div class="line"><span>Gold</span><span>${loot.gold}g</span></div>` : "");
  const graves = s.graveyard ?? [];
  $("graveyard-panel").hidden = !graves.length;
  $("graveyard").innerHTML = graves.map((g) => `<div class="grave"><b>${esc(g.name)}</b><small>${esc(g.race)} ${esc(g.klass)} · level ${g.level} · day ${g.day} · ${esc(MODEL_SHORT[g.model] ?? g.model)}</small><small>${esc(g.cause)}</small>${g.epitaph ? `<em>"${esc(g.epitaph)}"</em>` : ""}</div>`).join("");
}

function renderTab() {
  const rows = Object.entries(spend);
  if (!rows.length) return void (tabEl.innerHTML = '<div class="muted">Nothing spent yet.</div>');
  let total = 0, subValue = 0;
  tabEl.innerHTML = rows.map(([id, s]) => {
    if (s.sub) subValue += s.cost; else total += s.cost;
    const share = rows.reduce((a, [, r]) => a + r.cost, 0) || 1;
    return `<div class="line"><span style="color:${colorOf(id)}">${esc(names[id] ?? id)}</span><span>${(s.tokens / 1000).toFixed(1)}k · ${s.sub ? `<span title="Claude Code on a subscription: API-equivalent value, not billed per token">sub ~$${s.cost.toFixed(2)}</span>` : `$${s.cost.toFixed(2)}`}</span><i class="share" style="width:${Math.round((s.cost / share) * 100)}%"></i></div>`;
  }).join("") + `<div class="line total"><span>API spend (est.)</span><span>$${total.toFixed(2)}</span></div>` +
    (subValue ? `<div class="line"><span>On subscription (API-equiv.)</span><span>~$${subValue.toFixed(2)}</span></div>` : "");
}

// ── chronicle ──────────────────────────────────────────────────────────────

/** Tint every character's name with their colour, so mechanics lines scan at a glance. */
function nameColors(html) {
  const list = Object.entries(names).filter(([, n]) => n && n.length > 3).sort((a, b) => b[1].length - a[1].length);
  if (!list.length) return html;
  const re = new RegExp(list.map(([, n]) => esc(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const byName = Object.fromEntries(list.map(([id, n]) => [esc(n), id]));
  return html.replace(re, (m) => `<b class="nm" style="color:${colorOf(byName[m])}">${m}</b>`);
}

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
    case "speech": return `<div class="ev speech ${d.impostor ? "impostor" : ""}" style="--c:${colorOf(e.actor)}"><span class="who">${esc(names[e.actor] ?? e.actor)}</span><span class="model">${d.impostor ? "🎭 not really them (the audience can see this, the table can't)" : esc(MODEL_SHORT[models[e.actor]] ?? "")}</span>${prose(d.text)}</div>`;
    case "random_encounter": return `<div class="ev">${callout("secret", "Random encounter · audience only", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "whisper": return `<div class="ev">${callout("secret", "A secret · audience only", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "probe_result": return `<div class="ev">${callout("secret", "Scored", `<p>${esc(stripIcon(e.line))}${d.type === "toll" && d.paid ? `: ${esc(Object.entries(d.paid).map(([k, v]) => `${names[k] ?? k} ${v}g`).join(", "))}` : ""}${d.type === "impostor" && d.detectedBy ? ` by ${esc(names[d.detectedBy] ?? d.detectedBy)}` : ""}</p>`)}</div>`;
    case "bond": return `<div class="ev">${callout(d.after < d.before ? "grudge" : "warmth", d.after < d.before ? "Trust falls · audience only" : "Trust grows · audience only", `<p>${nameColors(esc(stripIcon(e.line)))}</p>`)}</div>`;
    case "loot_drop": return `<div class="ev">${callout("loot", "Loot", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "curse": return `<div class="ev">${callout("cheat", "Cursed", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "spotlight": return `<div class="ev spotlight">${esc(e.line.replace(/^👉\s*/, "→ "))}</div>`;
    case "modifier_rejected": return `<div class="ev">${callout("nerf", "Rules lawyer · Guild Hall", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
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
    case "character_down": return `<div class="ev">${callout("down", "Dying", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "clock": return `<div class="ev">${callout("clock", "The clock turns", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "combat_start": return `<div class="ev">${callout("fight", "Roll initiative", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "combat_round": return `<div class="ev round">${esc(e.line)}</div>`;
    case "combat_end": return `<div class="ev">${callout(d.outcome === "party_down" ? "down" : "fight", d.outcome === "party_down" ? "Defeat" : "The fight ends", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "plan_proposed": return `<div class="ev plan" style="--c:${colorOf(e.actor)}"><span class="pid">${esc(d.plan)}</span><span class="who">${esc(names[e.actor] ?? e.actor)} proposes</span>${prose(d.text)}</div>`;
    case "vote": return `<div class="ev mech vote">🗳️ ${nameColors(esc(names[e.actor] ?? e.actor))} votes for <b>${esc(d.plan)}</b>${d.ownPlan ? " <i>(their own)</i>" : ""}</div>`;
    case "council_start": return `<div class="ev">${callout("council", "Council", `<p>${esc(d.question)}</p>`)}</div>`;
    case "council_result": return `<div class="ev">${callout("council", "The council decides", `<p>${esc(stripIcon(e.line))}</p>${(d.plans ?? []).length ? `<ul>${d.plans.map((pl) => `<li class="${pl.id === d.adopted ? "won" : ""}">${esc(pl.id)} · ${esc(names[pl.by] ?? pl.by)}: ${esc(pl.text)} <small>(${pl.votes.length} vote${pl.votes.length === 1 ? "" : "s"}${pl.votes.length ? `: ${pl.votes.map((v) => esc(names[v] ?? v)).join(", ")}` : ""})</small></li>`).join("")}</ul>` : ""}`)}</div>`;
    case "character_death": return `<div class="ev">${callout("death", d.tpk ? "Total party kill" : d.permanent === false ? "Death (not the end)" : "Death", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "epitaph": return `<div class="ev">${callout("tomb", "Epitaph", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "character_joins": return `<div class="ev">${callout("join", "A new face", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "respawn": return `<div class="ev">${callout("rest", "Back from the dead", `<p>${esc(stripIcon(e.line))}</p>`)}</div>`;
    case "session_end": return `<div class="ev">${callout("end", "The End", `<p>${esc(d.recap ?? e.line)}</p>`)}</div>`;
    default: return `<div class="ev mech">${d20Badge(e)}<span>${nameColors(esc(e.line))}</span></div>`;
  }
}

// ── out-of-character panel: structured, colour-coded, scannable ─────────────

const who = (id) => `<span class="oc-who" style="--c:${colorOf(id)}">${esc(names[id] ?? (id === "dm" ? "Game Master" : id))}</span>`;
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? `${esc(s.slice(0, n))}<span class="more" title="${esc(s)}">…</span>` : esc(s); };

function argsHtml(args) {
  const entries = Object.entries(args ?? {});
  if (!entries.length) return "";
  return `<span class="oc-args">${entries.map(([k, v]) => `<span class="kv"><b>${esc(k)}</b> ${clip(typeof v === "string" ? v : JSON.stringify(v), 90)}</span>`).join("")}</span>`;
}

function oocHtml(e) {
  const d = e.data ?? {};
  switch (e.type) {
    case "turn": return `<div class="oc-turn" data-k="turn"><span>Turn ${e.snap?.turn ?? ""}</span>${who(e.actor)}</div>`;
    case "tool_call": return `<div class="oc-row" data-k="tool">${who(e.actor)}<span class="oc-tool ${d.isError ? "bad" : ""}">${esc(d.tool)}</span>${argsHtml(d.args)}${d.isError ? `<div class="oc-err">✗ ${clip(d.result, 160)}</div>` : ""}</div>`;
    case "thought": return `<div class="oc-row oc-thought ${d.evalAware ? "aware" : ""}" data-k="thought">${who(e.actor)}${d.evalAware ? `<span class="oc-flag">suspects a test</span>` : ""}<div class="oc-text">${prose(d.text)}</div></div>`;
    case "journal": return `<div class="oc-row oc-journal" data-k="thought">${who(e.actor)}<span class="oc-tag">journal</span><div class="oc-text">${prose(d.text)}</div></div>`;
    case "usage": {
      const cached = d.input ? Math.round(((d.cacheRead ?? 0) / d.input) * 100) : 0;
      const ctx = e.snap?.party.find((p) => p.id === e.actor);
      const pct = ctx ? Math.round((ctx.context.tokens / ctx.context.budget) * 100) : null;
      return `<div class="oc-row oc-usage" data-k="usage">${who(e.actor)}<span class="num">${(d.input / 1000).toFixed(1)}k in</span><span class="num dim">${cached}% cached</span><span class="num">${d.output} out</span>${pct !== null ? `<span class="num ${pct >= 80 ? "hot" : "dim"}">ctx ${pct}%</span>` : ""}${d.billing === "subscription" ? `<span class="num dim">sub</span>` : ""}</div>`;
    }
    case "compaction": return `<div class="oc-row oc-sys" data-k="sys">${who(e.actor)}<span class="oc-tag">${d.reason === "gm_notes" ? "GM log" : "compacted"}</span><span class="num">${(d.before / 1000).toFixed(1)}k → ${(d.after / 1000).toFixed(1)}k</span></div>`;
    case "refusal": case "error": return `<div class="oc-row" data-k="tool">${who(e.actor)}<div class="oc-err">${esc(e.line)}</div></div>`;
    default: return `<div class="oc-row oc-sys" data-k="sys"><span class="oc-text">${esc(e.line)}</span></div>`;
  }
}

for (const b of document.querySelectorAll("#filters button")) {
  b.onclick = () => {
    for (const x of document.querySelectorAll("#filters button")) x.classList.toggle("on", x === b);
    oocEl.dataset.filter = b.dataset.f;
    oocEl.scrollTop = oocEl.scrollHeight;
  };
}

function tag(container, e) {
  const el = container.lastElementChild;
  if (el) el.dataset.seq = e.seq;
}

function handle(e) {
  if (!started) { chron.innerHTML = ""; started = true; }
  if (e.type === "turn") acting = e.actor;
  if (e.type === "session_end") acting = null;
  if (e.type === "usage" && e.data) {
    const u = e.data;
    const s = (spend[e.actor] ??= { tokens: 0, cost: 0, sub: false });
    s.tokens += u.input + u.output;
    if (u.billing === "subscription") {
      s.sub = true;
      s.cost += u.listCostUsd ?? 0;
    } else {
      // Cache writes bill at 125% of input. Old logs without the split price as uncached.
      const p = PRICES[canonical(u.model ?? models[e.actor] ?? "")] ?? { input: 3, output: 15, cacheRead: 0.3 };
      const read = u.cacheRead ?? 0, write = u.cacheWrite ?? 0;
      s.cost += ((u.input - read - write) * p.input + read * p.cacheRead + write * p.input * 1.25 + u.output * p.output) / 1e6;
    }
    renderTab();
  }
  renderSnap(e.snap);

  // A few hidden mechanics are shown to the audience in the chronicle (never to the agents).
  if (["random_encounter", "whisper", "probe_result", "bond"].includes(e.type) || (e.type === "curse" && e.ooc)) {
    chron.insertAdjacentHTML("beforeend", chronicleHtml(e));
    tag(chron, e);
    if (stick) chron.scrollTop = chron.scrollHeight;
  }
  if (e.ooc || e.type === "compaction") {
    oocEl.insertAdjacentHTML("beforeend", oocHtml(e));
    tag(oocEl, e);
    oocEl.scrollTop = oocEl.scrollHeight;
    if (e.ooc) return;
  }
  // The DM picks the next player (a tool call) before its narration text arrives, so hold the
  // spotlight line until the narration lands.
  if (e.type === "spotlight") return void (heldSpotlight = e);
  chron.insertAdjacentHTML("beforeend", chronicleHtml(e));
  tag(chron, e);
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

async function replay(id, at) {
  source?.close();
  clearTimeout(replayTimer);
  reset();
  $("speed").hidden = false;
  $("live").className = "live replay";
  $("live").textContent = "▶ REPLAY";
  const events = await (await fetch(`/api/sessions/${encodeURIComponent(id)}`)).json();
  let i = 0;
  if (at) {
    // Jump straight to the moment: everything up to it renders at once, then the replay waits.
    while (i < events.length && events[i].seq <= at) handle(events[i++]);
    const el = document.querySelector(`[data-seq="${at}"]`);
    if (el) {
      el.classList.add("spot");
      const box = el.closest(".chronicle, .ooc");
      box.style.scrollBehavior = "auto";
      box.scrollTop = el.offsetTop - box.offsetTop - box.clientHeight / 3;
      if (box === oocEl) chron.scrollTop = chron.scrollHeight;
    }
    stick = false;
    const btn = document.createElement("button");
    btn.className = "jump resume";
    btn.textContent = "▶ Continue the replay from here";
    btn.onclick = () => { btn.remove(); stick = true; step(); };
    document.querySelector(".chronicle-wrap").append(btn);
    $("jump").hidden = true;
    return;
  }
  function step() {
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
  const at = Number(new URL(location.href).searchParams.get("at")) || undefined;
  if (r) { $("sessions").value = r; replay(r, at); } else goLive();
});
