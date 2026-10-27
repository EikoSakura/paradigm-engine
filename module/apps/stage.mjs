/* The Stage: an overlay on the board, on the file skin, per user. Four
   things sit on it. The episode slate at the top: Season, Arc, Episode and
   the episode's title, with the scene and the time; the Storyteller edits
   it, and may play it as a title card across every screen. The facing
   plates at the top left: NPCs the Storyteller drops on, each a medallion,
   name and Rank, with Hearts when shown and a veil that hides who it is
   from the players; they stack under the scene tabs, and one NPC may
   stand several times, the copies lettered. The party strip at the bottom left, above the
   players list: every PC a player
   owns, or every PC while no player owns one, as a medallion with its Rank, Hearts and Energy pips the owner may
   click, the Luck dice, a ring when a Bond is invoked, and a raised hand
   while an Encounter runs; idle, the strip folds to the medallions and
   opens under the pointer, and it stays open through an Encounter or a
   Clash. The Clash strip above the hotbar while a Clash runs: the target,
   each side's boxes, a click opens the Clash window. Episode and facing
   are one world setting; the overlay is a Token-controls toggle. */

import { LADDER, letterCopies } from "../config.mjs";
import { frameOf, frameStyle, portraitOf } from "../portrait.mjs";
import ClashWindow, { clashWinner, readClash, sideName } from "./clash.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const SETTING = "stage";
const SHOW = "stageShown";
const STRIP = "stageStrip";
const HAND = "hand";
const CARD_MS = 3400;
const EDGE = 12;

/* x%, delay s */
const PETALS = [[12, .2], [31, .9], [47, .5], [58, 1.3], [70, .1], [24, 1.6]];

function emptyStage() {
  return { season: 0, arc: 0, episode: 0, title: "", scene: "", time: "", facing: [], card: 0 };
}

export function readStage() {
  const stored = game.settings.get("paradigm-engine", SETTING) ?? {};
  const whole = v => Math.max(0, Math.trunc(Number(v) || 0));
  const text = v => String(v ?? "").trim();
  const facing = Array.isArray(stored.facing) ? stored.facing : [];
  return {
    season: whole(stored.season),
    arc: whole(stored.arc),
    episode: whole(stored.episode),
    title: text(stored.title),
    scene: text(stored.scene),
    time: text(stored.time),
    facing: facing.filter(f => f?.uuid).map(f => ({ uuid: String(f.uuid), hearts: !!f.hearts, veiled: !!f.veiled })),
    card: Number(stored.card) || 0
  };
}

async function writeStage(state) {
  return game.settings.set("paradigm-engine", SETTING, state);
}

function shown() {
  return !!game.settings.get("paradigm-engine", SHOW);
}

/* The actor a facing plate reads, through a token's UUID too. */
function actorAt(uuid) {
  let doc = null;
  try { doc = fromUuidSync(uuid); } catch { doc = null; }
  if (doc instanceof foundry.documents.TokenDocument) doc = doc.actor;
  return doc instanceof Actor ? doc : null;
}

/* Season, Arc and Episode on one line, the ones that are set. */
function eyebrowOf(stage) {
  const parts = [];
  for (const key of ["Season", "Arc", "Episode"]) {
    const value = stage[key.toLowerCase()];
    if (value) parts.push(`${game.i18n.localize(`PARADIGMENGINE.Stage.${key}`)} ${value}`);
  }
  return parts.join(" · ");
}

