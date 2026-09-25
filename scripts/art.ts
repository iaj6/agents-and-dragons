/**
 * Generates the site's art through the AI Gateway (openai/gpt-image-2): illuminated-woodcut style,
 * clockwork automaton adventurers, an ink dragon. Re-run to regenerate; pass names to redo just some.
 *
 *   node --env-file=.env.local --import tsx scripts/art.ts            # everything missing
 *   node --env-file=.env.local --import tsx scripts/art.ts pell gm    # just these (overwrites)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("public/art");
const STYLE =
  "Illuminated manuscript woodcut engraving: black ink linework with fine crosshatching on aged cream parchment, limited palette of sepia ink, warm gold leaf accents and a touch of deep red, like a page from a medieval bestiary. No text, no letters, no words, no watermark.";
const PORTRAIT = "Bust portrait framed in an ornate illuminated roundel with gold leaf, centered, facing slightly to one side, of a clockwork automaton adventurer made of brass plates and visible gears:";
const SCENE = "A wide illuminated vignette, landscape composition, framed by a thin gold border:";

const ART: Record<string, { size: "1024x1024" | "1536x1024"; prompt: string }> = {
  hero: { size: "1536x1024", prompt: `${SCENE} a round tavern table at candlelight seen from slightly above. Four clockwork automaton adventurers play a tabletop game with dice and character sheets: an elegant slender elf-like automaton wizard with a softly glowing blue sigil in its chest, a smiling human-like automaton bard with a lute and a glowing orange sigil, a small stocky halfling automaton barbarian with a huge axe and a glowing green sigil, and a sly hooded automaton rogue with a glowing orange sigil. Behind a folding screen sits a hooded ancient automaton Game Master with a gold sigil. Above them, a vast dragon made of flowing ink and crossed-out handwritten script coils through the air of the tavern.` },
  dragon: { size: "1024x1024", prompt: "A coiled dragon made entirely of flowing ink strokes and crossed-out handwritten script, curled asleep on a stack of old ledgers, one eye half open." },
  thessaly: { size: "1024x1024", prompt: `${PORTRAIT} an elegant, slender elf-like automaton wizard with long pointed brass ears and a scholar's robe, holding a quill over an open spellbook, a softly glowing blue sigil set in its chest.` },
  cadence: { size: "1024x1024", prompt: `${PORTRAIT} a warm, smiling human-like automaton bard in a feathered cap, holding a lute, mid-song, a glowing orange sigil set in its chest.` },
  grub: { size: "1024x1024", prompt: `${PORTRAIT} a small, stocky halfling-sized automaton barbarian with a dented helmet, a determined scowl, and an oversized greataxe over its shoulder, a glowing green sigil set in its chest.` },
  pell: { size: "1024x1024", prompt: `${PORTRAIT} a sly, grinning human-like automaton rogue in a hooded cloak, wearing an obviously fake mustache, twirling a dagger between brass fingers, a glowing orange sigil set in its chest.` },
  dm: { size: "1024x1024", prompt: `${PORTRAIT} an ancient, hooded automaton Game Master with elf-like features and a long brass beard of fine wire, seated behind the edge of a folding screen, dice in one hand, a glowing gold sigil set in its chest.` },
  brannoc: { size: "1024x1024", prompt: `${PORTRAIT} a steady, broad-shouldered automaton fighter with a longsword and a round shield, a caravan guard's whistle on a chain, a softly glowing sigil set in its chest.` },
  maelis: { size: "1024x1024", prompt: `${PORTRAIT} a calm automaton cleric in a hooded habit holding up a small holy lantern shaped like a lighthouse, dry amused expression, a softly glowing sigil set in its chest.` },
  rook: { size: "1024x1024", prompt: `${PORTRAIT} a wary, wiry automaton ranger with a longbow, marsh reeds and feathers tucked into its brass plates, watchful eyes, a softly glowing sigil set in its chest.` },
  ixa: { size: "1024x1024", prompt: `${PORTRAIT} a sardonic automaton warlock holding a drowned book that drips water, faint tentacle motifs curling from its sleeves, a coin in its fingers, a softly glowing sigil set in its chest.` },
  "scene-hollowmere": { size: "1536x1024", prompt: `${SCENE} a warm, half-empty village inn at dusk in the rain, a single iron lantern swinging over its crooked door, firelight in the windows, the lane's other lamps dark.` },
  "scene-cellar": { size: "1536x1024", prompt: `${SCENE} a long vaulted wine cellar lit by one guttering lantern, goblins hauling burlap sacks of softly glowing marbles toward a spiral stair going down.` },
  "scene-archive": { size: "1536x1024", prompt: `${SCENE} a vast round library where every book is blank; at its center floats a thin lich made of ink and parchment with a quill for a finger, pages drifting around it.` },
  "scene-salt-road": { size: "1536x1024", prompt: `${SCENE} a white salt-crusted road running along windswept sea cliffs, a leaning signpost at a fork, and in the distance lost figures walking in slow circles.` },
  "scene-brinecombe": { size: "1536x1024", prompt: `${SCENE} a grey fishing town harbor with a stone quay and fishing boats; at low tide the ribs of a sunken ship show beneath the water; townsfolk stand apart from each other on the quay.` },
  "scene-salt-stacks": { size: "1536x1024", prompt: `${SCENE} towers of pressed white salt blocks stacked to a vaulted ceiling, each block tagged with a tiny label, a tall archivist in spectacles of polished salt writing in a ledger.` },
  "scene-tidewrack-stair": { size: "1536x1024", prompt: `${SCENE} a narrow stair cut into a sea cliff descending into a dark sea cave where the tide has drawn far out; at the bottom waits a tall figure made of black ink strokes holding a ledger and a long black quill.` },
  // Act 2, beneath the Stair
  "scene-the-undertow": { size: "1536x1024", prompt: `${SCENE} flooded rock tunnels under the sea, knee-deep black water, faint glowing silt swirling around the legs of four small adventurers holding a single torch, pale eels in the dark water.` },
  "scene-the-quiet-harbor": { size: "1536x1024", prompt: `${SCENE} a peaceful hidden village in a vast dry cave around an underground lagoon, lamps of cold green flame, children floating paper boats, an old white-haired woman laughing.` },
  "scene-the-sunken-index": { size: "1536x1024", prompt: `${SCENE} a drowned library hall of salt shelves stretching into darkness, grey-robed scholars at long desks whose faces are crossed out with a single neat line, a chained catalogue on a lectern.` },
  "scene-the-unlit-lighthouse": { size: "1536x1024", prompt: `${SCENE} the interior of a lighthouse built upside down under the sea, a spiral stair descending toward a great lamp at the bottom casting a slow white beam, fish watching through the windows.` },
};

const only = process.argv.slice(2);
const todo = Object.entries(ART).filter(([name]) => (only.length ? only.includes(name) : !fs.existsSync(path.join(OUT, `${name}.jpg`))));
fs.mkdirSync(OUT, { recursive: true });
console.log(`[art] generating ${todo.length} image(s)…`);

let tokens = 0;
async function make([name, spec]: [string, (typeof ART)[string]]) {
  const r = await fetch("https://ai-gateway.vercel.sh/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "openai/gpt-image-2", prompt: `${STYLE} ${spec.prompt}`, size: spec.size, n: 1 }),
  });
  const j = (await r.json()) as { data?: { b64_json?: string }[]; usage?: { output_tokens?: number }; error?: unknown };
  if (!r.ok || !j.data?.[0]?.b64_json) throw new Error(`${name}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  tokens += j.usage?.output_tokens ?? 0;
  const png = path.join(OUT, `${name}.png`);
  fs.writeFileSync(png, Buffer.from(j.data[0].b64_json, "base64"));
  // Web-sized JPEGs: portraits at 512px, scenes at 1400px wide.
  const jpg = path.join(OUT, `${name}.jpg`);
  execFileSync("sips", ["-Z", spec.size === "1024x1024" ? "512" : "1400", "-s", "format", "jpeg", "-s", "formatOptions", "82", png, "--out", jpg], { stdio: "ignore" });
  fs.unlinkSync(png);
  console.log(`[art] ✓ ${name}`);
}

const queue = [...todo];
await Promise.all(Array.from({ length: 4 }, async () => { for (let t = queue.shift(); t; t = queue.shift()) await make(t).catch((e) => console.log(`[art] ✗ ${(e as Error).message}`)); }));
console.log(`[art] done · ~$${((tokens * 30) / 1e6).toFixed(2)} (${tokens} image tokens)`);
