/* The Clash: an extended contest between two to eight sides, each one or
   more characters. One Clash at a time, held in a world setting so every
   client sees the same state. The Storyteller builds the sides — actors
   dragged in from the Actors directory, a folder dropped in as one group,
   the controlled tokens added in one press — sets the target, and presses
   Begin; every success marks one box on that side's arm, and the first arm
   filled wins. Each character on every other side loses Hearts equal to
   the winner's marks minus its side's own, read off the window and the chat
   card, applied at the table. The window opens on every client when a
   Clash begins, and one live chat card follows the Clash from Begin to its
   end: every mark shows on it, each member rolls from it, and it turns
   into the result when a side wins. */

import { isSuccess, renderRollCard } from "../chat.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

const SETTING = "clash";
const QUERY = "paradigm-engine.showClash";
const TARGET_MIN = 1;
const TARGET_MAX = 6;
const SIDES_MAX = 8;
const FAN_MAX = 3;

/* Arena geometry, in SVG units. */
const SIZE = 360;
const CENTER = SIZE / 2;
const CORE = 9;
const PORTRAIT = 20;
const PORTRAIT_SMALL = 16;
const FAN_STEP = 13;
const PORTRAIT_R = CENTER - PORTRAIT - 6;
const FIRST_BOX = 40;
const BOX_MAX = 18;
const GAP_MAX = 28;

function emptyState() {
  return { target: 3, started: false, sides: [], messageId: "" };
}

function cleanMember(m) {
  if (!m || typeof m !== "object") return null;
  const key = m.key ?? m.uuid ?? "";
  if (!key) return null;
  return { key, uuid: m.uuid ?? key, name: m.name ?? "", img: m.img ?? "" };
}

/* A side's shown name: its own, or the first member's with a count. */
export function sideName(side) {
  if (side.name) return side.name;
  const first = side.members[0]?.name ?? "";
  return side.members.length > 1 ? `${first} +${side.members.length - 1}` : first;
}

export function readClash() {
  const stored = game.settings.get("paradigm-engine", SETTING);
  const state = emptyState();
  if (Number.isInteger(stored?.target)) state.target = Math.clamp(stored.target, TARGET_MIN, TARGET_MAX);
  state.started = !!stored?.started;
  state.messageId = typeof stored?.messageId === "string" ? stored.messageId : "";
  const sides = Array.isArray(stored?.sides) ? stored.sides : [];
  for (const s of sides.slice(0, SIDES_MAX)) {
    const members = (Array.isArray(s.members) ? s.members : [s]).map(cleanMember).filter(Boolean);
    if (!members.length) continue;
    state.sides.push({ name: typeof s.name === "string" && Array.isArray(s.members) ? s.name : "", members, marks: Math.max(0, s.marks | 0) });
  }
  return state;
}

function writeClash(state) {
  return game.settings.set("paradigm-engine", SETTING, state);
}

/* Index of the first side at the target, or -1. */
export function clashWinner(state) {
  return state.sides.findIndex(s => s.marks >= state.target);
}

/* Each side's result line: Wins for the winner, the Hearts loss for the
   rest, or null while the Clash runs. */
function sideResults(state) {
  const winner = clashWinner(state);
  return state.sides.map((side, i) => {
    if (winner < 0) return null;
    if (i === winner) return game.i18n.localize("PARADIGMENGINE.Clash.Wins");
    const n = state.sides[winner].marks - side.marks;
    return game.i18n.format(n === 1 ? "PARADIGMENGINE.Clash.HeartLoss" : "PARADIGMENGINE.Clash.HeartsLoss", { n });
  });
}

/* The side a running Clash holds this actor on, or null: its index, name,
   marks, and the target. */
export function clashSideOf(actor) {
  const state = readClash();
  if (!state.started || clashWinner(state) >= 0) return null;
  const index = state.sides.findIndex(s => s.members.some(m => m.uuid === actor.uuid));
  if (index < 0) return null;
  const side = state.sides[index];
  return { index, name: sideName(side), marks: side.marks, target: state.target };
}