function initialOf(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

function pips({ value, max }) {
  return Array.from({ length: max }, (_, i) => i < value);
}

function percent({ value, max }) {
  return max > 0 ? Math.round(Math.clamp(value / max, 0, 1) * 100) : 0;
}

export default class StageOverlay extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pe-stage",
    classes: ["paradigm-engine", "pe-stage"],
    tag: "div",
    window: { frame: false, positioned: false },
    actions: {
      editEpisode: StageOverlay.#onEditEpisode,
      openActor: StageOverlay.#onOpenActor,
      setPip: StageOverlay.#onSetPip,
      toggleHearts: StageOverlay.#onToggleHearts,
      toggleVeil: StageOverlay.#onToggleVeil,
      removeFacing: StageOverlay.#onRemoveFacing,
      openClash: StageOverlay.#onOpenClash
    }
  };

  static PARTS = {
    stage: { template: "systems/paradigm-engine/templates/apps/stage.hbs", root: true }
  };

  static instance = null;

  /* Show or hide to match the user's toggle. */
  static sync() {
    if (!shown()) {
      StageOverlay.instance?.close();
      return;
    }
    StageOverlay.instance ??= new StageOverlay();
    StageOverlay.instance.render({ force: true });
  }

  static refresh = foundry.utils.debounce(() => {
    if (StageOverlay.instance?.rendered) StageOverlay.instance.render();
  }, 60);

  /* The overlay lives in the interface layer, over the board and under
     the windows. */
  async _insertElement(element) {
    const parent = document.getElementById("interface") ?? document.body;
    const existing = document.getElementById(element.id);
    if (existing) existing.replaceWith(element);
    else parent.append(element);
  }

  async _prepareContext() {
    const stage = readStage();
    const gm = game.user.isGM;
    const combat = game.combat;
    const encounter = !!combat?.started;
    const hands = new Set();
    if (encounter) {
      for (const c of combat.combatants) if (c.actorId && c.getFlag("paradigm-engine", HAND)) hands.add(c.actorId);
    }
    const clash = readClash();
    const winner = clash.started ? clashWinner(clash) : -1;
    const all = game.actors.filter(a => a.type === "pc");
    const owned = all.filter(a => a.hasPlayerOwner);
    const pcs = (owned.length ? owned : all).sort((a, b) => a.name.localeCompare(b.name));
    const names = letterCopies(stage.facing.map(f => ({ uuid: f.uuid, name: actorAt(f.uuid)?.name ?? "" })));
    return {
      gm,
      episode: this.#episode(stage, gm),
      facing: stage.facing.map((f, i) => this.#plate(f, i, gm, names[i].name)).filter(Boolean),
      party: pcs.map(a => this.#card(a, hands)),
      encounter,
      clash: clash.started ? {
        targetLabel: game.i18n.format("PARADIGMENGINE.Clash.TargetChip", { n: clash.target }),
        sides: clash.sides.map((s, i) => ({
          name: sideName(s),
          won: i === winner,
          boxes: Array.from({ length: clash.target }, (_, k) => k < s.marks)
        }))
      } : null
    };
  }

  #episode(stage, gm) {
    const eyebrow = eyebrowOf(stage);
    const empty = !eyebrow && !stage.title && !stage.scene && !stage.time;
    if (empty) return gm ? { empty: true } : null;
    return {
      empty: false,
      eyebrow,
      title: stage.title,
      scene: stage.scene,
      time: stage.time,
      where: !!(stage.scene || stage.time)
    };
  }

  #plate(entry, index, gm, name) {
    const actor = actorAt(entry.uuid);
    if (!actor) return null;
    const step = LADDER[actor.system.rank] ?? LADDER[0];
    const veil = entry.veiled && !gm;
    return {
      index,
      uuid: entry.uuid,
      name: veil ? game.i18n.localize("PARADIGMENGINE.Stage.Unknown") : name,
      rank: veil ? "?" : step.rank,
      cssVar: veil ? "--rk-e" : step.cssVar,
      portrait: veil ? "" : portraitOf(actor),
      frameStyle: frameStyle(frameOf(actor)),
      initial: veil ? "?" : initialOf(actor.name),
      veiled: entry.veiled,
      heartsShown: entry.hearts,
      showHearts: gm || entry.hearts,
      hearts: pips(actor.system.hearts),
      canOpen: !veil && actor.testUserPermission(game.user, "LIMITED")
    };
  }

  #card(actor, hands) {
    const system = actor.system;
    const step = LADDER[system.rank] ?? LADDER[0];
    return {
      uuid: actor.uuid,
      name: actor.name,
      portrait: portraitOf(actor),
      frameStyle: frameStyle(frameOf(actor)),
      initial: initialOf(actor.name),
      rank: step.rank,
      cssVar: step.cssVar,
      hearts: pips(system.hearts),
      energy: pips(system.energy),
      heartsPct: percent(system.hearts),
      energyPct: percent(system.energy),
      luck: (system.luck ?? []).map(slot => ({ value: slot.value, spent: slot.spent, empty: !slot.value })),
      luckLabel: game.i18n.format("PARADIGMENGINE.Stage.LuckDie", { n: system.luckDie ?? 6 }),
      invoked: (system.bonds ?? []).some(b => b.invoked),
      hand: hands.has(actor.id),
      owner: actor.isOwner
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    el.classList.toggle("encounter", context.encounter);
    el.classList.toggle("clashing", !!context.clash);
    el.classList.toggle("strip-open", game.settings.get("paradigm-engine", STRIP) === "open");
    layout();
    if (context.gm) {
      const facing = el.querySelector(".facing");
      new foundry.applications.ux.DragDrop.implementation({
        dropSelector: ".facing",
        callbacks: {
          dragover: () => facing?.classList.add("dragover"),
          drop: event => {
            facing?.classList.remove("dragover");
            return this.#onDrop(event);
          }
        }
      }).bind(el);
      facing?.addEventListener("dragleave", () => facing.classList.remove("dragover"));
    }
  }

  /* An NPC dropped on the facing plates joins them; dropped again it
     stands twice, the copies lettered A, B, C. */
  async #onDrop(event) {
    if (!game.user.isGM) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data.type !== "Actor") return;
    const actor = await Actor.implementation.fromDropData(data);
    if (!actor || actor.type !== "npc") return;
    const stage = readStage();
    stage.facing.push({ uuid: data.uuid ?? actor.uuid, hearts: false, veiled: false });
    await writeStage(stage);
  }

  static async #onEditEpisode() {
    if (!game.user.isGM) return;
    const stage = readStage();
    const t = key => game.i18n.localize(`PARADIGMENGINE.Stage.${key}`);
    const num = (name, value, label) => `<div class="form-group"><label>${label}</label><div class="form-fields"><input type="number" name="${name}" value="${value || ""}" min="0" step="1"></div></div>`;
    const txt = (name, value, label) => `<div class="form-group"><label>${label}</label><div class="form-fields"><input type="text" name="${name}" value="${foundry.utils.escapeHTML(value)}"></div></div>`;
    const content = [
      num("season", stage.season, t("SeasonNo")),
      num("arc", stage.arc, t("ArcNo")),
      num("episode", stage.episode, t("EpisodeNo")),
      txt("title", stage.title, t("EpisodeTitle")),
      txt("scene", stage.scene, t("Scene")),
      txt("time", stage.time, t("Time"))
    ].join("");
    const read = button => ({ ...new foundry.applications.ux.FormDataExtended(button.form).object });
    const result = await DialogV2.input({
      window: { title: t("Edit") },
      classes: ["paradigm-engine", "pe-stage-dialog"],
      content,
      ok: { label: t("Save"), icon: "fa-solid fa-check" },
      buttons: [{ action: "play", label: t("SaveAndPlay"), icon: "fa-solid fa-clapperboard", callback: (event, button) => ({ ...read(button), play: true }) }],
      rejectClose: false
    });
    if (!result || typeof result !== "object") return;
    const next = {
      ...stage,
      season: result.season,
      arc: result.arc,
      episode: result.episode,
      title: result.title,
      scene: result.scene,
      time: result.time,
      card: result.play ? Date.now() : stage.card
    };
    await writeStage(next);
  }

  static #onOpenActor(event, target) {
    const actor = actorAt(target.dataset.uuid ?? "");
    if (actor?.testUserPermission(game.user, "LIMITED")) actor.sheet.render(true);
  }

  static async #onSetPip(event, target) {
    const actor = actorAt(target.closest("[data-uuid]")?.dataset.uuid ?? "");
    if (!actor?.isOwner) return;
    const kind = target.dataset.kind;
    if (kind !== "hearts" && kind !== "energy") return;
    const i = Number(target.dataset.i);
    const current = actor.system[kind].value;
    await actor.update({ [`system.${kind}.value`]: i + 1 === current ? i : i + 1 });
  }

  static async #onToggleHearts(event, target) {
    if (!game.user.isGM) return;
    const stage = readStage();
    const entry = stage.facing[Number(target.dataset.index)];
    if (!entry) return;
    entry.hearts = !entry.hearts;
    await writeStage(stage);
  }

  static async #onToggleVeil(event, target) {
    if (!game.user.isGM) return;
    const stage = readStage();
    const entry = stage.facing[Number(target.dataset.index)];
    if (!entry) return;
    entry.veiled = !entry.veiled;
    await writeStage(stage);
  }

  static async #onRemoveFacing(event, target) {
    if (!game.user.isGM) return;
    const stage = readStage();
    const i = Number(target.dataset.index);
    if (!(i in stage.facing)) return;
    stage.facing.splice(i, 1);
    await writeStage(stage);
  }

  static #onOpenClash() {
    ClashWindow.open();
  }
}

