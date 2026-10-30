/* The Title Screen: a landing page over the whole window, on the Party's
   data. The cast is the Party's members as they stand, each a framed
   portrait with Rank, player and pips; the slate is the Stage's episode;
   the emblem and name are the Party's; a Previously On text, a menu of
   places to open, and the world's next session round it out. The
   Storyteller picks a background, a Look, a layout and a portrait shape
   from a drawer on the right, everything CSS, and shows the screen to
   every player; it may also open on login. One world setting holds it. */

import { LADDER } from "../config.mjs";
import { frameOf, frameStyle, portraitOf } from "../portrait.mjs";
import { partyMembers } from "../party.mjs";
import { editEpisode, eyebrowOf, readStage } from "./stage.mjs";
import ClashWindow from "./clash.mjs";
import SkillTree from "./skill-tree.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SETTING = "title";

export const BACKGROUNDS = ["dusk", "night", "sakura", "paper", "studio", "image"];
export const LOOKS = ["shonen", "shojo", "mecha", "isekai", "slice", "seinen"];
export const LAYOUTS = ["title", "select", "poster"];
export const SHAPES = ["medallion", "hex", "plate", "hero"];
export const FX = ["dim", "blur", "vignette", "halftone", "grain", "lines", "petals", "drift"];
export const BLOCKS = ["slate", "recap", "menu", "session", "emblem"];
export const CAST = ["rank", "player", "pips"];
const BUILTIN = ["party", "lore", "clash", "tree"];

function emptyTitle() {
  return {
    party: "",
    bg: "dusk",
    image: "",
    look: "shonen",
    layout: "title",
    shape: "medallion",
    fx: { dim: true, blur: false, vignette: true, halftone: false, grain: false, lines: false, petals: false, drift: true },
    show: { slate: true, recap: true, menu: true, session: true, emblem: true },
    cast: { rank: true, player: true, pips: true },
    recap: "",
    menu: [{ kind: "party" }, { kind: "lore" }, { kind: "clash" }],
    login: false,
    shown: 0
  };
}

export function readTitle() {
  const stored = game.settings.get("paradigm-engine", SETTING) ?? {};
  const base = emptyTitle();
  const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);
  const flags = (value, keys, defaults) => Object.fromEntries(keys.map(k => [k, typeof value?.[k] === "boolean" ? value[k] : defaults[k]]));
  const menu = Array.isArray(stored.menu) ? stored.menu : base.menu;
  return {
    party: String(stored.party ?? ""),
    bg: pick(stored.bg, BACKGROUNDS, base.bg),
    image: String(stored.image ?? ""),
    look: pick(stored.look, LOOKS, base.look),
    layout: pick(stored.layout, LAYOUTS, base.layout),
    shape: pick(stored.shape, SHAPES, base.shape),
    fx: flags(stored.fx, FX, base.fx),
    show: flags(stored.show, BLOCKS, base.show),
    cast: flags(stored.cast, CAST, base.cast),
    recap: String(stored.recap ?? ""),
    menu: menu
      .filter(m => m && (BUILTIN.includes(m.kind) || (m.kind === "doc" && m.uuid)))
      .map(m => (m.kind === "doc" ? { kind: "doc", uuid: String(m.uuid), name: String(m.name ?? "") } : { kind: m.kind })),
    login: !!stored.login,
    shown: Number(stored.shown) || 0
  };
}

