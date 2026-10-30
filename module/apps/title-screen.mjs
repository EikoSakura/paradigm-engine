/* The Title Screen: a landing page over the whole window, on the Party's
   data. The cast is the Party's members as they stand, each a framed
   portrait with Rank, player and pips; the slate is the Stage's episode;
   the emblem and name are the Party's; a Previously On text, a menu of
   places to open, and the world's next session round it out.

   The Storyteller's drawer on the right sets it up. A background: five
   drawn presets or any image or video, with treatments. A Look: a
   starting point that fills the Style controls, every one of which may
   then be changed, the title font among them from the bundled fonts and
   the ones in Foundry's Font Configuration. A Layout: a starting
   arrangement of the blocks, each of which is then dragged by its grip
   wherever it should stand. Portraits are framed with the mouse: drag
   moves the picture, the wheel zooms it. Show To Players opens the screen
   on every player's client, and it may open on login. One world setting
   holds it all. */

import { LADDER } from "../config.mjs";
import { frameOf, frameStyle, portraitOf } from "../portrait.mjs";
import { partyMembers } from "../party.mjs";
import { editEpisode, eyebrowOf, readStage } from "./stage.mjs";
import ClashWindow from "./clash.mjs";
import SkillTree from "./skill-tree.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SETTING = "title";

export const BACKGROUNDS = ["dusk", "night", "sakura", "paper", "studio", "image"];
export const FX = ["dim", "blur", "mono", "vignette", "halftone", "grain", "lines", "petals", "drift"];
export const LAYOUTS = ["title", "select", "poster", "banner"];
export const SHAPES = ["medallion", "hex", "plate", "polaroid", "hero"];
export const SHADOWS = ["none", "hard", "glow", "outline", "offset"];
export const DECOS = ["none", "ribbon", "hud", "frame", "sparkles"];
export const BLOCKS = ["slate", "recap", "menu", "session", "emblem"];
export const CAST = ["rank", "player", "pips"];
export const COLORS = ["a", "a2", "ink", "plate", "plateInk", "ring"];
const BUILTIN = ["party", "lore", "clash", "tree"];
const PLACED = ["slate", "recap", "menu", "cast", "party", "session", "enter"];

/* The fonts the system ships, with the weight each is cut in. */
export const FONTS = {
  "Bangers": 400, "Dela Gothic One": 400, "Mochiy Pop One": 400, "Reggae One": 400, "RocknRoll One": 400, "Rampart One": 400,
  "Train One": 400, "Potta One": 400, "Hachi Maru Pop": 400, "Kiwi Maru": 500, "Yusei Magic": 400, "DotGothic16": 400, "Stick": 400,
  "Kaisei Decol": 700, "Zen Antique": 400, "Zen Old Mincho": 700, "Yuji Syuku": 400, "Shippori Mincho B1": 800, "Zen Kaku Gothic New": 900
};

/* Looks: starting points for the Style controls. */
export const LOOKS = {
  shonen: {
    style: { font: "Bangers", weight: 400, size: 100, ls: 2, skew: -8, radius: 24, upper: false, shadow: "hard", deco: "ribbon", cut: "cut", a: "#d92b48", a2: "#d9a13b", ink: "#ffffff", plate: "#100c1c", plateA: 62, plateInk: "#ffffff", ring: "#ffffff" },
    petal: "#ffd1d9", fx: { mono: false, lines: false, halftone: false }
  },
  shojo: {
    style: { font: "Mochiy Pop One", weight: 400, size: 80, ls: 0, skew: 0, radius: 24, upper: false, shadow: "glow", deco: "sparkles", cut: "straight", a: "#ff7fb0", a2: "#8c6bd6", ink: "#4a2b4f", plate: "#ffffff", plateA: 78, plateInk: "#4a2b4f", ring: "#ffffff" },
    petal: "#ffb3cf", fx: { mono: false, petals: true, halftone: false }
  },
  mecha: {
    style: { font: "Dela Gothic One", weight: 400, size: 75, ls: 8, skew: -14, radius: 4, upper: true, shadow: "glow", deco: "hud", cut: "cut", a: "#45e3ff", a2: "#ffb347", ink: "#e6fbff", plate: "#040e18", plateA: 78, plateInk: "#e6fbff", ring: "#45e3ff" },
    petal: "#9af0ff", fx: { mono: false, halftone: false }
  },
  isekai: {
    style: { font: "Shippori Mincho B1", weight: 800, size: 85, ls: 4, skew: 0, radius: 10, upper: false, shadow: "offset", deco: "frame", cut: "straight", a: "#d9a13b", a2: "#8fb4ff", ink: "#f6ecd2", plate: "#141028", plateA: 70, plateInk: "#f6ecd2", ring: "#d9a13b" },
    petal: "#ffe29a", fx: { mono: false, halftone: false }
  },
  slice: {
    style: { font: "Zen Kaku Gothic New", weight: 900, size: 80, ls: -1, skew: 0, radius: 4, upper: false, shadow: "hard", deco: "none", cut: "straight", a: "#e9743b", a2: "#6fb1a1", ink: "#3b2f2a", plate: "#fffdf7", plateA: 100, plateInk: "#3b2f2a", ring: "#fffdf7" },
    petal: "#ffd9b8", fx: { mono: false, halftone: false }, shape: "polaroid"
  },
  seinen: {
    style: { font: "Reggae One", weight: 400, size: 95, ls: 1, skew: 0, radius: 0, upper: false, shadow: "offset", deco: "none", cut: "straight", a: "#e10f2a", a2: "#f2f2f2", ink: "#f2f2f2", plate: "#000000", plateA: 82, plateInk: "#f2f2f2", ring: "#f2f2f2" },
    petal: "#f2f2f2", fx: { mono: true, halftone: true }
  }
};