/* The edges the overlay keeps clear of: the scene controls and the
   scene tabs at the top left (the plates stack under the tabs' row, which
   the stylesheet lays side by side), the players list at the bottom
   left, the hotbar at the bottom. Measured, so a hidden hotbar or a longer
   players list moves things along. The slate and the Clash strip sit on
   the window's centre line, as the hotbar does, so the sidebar never
   shifts them. */
function layout() {
  const rect = id => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };
  const controls = rect("scene-controls");
  const tabs = ["scene-navigation-viewed", "scene-navigation-active", "scene-navigation-inactive"].map(rect).filter(Boolean);
  const players = rect("players");
  const hotbar = rect("hotbar");
  watchPlayers();
  const style = document.documentElement.style;
  style.setProperty("--pe-stage-left", `${Math.round((controls?.right ?? 0) + EDGE)}px`);
  style.setProperty("--pe-stage-foot-left", `${Math.round(players?.left ?? EDGE)}px`);
  style.setProperty("--pe-stage-foot", `${Math.round((players ? window.innerHeight - players.top : 0) + EDGE)}px`);
  style.setProperty("--pe-stage-top", `${Math.round(Math.max(controls?.top ?? 0, ...tabs.map(r => r.bottom)) + EDGE)}px`);
  style.setProperty("--pe-stage-bottom", `${Math.round((hotbar ? window.innerHeight - hotbar.top : 0) + EDGE)}px`);
}