/* Members already in the Clash, by key. */
function memberKeys(state) {
  return new Set(state.sides.flatMap(s => s.members.map(m => m.key)));
}

/* New members join side `into`, or form a new side when it is -1 and
   there is room. Members already present are skipped. */
function addMembers(state, members, into = -1) {
  const keys = memberKeys(state);
  const fresh = members.filter(m => m && !keys.has(m.key) && keys.add(m.key));
  if (!fresh.length) return false;
  if (into >= 0 && state.sides[into]) state.sides[into].members.push(...fresh);
  else if (state.sides.length < SIDES_MAX) state.sides.push({ name: "", members: fresh, marks: 0 });
  else return false;
  return true;
}

function memberFromActor(actor, key = actor.uuid) {
  return { key, uuid: actor.uuid, name: actor.name, img: actor.img };
}

function memberFromToken(token) {
  return { key: token.document.uuid, uuid: token.actor?.uuid ?? "", name: token.name, img: token.document.texture.src || token.actor?.img || "" };
}

/* Every Actor in a folder and its subfolders. */
function folderActors(folder) {
  const out = [...folder.contents];
  for (const sub of folder.getSubfolders(true)) out.push(...sub.contents);
  return out.filter(a => a instanceof Actor);
}

export default class ClashWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "clash",
    classes: ["paradigm-engine", "clash"],
    window: { resizable: false },
    position: { width: 480, height: "auto" },
    actions: {
      mark: this.#onMark,
      removeSide: this.#onRemoveSide,
      rename: this.#onRename,
      addSelected: this.#onAddSelected,
      show: this.#onShow,
      targetUp: this.#onTargetUp,
      targetDown: this.#onTargetDown,
      begin: this.#onBegin,
      end: this.#onEnd
    }
  };

  static PARTS = {
    main: { template: "systems/paradigm-engine/templates/apps/clash.hbs" }
  };

  static #instance = null;

  static get instance() {
    return ClashWindow.#instance;
  }

  static open() {
    ClashWindow.#instance ??= new ClashWindow();
    ClashWindow.#instance.render({ force: true });
    return ClashWindow.#instance;
  }

  get title() {
    return game.i18n.localize("PARADIGMENGINE.Clash.Title");
  }

  get canEdit() {
    return game.user.isGM;
  }

  #dragListeners = false;

  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.canEdit) return;
    new foundry.applications.ux.DragDrop.implementation({
      dragSelector: ".side[draggable]",
      dropSelector: ".clash-body",
      permissions: { dragstart: () => this.canEdit, drop: () => this.canEdit },
      callbacks: {
        dragstart: this.#onDragStart.bind(this),
        dragover: this.#onDragOver.bind(this),
        drop: this.#onDrop.bind(this)
      }
    }).bind(this.element);
    if (!this.#dragListeners) {
      this.#dragListeners = true;
      const clear = () => this.#clearDragover();
      this.element.addEventListener("dragend", clear);
      this.element.addEventListener("drop", clear);
      this.element.addEventListener("dragleave", event => {
        if (!this.element.contains(event.relatedTarget)) clear();
      });
    }
  }

  _onClose(options) {
    super._onClose(options);
    if (ClashWindow.#instance === this) ClashWindow.#instance = null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = readClash();
    const winner = clashWinner(state);
    const results = sideResults(state);
    const setup = this.canEdit && !state.started;
    Object.assign(context, {
      size: SIZE,
      core: { x: CENTER - CORE, y: CENTER - CORE, size: CORE * 2, rotate: `rotate(45 ${CENTER} ${CENTER})` },
      portrait: PORTRAIT,
      portraitSize: PORTRAIT * 2,
      portraitSmall: PORTRAIT_SMALL,
      portraitSmallSize: PORTRAIT_SMALL * 2,
      arms: this.#arms(state),
      target: state.target,
      started: state.started,
      empty: state.sides.length === 0,
      canEdit: this.canEdit,
      canSetup: setup,
      canMark: this.canEdit && state.started && winner < 0,
      canEnd: this.canEdit && state.started,
      ready: setup && state.sides.length >= 2,
      targetMin: state.target <= TARGET_MIN,
      targetMax: state.target >= TARGET_MAX,
      winner: winner >= 0 ? { name: sideName(state.sides[winner]) } : null,
      sides: state.sides.map((side, i) => ({
        index: i,
        name: sideName(side),
        marks: side.marks,
        portraits: side.members.slice(0, FAN_MAX).map(m => m.img),
        extra: Math.max(0, side.members.length - FAN_MAX),
        roster: side.members.map(m => m.name).join(", "),
        grouped: side.members.length > 1,
        won: i === winner,
        lost: winner >= 0 && i !== winner,
        result: results[i]
      }))
    });
    return context;
  }

  /* One arm per side, from the diamond outward: even counts start at the
     left so two sides make a line, odd counts start at the top. Box pitch
     shrinks so the portraits always sit inside the arena. A side's
     members fan across the arm at its tip, up to three, the rest a
     count. */
  #arms(state) {
    const n = state.sides.length;
    if (!n) return [];
    const start = n % 2 === 0 ? 180 : 270;
    const step = 360 / n;
    const T = state.target;
    const lastBox = PORTRAIT_R - PORTRAIT - 10;
    const gap = T > 1 ? Math.min(GAP_MAX, (lastBox - FIRST_BOX) / (T - 1)) : 0;
    const box = T > 1 ? Math.min(BOX_MAX, Math.max(8, gap - 6)) : BOX_MAX;
    const winner = clashWinner(state);
    return state.sides.map((side, k) => {
      const a = (start + k * step) * Math.PI / 180;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      const boxes = [];
      for (let i = 0; i < T; i++) {
        const r = FIRST_BOX + i * gap;
        boxes.push({
          side: k,
          index: i,
          x: CENTER + cx * r - box / 2,
          y: CENTER + cy * r - box / 2,
          size: box,
          on: i < side.marks
        });
      }
      const shown = side.members.slice(0, FAN_MAX);
      const small = shown.length > 1;
      const half = PORTRAIT_SMALL;
      const portraits = shown.map((m, i) => {
        const offset = (i - (shown.length - 1) / 2) * FAN_STEP;
        return { img: m.img, x: -cy * offset, y: cx * offset, small, half: small ? half : PORTRAIT, size: small ? half * 2 : PORTRAIT * 2 };
      });
      const extra = side.members.length - shown.length;
      const badgeOffset = ((shown.length - 1) / 2) * FAN_STEP + half + 4;
      return {
        side: k,
        boxes,
        portraits,
        badge: extra > 0 ? { text: `+${extra}`, x: -cy * badgeOffset, y: cx * badgeOffset } : null,
        px: CENTER + cx * PORTRAIT_R,
        py: CENTER + cy * PORTRAIT_R,
        won: k === winner,
        lost: winner >= 0 && k !== winner
      };
    });
  }

  /* The side under a drag, by its chip or its portraits, or -1. */
  #sideAt(event) {
    const el = event.target.closest?.("[data-side]");
    return el ? Number(el.dataset.side) : -1;
  }

  #onDragStart(event) {
    const index = Number(event.currentTarget.dataset.side);
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: "ClashSide", index }));
  }

  #onDragOver(event) {
    const index = this.#sideAt(event);
    for (const el of this.element.querySelectorAll(".dragover")) el.classList.remove("dragover");
    if (index >= 0) for (const el of this.element.querySelectorAll(`[data-side="${index}"]`)) el.classList.add("dragover");
    else this.element.querySelector(".arena")?.classList.add("dragover");
  }

  #clearDragover() {
    for (const el of this.element.querySelectorAll(".dragover")) el.classList.remove("dragover");
  }

  /* An actor dropped on open ground forms a side, dropped on a side joins
     it; a folder arrives as one group; a side dropped on another merges
     into it. Setup only. */
  async #onDrop(event) {
    if (!this.canEdit) return;
    const state = readClash();
    if (state.started) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const into = this.#sideAt(event);
    if (data.type === "ClashSide") {
      const from = Number(data.index);
      if (!(from in state.sides) || into < 0 || into === from) return;
      const name = state.sides[into].name || state.sides[from].name;
      state.sides[into].members.push(...state.sides[from].members);
      state.sides[into].name = name;
      state.sides.splice(from, 1);
      return writeClash(state);
    }
    const members = await this.#membersFrom(data);
    if (addMembers(state, members, into)) await writeClash(state);
  }

  async #membersFrom(data) {
    if (data.type === "Actor") {
      const actor = await Actor.implementation.fromDropData(data);
      return actor ? [memberFromActor(actor, data.uuid ?? actor.uuid)] : [];
    }
    if (data.type === "Folder") {
      const folder = await fromUuid(data.uuid);
      return folder?.type === "Actor" ? folderActors(folder).map(a => memberFromActor(a)) : [];
    }
    return [];
  }

  /* Show opens the window on every other connected client. */
  static async #onShow() {
    if (!this.canEdit) return;
    const others = game.users.filter(u => u.active && !u.isSelf);
    await Promise.allSettled(others.map(u => u.query(QUERY, {})));
  }

  /* The controlled tokens, one side each. */
  static async #onAddSelected() {
    if (!this.canEdit) return;
    const state = readClash();
    if (state.started) return;
    let changed = false;
    for (const token of canvas.tokens?.controlled ?? []) {
      if (addMembers(state, [memberFromToken(token)])) changed = true;
    }
    if (changed) await writeClash(state);
  }

  /* A click on box i marks through it, or unmarks from it when it is
     already marked. The click that fills the first arm posts the card. */
  static async #onMark(event, target) {
    if (!this.canEdit) return;
    const state = readClash();
    if (!state.started || clashWinner(state) >= 0) return;
    const side = state.sides[Number(target.dataset.side)];
    if (!side) return;
    const i = Number(target.dataset.box);
    side.marks = i < side.marks ? i : Math.min(i + 1, state.target);
    await writeClash(state);
  }

  static async #onRemoveSide(event, target) {
    if (!this.canEdit) return;
    const state = readClash();
    if (state.started) return;
    state.sides.splice(Number(target.dataset.side), 1);
    await writeClash(state);
  }

  /* The name on a chip edits in place: Enter or leaving commits, Escape
     cancels, an emptied name goes back to the members' own. */
  static #onRename(event, target) {
    if (!this.canEdit) return;
    const index = Number(target.dataset.side);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "sname editing";
    input.value = readClash().sides[index]?.name ?? "";
    input.placeholder = target.textContent;
    input.draggable = true;
    input.addEventListener("dragstart", e => e.preventDefault());
    let done = false;
    const finish = async commit => {
      if (done) return;
      done = true;
      if (commit) {
        const state = readClash();
        if (state.sides[index] && !state.started) {
          state.sides[index].name = input.value.trim();
          await writeClash(state);
        }
      }
      this.render();
    };
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    target.replaceWith(input);
    input.focus();
    input.select();
  }

  static async #onTargetUp() {
    if (!this.canEdit) return;
    const state = readClash();
    if (state.started || state.target >= TARGET_MAX) return;
    state.target++;
    await writeClash(state);
  }

  static async #onTargetDown() {
    if (!this.canEdit) return;
    const state = readClash();
    if (state.started || state.target <= TARGET_MIN) return;
    state.target--;
    await writeClash(state);
  }

  static async #onBegin() {
    if (!this.canEdit) return;
    const state = readClash();
    if (state.started || state.sides.length < 2) return;
    for (const side of state.sides) side.marks = 0;
    state.started = true;
    const message = await postClashCard(state);
    state.messageId = message?.id ?? "";
    await writeClash(state);
  }

  /* End freezes the card as it stands, then clears the sides and keeps
     the target. */
  static async #onEnd() {
    if (!this.canEdit) return;
    const state = readClash();
    await syncClashCard(state, false);
    await writeClash({ ...emptyState(), target: state.target });
  }
}