/* Layouts: a starting place and anchor for each block, in percent of the
   screen, the menu's direction, the cast's size. */
const POS = {
  title: { slate: [0, 0, 0, 0], menu: [100, 0, 100, 0, "col"], recap: [0, 54, 0, 100], cast: [50, 92, 50, 100], party: [0, 100, 0, 100], session: [50, 100, 50, 100], enter: [100, 100, 100, 100] },
  select: { slate: [50, 0, 50, 0], menu: [50, 86, 50, 100, "row"], recap: [0, 88, 0, 100], cast: [50, 52, 50, 50], party: [0, 100, 0, 100], session: [100, 92, 100, 100], enter: [100, 100, 100, 100] },
  poster: { slate: [0, 0, 0, 0], menu: [100, 0, 100, 0, "col"], recap: [0, 100, 0, 100], cast: [50, 100, 50, 100], party: [100, 100, 100, 100], session: [100, 92, 100, 100], enter: [100, 56, 100, 50] },
  banner: { slate: [0, 100, 0, 100], menu: [0, 0, 0, 0, "row"], recap: [100, 0, 100, 0], cast: [100, 100, 100, 100], party: [50, 0, 50, 0], session: [50, 100, 50, 100], enter: [50, 88, 50, 100] }
};
const CAST_SCALE = { title: 100, select: 135, poster: 170, banner: 85 };
const CAST_SHAPE = { poster: "hero" };

function emptyTitle() {
  return {
    party: "",
    bg: "dusk",
    image: "",
    look: "shonen",
    style: { ...LOOKS.shonen.style },
    fx: { dim: true, blur: false, mono: false, vignette: true, halftone: false, grain: false, lines: false, petals: false, drift: true },
    layout: "title",
    pos: {},
    cs: 100,
    shape: "medallion",
    show: { slate: true, recap: true, menu: true, session: true, emblem: true },
    cast: { rank: true, player: true, pips: true },
    recap: "",
    menu: [{ kind: "party" }, { kind: "lore" }, { kind: "clash" }],
    frames: {},
    login: false,
    shown: 0
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

export function readTitle() {
  const stored = game.settings.get("paradigm-engine", SETTING) ?? {};
  const base = emptyTitle();
  const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.clamp(n, min, max) : fallback;
  };
  const flags = (value, keys, defaults) => Object.fromEntries(keys.map(k => [k, typeof value?.[k] === "boolean" ? value[k] : defaults[k]]));
  const look = pick(stored.look, Object.keys(LOOKS), base.look);
  const fallback = LOOKS[look].style;
  const raw = stored.style ?? fallback;
  const style = {
    font: typeof raw.font === "string" && raw.font ? raw.font : fallback.font,
    weight: num(raw.weight, fallback.weight, 100, 900),
    size: num(raw.size, fallback.size, 50, 160),
    ls: num(raw.ls, fallback.ls, -4, 20),
    skew: num(raw.skew, fallback.skew, -18, 18),
    radius: num(raw.radius, fallback.radius, 0, 24),
    upper: typeof raw.upper === "boolean" ? raw.upper : fallback.upper,
    shadow: pick(raw.shadow, SHADOWS, fallback.shadow),
    deco: pick(raw.deco, DECOS, fallback.deco),
    cut: raw.cut === "straight" ? "straight" : "cut",
    plateA: num(raw.plateA, fallback.plateA, 0, 100)
  };
  for (const key of COLORS) style[key] = HEX.test(raw[key] ?? "") ? raw[key].toLowerCase() : fallback[key];
  const layout = pick(stored.layout, LAYOUTS, base.layout);
  const pos = {};
  if (stored.pos && typeof stored.pos === "object") {
    for (const key of PLACED) {
      const p = stored.pos[key];
      if (!Array.isArray(p) || p.length < 4) continue;
      const clean = p.slice(0, 4).map(v => num(v, 0, 0, 100));
      if (key === "menu") clean.push(p[4] === "row" ? "row" : "col");
      pos[key] = clean;
    }
  }
  const menu = Array.isArray(stored.menu) ? stored.menu : base.menu;
  const frames = {};
  if (stored.frames && typeof stored.frames === "object") {
    for (const [uuid, f] of Object.entries(stored.frames)) {
      if (!f || typeof f !== "object") continue;
      frames[uuid] = { x: num(f.x, 0, -100, 100), y: num(f.y, 0, -100, 100), z: num(f.z, 1, 1, 3) };
    }
  }
  return {
    party: String(stored.party ?? ""),
    bg: pick(stored.bg, BACKGROUNDS, base.bg),
    image: String(stored.image ?? ""),
    look,
    style,
    fx: flags(stored.fx, FX, base.fx),
    layout,
    pos,
    cs: num(stored.cs, CAST_SCALE[layout], 60, 180),
    shape: pick(stored.shape, SHAPES, CAST_SHAPE[layout] ?? base.shape),
    show: flags(stored.show, BLOCKS, base.show),
    cast: flags(stored.cast, CAST, base.cast),
    recap: String(stored.recap ?? ""),
    menu: menu
      .filter(m => m && (BUILTIN.includes(m.kind) || (m.kind === "doc" && m.uuid)))
      .map(m => (m.kind === "doc" ? { kind: "doc", uuid: String(m.uuid), name: String(m.name ?? "") } : { kind: m.kind })),
    frames,
    login: !!stored.login,
    shown: Number(stored.shown) || 0
  };
}

async function writeTitle(state) {
  return game.settings.set("paradigm-engine", SETTING, state);
}

/* Read, change, write. */
async function patch(change) {
  const state = readTitle();
  change(state);
  return writeTitle(state);
}

/* The Party the screen reads: the one chosen, else the first. */
function partyActor(state) {
  let party = null;
  if (state.party) {
    try { party = fromUuidSync(state.party); } catch { party = null; }
  }
  if (party?.type !== "party") party = game.actors.find(a => a.type === "party") ?? null;
  return party;
}

function initialOf(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

function pips({ value, max }) {
  return Array.from({ length: max }, (_, i) => i < value);
}

/* ---- the Style as CSS variables ---- */

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha / 100})`;
}

function luma(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) * .299 + ((n >> 8) & 255) * .587 + (n & 255) * .114) / 255;
}

function titleShadow(style) {
  switch (style.shadow) {
    case "hard": return "4px 4px 0 #000";
    case "glow": return `0 0 18px ${rgba(style.a, 60)}, 0 3px 0 ${style.plate}`;
    case "outline": return `-2px -2px 0 ${style.a}, 2px -2px 0 ${style.a}, -2px 2px 0 ${style.a}, 2px 2px 0 ${style.a}`;
    case "offset": return `6px 6px 0 ${style.a}`;
    default: return "none";
  }
}

export function styleVars(state) {
  const s = state.style;
  const vars = {
    "--f-title": `"${s.font.replace(/"/g, "")}"`,
    "--title-weight": s.weight,
    "--title-scale": s.size / 100,
    "--title-ls": `${s.ls / 100}em`,
    "--skew": `${s.skew}deg`,
    "--r": `${s.radius >= 24 ? 999 : s.radius}px`,
    "--title-tf": s.upper ? "uppercase" : "none",
    "--title-shadow": titleShadow(s),
    "--a": s.a,
    "--a2": s.a2,
    "--ink": s.ink,
    "--plate": rgba(s.plate, s.plateA),
    "--plate-ink": s.plateInk,
    "--ring": s.ring,
    "--tag-ink": luma(s.a) > .6 ? "#111111" : "#ffffff",
    "--cs": state.cs / 100,
    "--petal": LOOKS[state.look]?.petal ?? "#ffd1d9"
  };
  return Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(" ");
}