/* The players list grows under the pointer and with the users online;
   the strip above it follows. */
let playersWatched = null;
function watchPlayers() {
  const el = document.getElementById("players");
  if (!el || el === playersWatched || !("ResizeObserver" in window)) return;
  playersWatched = el;
  new ResizeObserver(() => { if (StageOverlay.instance?.rendered) layout(); }).observe(el);
}

/* The title card: a paper band sweeps across, the episode's number and
   title on it, a glow behind, petals falling; then it slides away. */
function playCard(stage) {
  document.querySelector(".pe-stage-card")?.remove();
  const eyebrow = eyebrowOf(stage);
  if (!eyebrow && !stage.title) return;
  const el = document.createElement("div");
  el.className = "pe-stage-card";
  const make = (cls, text) => {
    const node = document.createElement("div");
    node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const txt = make("txt");
  if (eyebrow) txt.appendChild(make("no", eyebrow));
  if (stage.title) txt.appendChild(make("ttl", stage.title));
  el.append(make("glow"), make("band"), txt);
  for (const [x, delay] of PETALS) {
    const petal = document.createElement("i");
    petal.className = "petal";
    petal.style.setProperty("--x", `${x}%`);
    petal.style.setProperty("--d", `${delay}s`);
    el.appendChild(petal);
  }
  const close = () => el.remove();
  el.addEventListener("click", close);
  setTimeout(close, CARD_MS);
  document.body.appendChild(el);
}

export function registerStage() {
  let lastCard = 0;

  game.settings.register("paradigm-engine", SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: emptyStage(),
    onChange: value => {
      const card = Number(value?.card) || 0;
      if (card > lastCard) playCard(readStage());
      lastCard = card;
      StageOverlay.refresh();
    }
  });
  game.settings.register("paradigm-engine", SHOW, {
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => StageOverlay.sync()
  });
  game.settings.register("paradigm-engine", STRIP, {
    name: "PARADIGMENGINE.Settings.Stage.StripName",
    scope: "client",
    config: true,
    type: String,
    choices: {
      idle: "PARADIGMENGINE.Settings.Stage.Idle",
      open: "PARADIGMENGINE.Settings.Stage.Open"
    },
    default: "idle",
    onChange: () => StageOverlay.refresh()
  });

  Hooks.once("ready", () => {
    lastCard = readStage().card;
    StageOverlay.sync();
  });

  /* What the overlay reads. */
  const actorHook = actor => {
    if (actor.type === "pc" || actor.type === "npc") StageOverlay.refresh();
  };
  Hooks.on("createActor", actorHook);
  Hooks.on("updateActor", actorHook);
  Hooks.on("deleteActor", actorHook);
  for (const hook of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) {
    Hooks.on(hook, () => StageOverlay.refresh());
  }
  Hooks.on("updateSetting", setting => {
    if (setting.key === "paradigm-engine.clash") StageOverlay.refresh();
  });
  Hooks.on("canvasReady", () => StageOverlay.refresh());

  /* The edges it keeps clear of. */
  const relayout = () => { if (StageOverlay.instance?.rendered) layout(); };
  for (const hook of ["renderSceneControls", "renderSceneNavigation", "renderHotbar", "renderPlayers", "canvasReady"]) Hooks.on(hook, relayout);
  window.addEventListener("resize", foundry.utils.debounce(relayout, 100));

  /* The Stage tool in the Token controls: a toggle, per user. */
  Hooks.on("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if (!tokens) return;
    tokens.tools.stage = {
      name: "stage",
      title: "PARADIGMENGINE.Stage.Title",
      icon: "fa-solid fa-clapperboard",
      order: 101,
      toggle: true,
      active: shown(),
      onChange: (event, active) => game.settings.set("paradigm-engine", SHOW, !!active)
    };
  });
}