/* The live card's context: every side with its boxes and members, the
   target while the Clash runs, the winner line and each side's result
   once a side has won. Roll buttons show while live and unresolved; the
   client showing the card keeps only the ones its user may press. */
function clashCardContext(state, live) {
  const winner = clashWinner(state);
  const results = sideResults(state);
  const running = live && winner < 0;
  return {
    live,
    running,
    target: game.i18n.format("PARADIGMENGINE.Clash.TargetChip", { n: state.target }),
    winnerLine: winner >= 0 ? `${sideName(state.sides[winner])} · ${results[winner]}` : "",
    sides: state.sides.map((side, i) => ({
      index: i,
      name: sideName(side),
      won: i === winner,
      boxes: Array.fromRange(state.target).map(b => b < side.marks),
      result: results[i],
      members: side.members.map(m => ({ uuid: m.uuid, name: m.name, img: m.img, result: side.members.length > 1 ? results[i] : "" }))
    }))
  };
}

async function renderClashCard(state, live) {
  return renderTemplate("systems/paradigm-engine/templates/chat/clash-card.hbs", clashCardContext(state, live));
}

async function postClashCard(state) {
  const content = await renderClashCard(state, true);
  return ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.implementation.getSpeaker({ alias: game.i18n.localize("PARADIGMENGINE.Clash.Title") }),
    flags: { "paradigm-engine": { clashLive: true } }
  });
}