/* ---- generated backgrounds: no art, only shapes ---- */

function seeded(seed) {
  let r = seed;
  return () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
}

function skyline() {
  const rnd = seeded(7);
  let s = "";
  for (let x = 0; x < 1000;) {
    const w = 18 + rnd() * 50;
    const h = 40 + rnd() * 150;
    s += `<rect x="${x.toFixed(1)}" y="${(200 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/>`;
    if (rnd() > .6) s += `<rect x="${(x + w * .35).toFixed(1)}" y="${(186 - h).toFixed(1)}" width="${(w * .3).toFixed(1)}" height="14"/>`;
    for (let i = 0; i < 6; i++) {
      if (rnd() > .55) s += `<rect fill="#ffd27a" opacity=".8" x="${(x + 4 + rnd() * (w - 8)).toFixed(1)}" y="${(206 - h + rnd() * (h - 12)).toFixed(1)}" width="3" height="4"/>`;
    }
    x += w + 2 + rnd() * 6;
  }
  return `<svg viewBox="0 0 1000 200" preserveAspectRatio="none"><g fill="#120a24">${s}</g></svg>`;
}

function stars() {
  const rnd = seeded(3);
  let s = "";
  for (let i = 0; i < 140; i++) {
    s += `<i style="left:${(rnd() * 100).toFixed(1)}%;top:${(rnd() * 100).toFixed(1)}%;opacity:${(.3 + rnd() * .7).toFixed(2)};scale:${(.6 + rnd()).toFixed(2)}"></i>`;
  }
  return `<div class="stars">${s}</div>`;
}

const SKYLINE = skyline();
const STARS = stars();

const ART = {
  dusk: () => `<div class="sky dusk"></div><div class="sun"></div><div class="skyline">${SKYLINE}</div>`,
  night: () => `<div class="sky night"></div>${STARS}<div class="moon"></div><div class="ground"></div>`,
  sakura: () => `<div class="sky sakura"></div><div class="glow a"></div><div class="glow b"></div>`,
  paper: () => `<div class="sky paper"></div><div class="enso"></div>`,
  studio: () => `<div class="sky studio"></div><div class="studio-lines"></div>`,
  image: state => {
    const src = state.image;
    if (!src) return ART.studio();
    const safe = foundry.utils.escapeHTML(src);
    if (foundry.helpers.media.VideoHelper.hasVideoExtension(src)) {
      return `<video class="pic" src="${safe}" autoplay muted loop playsinline disablepictureinpicture></video>`;
    }
    return `<img class="pic" src="${safe}" alt="">`;
  }
};