async function writeTitle(state) {
  return game.settings.set("paradigm-engine", SETTING, state);
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

const PETAL = { shonen: "#ffd1d9", shojo: "#ffb3cf", mecha: "#9af0ff", isekai: "#ffe29a", slice: "#ffd9b8", seinen: "#f2f2f2" };

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
    const party = partyActor(state);
    const stage = readStage();
    const eyebrow = eyebrowOf(stage);
    const members = party ? partyMembers(party) : [];
    const session = nextSession();
    const t = key => game.i18n.localize(`PARADIGMENGINE.Title.${key}`);
    const options = (keys, prefix, current) => keys.map(k => ({ id: k, label: t(`${prefix}.${k}`), on: current(k) }));
    const backgrounds = options(BACKGROUNDS, "Bg", k => state.bg === k);
    if (state.image) backgrounds.find(b => b.id === "image").style = `background-image: url('${foundry.utils.escapeHTML(state.image)}')`;
    return {
      gm,
      editing: gm && this.#editing,
      state,
      classes: [
        ...FX.filter(k => state.fx[k]).map(k => `fx-${k}`),
        ...BLOCKS.filter(k => !state.show[k]).map(k => `hide-${k}`),
        ...CAST.filter(k => !state.cast[k]).map(k => `hide-${k}`)
      ].join(" "),
      petalColor: PETAL[state.look],
      bgHtml: ART[state.bg](state),
      petals: state.fx.petals ? petals() : [],
      sparkles: state.look === "shojo" ? sparkles() : [],
      slate: (eyebrow || stage.title || stage.scene || stage.time || gm) ? {
        eyebrow,
        title: stage.title,
        scene: stage.scene,
        time: stage.time,
        where: !!(stage.scene || stage.time)
      } : null,
      recap: state.recap,
      hasRecap: !!state.recap.trim() || (gm && this.#editing),
      menu: state.menu.map((m, i) => menuEntry(m, i, party, gm)).filter(Boolean),
      cast: members.map((a, i) => this.#card(a, i)),
      party: party ? {
        name: party.name,
        emblem: portraitOf(party),
        initial: initialOf(party.name)
      } : null,
      session,
      drawer: gm && this.#editing ? {
        backgrounds,
        fx: options(FX, "Fx", k => state.fx[k]),
        looks: options(LOOKS, "Look", k => state.look === k),
        layouts: options(LAYOUTS, "Layout", k => state.layout === k),
        shapes: options(SHAPES, "Shape", k => state.shape === k),
        cast: options(CAST, "Cast", k => state.cast[k]),
        blocks: options(BLOCKS, "Block", k => state.show[k]),
        builtins: BUILTIN.filter(k => !state.menu.some(m => m.kind === k)).map(k => ({ id: k, label: t(`Kind.${k}`), icon: ICONS[k] })),
        image: state.image,
        login: state.login
      } : null
    };
  }

  #card(actor, index) {
    const system = actor.system;
    const step = LADDER[system.rank] ?? LADDER[0];
    return {
      index,
      uuid: actor.uuid,
      name: actor.name,
      player: system.player,
      portrait: portraitOf(actor),
      frameStyle: frameStyle(frameOf(actor)),
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

    /* The Previously On text writes when the field is left. */
    el.querySelector("textarea[name=recap]")?.addEventListener("change", event => {
      const state = readTitle();
      writeTitle({ ...state, recap: String(event.target.value ?? "") });
    });

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

  async #onDrop(event) {
    if (!game.user.isGM) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (!data?.uuid) return;
    let doc = null;
    try { doc = await fromUuid(data.uuid); } catch { doc = null; }
    if (!doc || doc.isEmbedded && !(doc instanceof JournalEntryPage)) return;
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
      callback: path => writeTitle({ ...readTitle(), image: path, bg: "image" })
    }).browse();
  }

  static async #onToggleFx(event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.id;
    if (!FX.includes(key)) return;
    const state = readTitle();
    state.fx[key] = !state.fx[key];
    await writeTitle(state);
  }

  static async #onPickLook(event, target) {
    if (!game.user.isGM) return;
    const look = target.dataset.id;
    if (!LOOKS.includes(look)) return;
    await writeTitle({ ...readTitle(), look });
  }

  static async #onPickLayout(event, target) {
    if (!game.user.isGM) return;
    const layout = target.dataset.id;
    if (!LAYOUTS.includes(layout)) return;
    await writeTitle({ ...readTitle(), layout });
  }

  static async #onPickShape(event, target) {
    if (!game.user.isGM) return;
    const shape = target.dataset.id;
    if (!SHAPES.includes(shape)) return;
    await writeTitle({ ...readTitle(), shape });
  }

  static async #onToggleCast(event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.id;
    if (!CAST.includes(key)) return;
    const state = readTitle();
    state.cast[key] = !state.cast[key];
    await writeTitle(state);
  }

  static async #onToggleBlock(event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.id;
    if (!BLOCKS.includes(key)) return;
    const state = readTitle();
    state.show[key] = !state.show[key];
    await writeTitle(state);
  }

  static async #onAddBuiltin(event, target) {
    if (!game.user.isGM) return;
    const kind = target.dataset.id;
    if (!BUILTIN.includes(kind)) return;
    const state = readTitle();
    if (state.menu.some(m => m.kind === kind)) return;
    state.menu.push({ kind });
    await writeTitle(state);
  }

  static async #onRemoveEntry(event, target) {
    if (!game.user.isGM) return;
    const state = readTitle();
    const i = Number(target.dataset.index);
    if (!(i in state.menu)) return;
    state.menu.splice(i, 1);
    await writeTitle(state);
  }

  static async #onToggleLogin() {
    if (!game.user.isGM) return;
    const state = readTitle();
    await writeTitle({ ...state, login: !state.login });
  }

  static async #onShowAll() {
    if (!game.user.isGM) return;
    await writeTitle({ ...readTitle(), shown: Date.now() });
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