/* Rewrite the live card from the state. Storyteller only. */
export async function syncClashCard(state, live = true) {
  const message = state.messageId ? game.messages.get(state.messageId) : null;
  if (!message || !game.user.isGM) return;
  await message.update({ content: await renderClashCard(state, live) });
}

/* A Clash roll's Success marks one box on its side, once. Runs on the
   Storyteller's client when the card arrives, and again when a Luck swap
   re-renders it, in case the swap made the Success. The card's flag keeps
   the side's marks as they stand after this roll. */
export async function applyClashMark(message) {
  if (!game.user.isGM) return;
  const flags = message.flags["paradigm-engine"] ?? {};
  const clash = flags.clash;
  const band = flags.card?.difficulty?.band;
  if (!clash || clash.marked || !isSuccess(band)) return;
  const state = readClash();
  if (!state.started || clashWinner(state) >= 0) return;
  const side = state.sides[clash.side];
  if (!side) return;
  side.marks = Math.min(side.marks + 1, state.target);
  const marked = { ...clash, marked: true, marks: side.marks, target: state.target };
  await message.update({
    content: await renderRollCard({ ...flags, clash: marked }),
    flags: { "paradigm-engine": { clash: marked } }
  });
  await writeClash(state);
}

let wasStarted = false;

export function registerClash() {
  game.settings.register("paradigm-engine", SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: emptyState(),
    onChange: value => {
      const started = !!value?.started;
      if (ClashWindow.instance) ClashWindow.instance.render();
      else if (started && !wasStarted) ClashWindow.open();
      wasStarted = started;
      if (started && game.users.activeGM?.isSelf) syncClashCard(readClash());
      for (const app of foundry.applications.instances.values()) {
        if (app.document instanceof Actor && app.options.classes.includes("paradigm-engine")) app.render();
      }
    }
  });
  Hooks.once("ready", () => {
    wasStarted = readClash().started;
  });

  /* A Clash roll that arrives while the Clash runs marks its side; one
     that a Luck swap turns into a Success marks it then. */
  const onClashRoll = message => {
    if (game.users.activeGM?.isSelf && message.getFlag("paradigm-engine", "clash")) applyClashMark(message);
  };
  Hooks.on("createChatMessage", onClashRoll);
  Hooks.on("updateChatMessage", onClashRoll);

  /* A Show from the Storyteller opens the window here. */
  CONFIG.queries[QUERY] = async (data, { user }) => {
    if (!user?.isGM) return;
    ClashWindow.open();
  };

  /* The Clash tool in the Token controls: a button, so the active layer
     and tool stay as they are. */
  Hooks.on("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if (!tokens) return;
    tokens.tools.clash = {
      name: "clash",
      title: "PARADIGMENGINE.Clash.Title",
      icon: "fa-solid fa-swords",
      order: 100,
      button: true,
      onChange: () => ClashWindow.open()
    };
  });
}