function petals() {
  return Array.from({ length: 16 }, (_, i) => `left:${(i * 61) % 100}%;--d:${9 + (i % 5) * 1.7}s;--dl:-${((i * 1.3) % 12).toFixed(1)}s;--sx:${-80 - (i % 4) * 60}px;scale:${.7 + (i % 3) * .3}`);
}

function sparkles() {
  return Array.from({ length: 14 }, (_, i) => `left:${(i * 37 + 9) % 100}%;top:${(i * 53 + 5) % 90}%;--dl:-${((i * .7) % 3).toFixed(1)}s;scale:${.5 + (i % 3) * .35}`);
}

/* The world's next session, as Foundry's join page shows it. */
function nextSession() {
  const iso = game.world.nextSession;
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(game.i18n.lang, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* The fonts on offer: the bundled ones and Foundry's Font Configuration. */
function fontList(current) {
  const names = new Set(Object.keys(FONTS));
  try {
    for (const f of foundry.applications.settings.menus.FontConfig.getAvailableFonts()) names.add(f);
  } catch { /* the list is optional */ }
  names.add(current);
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/* A menu entry's document, or null. */
function docOf(entry) {
  if (entry.kind !== "doc") return null;
  try { return fromUuidSync(entry.uuid) ?? null; } catch { return null; }
}

/* Whether this user may open what the entry points at. */
function canOpen(entry, party) {
  switch (entry.kind) {
    case "party":
    case "lore":
      return !!party && party.testUserPermission(game.user, "LIMITED");
    case "clash":
    case "tree":
      return true;
    case "doc": {
      const doc = docOf(entry);
      if (!doc) return false;
      if (doc instanceof Scene) return game.user.isGM || doc.navigation || doc.active;
      if (doc instanceof Macro) return doc.canExecute;
      return typeof doc.testUserPermission === "function" ? doc.testUserPermission(game.user, "LIMITED") : game.user.isGM;
    }
  }
  return false;
}

const ICONS = { party: "fa-users", lore: "fa-book", clash: "fa-swords", tree: "fa-sitemap", JournalEntry: "fa-book-open", JournalEntryPage: "fa-file-lines", Scene: "fa-map", Macro: "fa-bolt", Actor: "fa-user", Item: "fa-suitcase", RollTable: "fa-table-list", Playlist: "fa-music" };

function menuEntry(entry, index, party, gm) {
  const doc = docOf(entry);
  if (entry.kind === "doc" && !doc && !gm) return null;
  const open = canOpen(entry, party);
  if (!open && !gm) return null;
  return {
    index,
    kind: entry.kind,
    name: entry.kind === "doc" ? (doc?.name ?? entry.name) : game.i18n.localize(`PARADIGMENGINE.Title.Kind.${entry.kind}`),
    icon: entry.kind === "doc" ? (ICONS[doc?.documentName] ?? "fa-link") : ICONS[entry.kind],
    missing: entry.kind === "doc" && !doc,
    open
  };
}

export default class TitleScreen extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pe-title",
    classes: ["paradigm-engine", "pe-title"],
    tag: "div",
    window: { frame: false, positioned: false },
    actions: {
      enter: TitleScreen.#onEnter,
      toggleEdit: TitleScreen.#onToggleEdit,
      openActor: TitleScreen.#onOpenActor,
      openEntry: TitleScreen.#onOpenEntry,
      editEpisode: TitleScreen.#onEditEpisode,
      pickBg: TitleScreen.#onPickBg,
      pickImage: TitleScreen.#onPickImage,
      toggleFx: TitleScreen.#onToggleFx,
      pickLook: TitleScreen.#onPickLook,
      toggleStyle: TitleScreen.#onToggleStyle,
      pickShadow: TitleScreen.#onPickShadow,
      pickDeco: TitleScreen.#onPickDeco,
      pickLayout: TitleScreen.#onPickLayout,
      pickShape: TitleScreen.#onPickShape,
      toggleCast: TitleScreen.#onToggleCast,
      toggleBlock: TitleScreen.#onToggleBlock,
      addBuiltin: TitleScreen.#onAddBuiltin,
      removeEntry: TitleScreen.#onRemoveEntry,
      toggleLogin: TitleScreen.#onToggleLogin,
      showAll: TitleScreen.#onShowAll
    }
  };

  static PARTS = {
    screen: { template: "systems/paradigm-engine/templates/apps/title-screen.hbs", root: true }
  };

  static instance = null;

  /* The drawer open, on this client. */
  #editing = false;

  /* Open the screen, the Storyteller's drawer open when asked. */
  static open({ edit = false, party = null } = {}) {
    TitleScreen.instance ??= new TitleScreen();
    const app = TitleScreen.instance;
    if (edit && game.user.isGM) app.#editing = true;
    const state = readTitle();
    if (party && game.user.isGM && state.party !== party.uuid) {
      writeTitle({ ...state, party: party.uuid });
    }
    app.render({ force: true });
    return app;
  }

  static refresh = foundry.utils.debounce(() => {
    if (TitleScreen.instance?.rendered) TitleScreen.instance.render();
  }, 60);

  /* Over everything but the windows. */
  async _insertElement(element) {
    const existing = document.getElementById(element.id);
    if (existing) existing.replaceWith(element);
    else document.body.append(element);
  }

  async _prepareContext() {
    const state = readTitle();
    const gm = game.user.isGM;
    const editing = gm && this.#editing;
    const party = partyActor(state);
    const stage = readStage();
    const eyebrow = eyebrowOf(stage);
    const members = party ? partyMembers(party) : [];
    const session = nextSession();
    const t = key => game.i18n.localize(`PARADIGMENGINE.Title.${key}`);
    const options = (keys, prefix, current) => keys.map(k => ({ id: k, label: t(`${prefix}.${k}`), on: current(k) }));
    const blocks = {};
    for (const key of PLACED) {
      const p = state.pos[key] ?? POS[state.layout][key];
      blocks[key] = { x: p[0], y: p[1], ax: p[2], ay: p[3], dir: p[4] ?? POS[state.layout][key][4] ?? "col", style: `--x: ${p[0]}; --y: ${p[1]}; --ax: ${p[2]}; --ay: ${p[3]};` };
    }
    const backgrounds = options(BACKGROUNDS, "Bg", k => state.bg === k);
    if (state.image) backgrounds.find(b => b.id === "image").style = `background-image: url('${foundry.utils.escapeHTML(state.image)}')`;
    return {
      gm,
      editing,
      state,
      styleVars: styleVars(state),
      classes: [
        ...FX.filter(k => state.fx[k]).map(k => `fx-${k}`),
        ...BLOCKS.filter(k => !state.show[k]).map(k => `hide-${k}`),
        ...CAST.filter(k => !state.cast[k]).map(k => `hide-${k}`),
        luma(state.style.ink) > .6 && !state.fx.mono ? "" : "fx-darklines"
      ].filter(Boolean).join(" "),
      bgHtml: ART[state.bg](state),
      petals: state.fx.petals ? petals() : [],
      sparkles: state.style.deco === "sparkles" ? sparkles() : [],
      blocks,
      slate: (eyebrow || stage.title || stage.scene || stage.time || editing) ? {
        eyebrow,
        title: stage.title,
        scene: stage.scene,
        time: stage.time,
        where: !!(stage.scene || stage.time)
      } : null,
      recap: state.recap,
      hasRecap: !!state.recap.trim() || editing,
      menu: state.menu.map((m, i) => menuEntry(m, i, party, gm)).filter(Boolean),
      cast: members.map((a, i) => this.#card(a, i, state)),
      party: party ? { name: party.name, emblem: portraitOf(party), initial: initialOf(party.name) } : null,
      session,
      drawer: editing ? {
        backgrounds,
        fx: options(FX, "Fx", k => state.fx[k]),
        looks: options(Object.keys(LOOKS), "Looks", k => state.look === k),
        fonts: fontList(state.style.font).map(name => ({ name, on: name === state.style.font })),
        ranges: [
          { id: "size", label: t("TitleSize"), min: 50, max: 160, step: 5, value: state.style.size, out: `${state.style.size}%` },
          { id: "ls", label: t("Tracking"), min: -4, max: 20, step: 1, value: state.style.ls, out: `${(state.style.ls / 100).toFixed(2)}em` },
          { id: "skew", label: t("Slant"), min: -18, max: 18, step: 1, value: state.style.skew, out: `${state.style.skew}°` },
          { id: "radius", label: t("Corners"), min: 0, max: 24, step: 1, value: state.style.radius, out: state.style.radius >= 24 ? t("Round") : `${state.style.radius}px` },
          { id: "plateA", label: t("PlateOpacity"), min: 0, max: 100, step: 2, value: state.style.plateA, out: `${state.style.plateA}%` }
        ],
        toggles: [{ id: "upper", label: t("Upper"), on: state.style.upper }, { id: "cut", label: t("CutCorners"), on: state.style.cut === "cut" }],
        shadows: options(SHADOWS, "Shadow", k => state.style.shadow === k),
        decos: options(DECOS, "Deco", k => state.style.deco === k),
        colors: COLORS.map(k => ({ id: k, label: t(`Color.${k}`), value: state.style[k] })),
        layouts: options(LAYOUTS, "Layouts", k => state.layout === k),
        shapes: options(SHAPES, "Shape", k => state.shape === k),
        castSize: { min: 60, max: 180, step: 5, value: state.cs, out: `${state.cs}%` },
        cast: options(CAST, "Cast", k => state.cast[k]),
        blocks: options(BLOCKS, "Block", k => state.show[k]),
        builtins: BUILTIN.filter(k => !state.menu.some(m => m.kind === k)).map(k => ({ id: k, label: t(`Kind.${k}`), icon: ICONS[k] })),
        image: state.image,
        login: state.login
      } : null
    };
  }

  #card(actor, index, state) {
    const system = actor.system;
    const step = LADDER[system.rank] ?? LADDER[0];
    const f = state.frames[actor.uuid] ?? { x: 0, y: 0, z: 1 };
    return {
      index,
      uuid: actor.uuid,
      name: actor.name,
      player: system.player,
      portrait: portraitOf(actor),
      frameStyle: frameStyle(frameOf(actor)),
      picStyle: `--fx: ${f.x}; --fy: ${f.y}; --fz: ${f.z};`,
      zoom: Math.round(f.z * 100),
      initial: initialOf(actor.name),
      rank: step.rank,
      cssVar: step.cssVar,
      hearts: pips(system.hearts),
      energy: pips(system.energy),
      canOpen: actor.testUserPermission(game.user, "LIMITED")
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    el.classList.toggle("editing", !!context.editing);
    if (!context.editing) return;
    this.#wireDrawer(el);
    this.#wireGrips(el);
    this.#wireFrames(el);
  }

  /* The screen element, for live previews before a write. */
  get #screen() {
    return this.element?.querySelector(".screen") ?? null;
  }

  #wireDrawer(el) {
    /* The Previously On text writes when the field is left. */
    el.querySelector("textarea[name=recap]")?.addEventListener("change", event => {
      patch(s => { s.recap = String(event.target.value ?? ""); });
    });

    /* The title font. */
    el.querySelector("select[name=font]")?.addEventListener("change", event => {
      const font = String(event.target.value ?? "");
      if (!font) return;
      patch(s => { s.style.font = font; s.style.weight = FONTS[font] ?? 400; });
    });

    /* Sliders preview as they move and write when released. */
    for (const input of el.querySelectorAll("input[type=range][data-style]")) {
      const key = input.dataset.style;
      const out = input.parentElement.querySelector("output");
      input.addEventListener("input", () => {
        const state = readTitle();
        const value = Number(input.value);
        if (key === "cs") state.cs = value; else state.style[key] = value;
        this.#screen?.setAttribute("style", styleVars(state));
        if (out) out.value = this.#rangeOut(key, value);
      });
      input.addEventListener("change", () => {
        const value = Number(input.value);
        patch(s => { if (key === "cs") s.cs = value; else s.style[key] = value; });
      });
    }

    /* Colours the same way. */
    for (const input of el.querySelectorAll("input[type=color][data-color]")) {
      const key = input.dataset.color;
      input.addEventListener("input", () => {
        const state = readTitle();
        if (HEX.test(input.value)) state.style[key] = input.value.toLowerCase();
        this.#screen?.setAttribute("style", styleVars(state));
      });
      input.addEventListener("change", () => {
        if (!HEX.test(input.value)) return;
        const value = input.value.toLowerCase();
        patch(s => { s.style[key] = value; });
      });
    }

    /* Documents dropped on the menu list join it. */
    const list = el.querySelector(".drawer .mlist");
    if (list) {
      new foundry.applications.ux.DragDrop.implementation({
        dropSelector: ".mlist",
        callbacks: {
          dragover: () => list.classList.add("dragover"),
          drop: event => {
            list.classList.remove("dragover");
            return this.#onDrop(event);
          }
        }
      }).bind(el);
      list.addEventListener("dragleave", () => list.classList.remove("dragover"));
    }
  }

  #rangeOut(key, value) {
    const t = k => game.i18n.localize(`PARADIGMENGINE.Title.${k}`);
    switch (key) {
      case "ls": return `${(value / 100).toFixed(2)}em`;
      case "skew": return `${value}°`;
      case "radius": return value >= 24 ? t("Round") : `${value}px`;
      default: return `${value}%`;
    }
  }

  /* Blocks move by their grips; the centre lines snap. */
  #wireGrips(el) {
    const inner = el.querySelector(".inner");
    if (!inner) return;
    const gv = inner.querySelector(".guide.v");
    const gh = inner.querySelector(".guide.h");
    let drag = null;
    inner.addEventListener("pointerdown", event => {
      const grip = event.target.closest(".grip");
      if (!grip || event.button !== 0) return;
      const key = grip.dataset.grip;
      const block = inner.querySelector(`[data-blk="${key}"]`);
      if (!block) return;
      const state = readTitle();
      const p = (state.pos[key] ?? POS[state.layout][key]).slice();
      if (key === "menu" && p.length < 5) p.push(POS[state.layout].menu[4]);
      drag = { key, block, p, sx: event.clientX, sy: event.clientY, x0: p[0], y0: p[1] };
      block.classList.add("drag");
      grip.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    inner.addEventListener("pointermove", event => {
      if (!drag) return;
      const r = inner.getBoundingClientRect();
      let x = Math.clamp(drag.x0 + ((event.clientX - drag.sx) / r.width) * 100, 0, 100);
      let y = Math.clamp(drag.y0 + ((event.clientY - drag.sy) / r.height) * 100, 0, 100);
      const snapX = Math.abs(x - 50) < 1.5;
      const snapY = Math.abs(y - 50) < 1.5;
      if (snapX) x = 50;
      if (snapY) y = 50;
      gv?.classList.toggle("on", snapX);
      gh?.classList.toggle("on", snapY);
      drag.p[0] = Math.round(x * 10) / 10;
      drag.p[1] = Math.round(y * 10) / 10;
      drag.block.style.setProperty("--x", drag.p[0]);
      drag.block.style.setProperty("--y", drag.p[1]);
    });
    const end = () => {
      if (!drag) return;
      const { key, p, block } = drag;
      drag = null;
      block.classList.remove("drag");
      gv?.classList.remove("on");
      gh?.classList.remove("on");
      patch(s => { s.pos[key] = p; });
    };
    inner.addEventListener("pointerup", end);
    inner.addEventListener("pointercancel", end);
  }

  /* Portraits: drag moves the picture in its frame, the wheel zooms. */
  #wireFrames(el) {
    const cast = el.querySelector(".cast");
    if (!cast) return;
    const limit = f => {
      const lim = (f.z - 1) * 50;
      f.x = Math.clamp(f.x, -lim, lim);
      f.y = Math.clamp(f.y, -lim, lim);
      return f;
    };
    const show = (frame, f) => {
      const pic = frame.querySelector(".pic");
      pic?.style.setProperty("--fx", f.x);
      pic?.style.setProperty("--fy", f.y);
      pic?.style.setProperty("--fz", f.z);
      const zoom = frame.querySelector(".zoom");
      if (zoom) zoom.textContent = `${Math.round(f.z * 100)}%`;
    };
    const frameOfTarget = target => target.closest(".frame");
    const current = uuid => ({ ...(readTitle().frames[uuid] ?? { x: 0, y: 0, z: 1 }) });
    const save = foundry.utils.debounce((uuid, f) => patch(s => { s.frames[uuid] = f; }), 300);
    let drag = null;
    cast.addEventListener("pointerdown", event => {
      const frame = frameOfTarget(event.target);
      if (!frame || event.button !== 0) return;
      const uuid = frame.closest("[data-uuid]")?.dataset.uuid;
      if (!uuid) return;
      const f = current(uuid);
      drag = { frame, uuid, f, sx: event.clientX, sy: event.clientY, x0: f.x, y0: f.y, moved: false };
      frame.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    cast.addEventListener("pointermove", event => {
      if (!drag) return;
      const dx = event.clientX - drag.sx;
      const dy = event.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      const r = drag.frame.getBoundingClientRect();
      drag.f.x = drag.x0 + (dx / r.width) * 100;
      drag.f.y = drag.y0 + (dy / r.height) * 100;
      show(drag.frame, limit(drag.f));
    });
    const end = () => {
      if (!drag) return;
      const { uuid, f, moved } = drag;
      drag = null;
      if (moved) patch(s => { s.frames[uuid] = { x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10, z: f.z }; });
    };
    cast.addEventListener("pointerup", end);
    cast.addEventListener("pointercancel", end);
    cast.addEventListener("wheel", event => {
      const frame = frameOfTarget(event.target);
      if (!frame) return;
      const uuid = frame.closest("[data-uuid]")?.dataset.uuid;
      if (!uuid) return;
      event.preventDefault();
      const f = current(uuid);
      f.z = Math.clamp(Math.round((f.z - Math.sign(event.deltaY) * .1) * 10) / 10, 1, 3);
      show(frame, limit(f));
      save(uuid, f);
    }, { passive: false });
  }

  async #onDrop(event) {
    if (!game.user.isGM) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (!data?.uuid) return;
    let doc = null;
    try { doc = await fromUuid(data.uuid); } catch { doc = null; }
    if (!doc || (doc.isEmbedded && !(doc instanceof JournalEntryPage))) return;
    const state = readTitle();
    if (state.menu.some(m => m.kind === "doc" && m.uuid === doc.uuid)) return;
    state.menu.push({ kind: "doc", uuid: doc.uuid, name: doc.name });
    await writeTitle(state);
  }

  async close(options) {
    this.#editing = false;
    return super.close(options);
  }

  /* ---- actions: anyone ---- */

  static #onEnter() {
    this.close();
  }

  static #onToggleEdit() {
    if (!game.user.isGM) return;
    this.#editing = !this.#editing;
    this.render();
  }

  static #onOpenActor(event, target) {
    /* In Edit the frame is for framing. */
    if (this.#editing && game.user.isGM) return;
    let actor = null;
    try { actor = fromUuidSync(target.dataset.uuid ?? ""); } catch { actor = null; }
    if (actor instanceof Actor && actor.testUserPermission(game.user, "LIMITED")) actor.sheet.render(true);
  }

  static async #onOpenEntry(event, target) {
    const state = readTitle();
    const entry = state.menu[Number(target.dataset.index)];
    if (!entry) return;
    const party = partyActor(state);
    if (!canOpen(entry, party)) return;
    switch (entry.kind) {
      case "party":
        return party.sheet.render({ force: true });
      case "lore":
        await party.sheet.render({ force: true });
        return party.sheet.changeTab("lore", "primary");
      case "clash":
        return ClashWindow.open();
      case "tree": {
        const pc = game.user.character?.type === "pc" ? game.user.character : null;
        return SkillTree.open(pc);
      }
      case "doc": {
        const doc = docOf(entry);
        if (!doc) return;
        if (doc instanceof Scene) return doc.view();
        if (doc instanceof Macro) return doc.execute();
        if (doc instanceof JournalEntryPage) return doc.parent.sheet.render({ force: true, pageId: doc.id });
        return doc.sheet?.render({ force: true });
      }
    }
  }

  static #onEditEpisode() {
    if (game.user.isGM) editEpisode();
  }

  /* ---- actions: the Storyteller's drawer ---- */

  static async #onPickBg(event, target) {
    if (!game.user.isGM) return;
    const bg = target.dataset.id;
    if (!BACKGROUNDS.includes(bg)) return;
    const state = readTitle();
    if (bg === "image" && !state.image) return TitleScreen.#onPickImage.call(this);
    await writeTitle({ ...state, bg });
  }

  static #onPickImage() {
    if (!game.user.isGM) return;
    const state = readTitle();
    new foundry.applications.apps.FilePicker.implementation({
      type: "imagevideo",
      current: state.image,
      callback: path => patch(s => { s.image = path; s.bg = "image"; })
    }).browse();
  }

  static async #onToggleFx(event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.id;
    if (!FX.includes(key)) return;
    await patch(s => { s.fx[key] = !s.fx[key]; });
  }

  /* A Look fills the Style, its treatments and its shape. */
  static async #onPickLook(event, target) {
    if (!game.user.isGM) return;
    const look = LOOKS[target.dataset.id];
    if (!look) return;
    await patch(s => {
      s.look = target.dataset.id;
      s.style = { ...look.style };
      Object.assign(s.fx, look.fx ?? {});
      if (look.shape) s.shape = look.shape;
      else if (s.shape === "polaroid") s.shape = "medallion";
    });
  }

  static async #onToggleStyle(event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.id;
    if (key === "upper") await patch(s => { s.style.upper = !s.style.upper; });
    else if (key === "cut") await patch(s => { s.style.cut = s.style.cut === "cut" ? "straight" : "cut"; });
  }

  static async #onPickShadow(event, target) {
    if (!game.user.isGM) return;
    const shadow = target.dataset.id;
    if (!SHADOWS.includes(shadow)) return;
    await patch(s => { s.style.shadow = shadow; });
  }

  static async #onPickDeco(event, target) {
    if (!game.user.isGM) return;
    const deco = target.dataset.id;
    if (!DECOS.includes(deco)) return;
    await patch(s => { s.style.deco = deco; });
  }

  /* A Layout puts every block back in its place. */
  static async #onPickLayout(event, target) {
    if (!game.user.isGM) return;
    const layout = target.dataset.id;
    if (!LAYOUTS.includes(layout)) return;
    await patch(s => {
      s.layout = layout;
      s.pos = {};
      s.cs = CAST_SCALE[layout];
      if (CAST_SHAPE[layout]) s.shape = CAST_SHAPE[layout];
      else if (s.shape === "hero") s.shape = "medallion";
    });
  }

  static async #onPickShape(event, target) {
    if (!game.user.isGM) return;
    const shape = target.dataset.id;
    if (!SHAPES.includes(shape)) return;
    await patch(s => { s.shape = shape; });
  }

  static async #onToggleCast(event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.id;
    if (!CAST.includes(key)) return;
    await patch(s => { s.cast[key] = !s.cast[key]; });
  }

  static async #onToggleBlock(event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.id;
    if (!BLOCKS.includes(key)) return;
    await patch(s => { s.show[key] = !s.show[key]; });
  }

  static async #onAddBuiltin(event, target) {
    if (!game.user.isGM) return;
    const kind = target.dataset.id;
    if (!BUILTIN.includes(kind)) return;
    await patch(s => { if (!s.menu.some(m => m.kind === kind)) s.menu.push({ kind }); });
  }

  static async #onRemoveEntry(event, target) {
    if (!game.user.isGM) return;
    const i = Number(target.dataset.index);
    await patch(s => { if (i in s.menu) s.menu.splice(i, 1); });
  }

  static async #onToggleLogin() {
    if (!game.user.isGM) return;
    await patch(s => { s.login = !s.login; });
  }

  static async #onShowAll() {
    if (!game.user.isGM) return;
    await patch(s => { s.shown = Date.now(); });
  }
}

export function registerTitleScreen() {
  let lastShown = 0;

  game.settings.register("paradigm-engine", SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: emptyTitle(),
    onChange: value => {
      const shown = Number(value?.shown) || 0;
      if (shown > lastShown && !game.user.isGM) TitleScreen.open();
      lastShown = shown;
      TitleScreen.refresh();
    }
  });

  Hooks.once("ready", () => {
    const state = readTitle();
    lastShown = state.shown;
    if (state.login) TitleScreen.open();
  });

  /* What the screen reads. */
  const actorHook = actor => {
    if (actor.type === "pc" || actor.type === "party") TitleScreen.refresh();
  };
  Hooks.on("createActor", actorHook);
  Hooks.on("updateActor", actorHook);
  Hooks.on("deleteActor", actorHook);
  Hooks.on("updateFolder", () => TitleScreen.refresh());
  Hooks.on("updateSetting", setting => {
    if (setting.key === "paradigm-engine.stage") TitleScreen.refresh();
  });

  /* The Title Screen button in the Token controls. */
  Hooks.on("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if (!tokens) return;
    tokens.tools.title = {
      name: "title",
      title: "PARADIGMENGINE.Title.Title",
      icon: "fa-solid fa-tv",
      order: 102,
      button: true,
      onChange: () => TitleScreen.open()
    };
  });
}
