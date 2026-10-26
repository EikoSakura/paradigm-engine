import { DIFFICULTY } from "../config.mjs";
import { multiRow, postMultiCard } from "../chat.mjs";
import { partyMembers, partyOf } from "../party.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* The setup window an Opposed Action or a Group Action opens before its
   shared card posts. The starter heads the list: for an Opposed Action
   the rows seed from the user's targets, for a Group Action from the
   starter's Party, who leads. Characters are dragged in from the Actors
   directory, a folder as one drop, or added from the controlled tokens;
   a cross removes one. A Group Action picks its Difficulty here. Begin
   posts the card. */
export default class ActionSetup extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, kind, rows, ...options } = {}) {
    super(options);
    this.#actor = actor;
    this.#kind = kind;
    this.#rows = rows;
  }

  static DEFAULT_OPTIONS = {
    classes: ["paradigm-engine", "action-setup"],
    position: { width: 340, height: "auto" },
    actions: {
      remove: this.#onRemove,
      addSelected: this.#onAddSelected,
      difficulty: this.#onDifficulty,
      begin: this.#onBegin
    }
  };

  static PARTS = {
    body: { template: "systems/paradigm-engine/templates/apps/action-setup.hbs" }
  };

  static #instance = null;

  #actor;

  #kind;

  #rows;

  #difficulty = null;

  #dragListeners = false;

  /* Open for this actor: an Opposed Action seeded from the user's
     targets, a Group Action from the actor's Party. */
  static open(actor, kind) {
    const others = kind === "group"
      ? (partyOf(actor) ? partyMembers(partyOf(actor)) : [])
      : [...game.user.targets].map(t => t.actor).filter(Boolean);
    const rows = [multiRow(actor, kind === "group")];
    for (const other of others) addRow(rows, other);
    this.#instance?.close();
    this.#instance = new this({ actor, kind, rows });
    this.#instance.render(true);
  }

  get title() {
    return game.i18n.localize(this.#kind === "group" ? "PARADIGMENGINE.Check.Group" : "PARADIGMENGINE.Check.Opposed");
  }

  get #ready() {
    if (this.#kind === "group") return this.#difficulty !== null;
    return this.#rows.length > 1;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const group = this.#kind === "group";
    context.group = group;
    context.title = this.title;
    context.rows = this.#rows.map((row, index) => ({
      ...row,
      index,
      chip: index ? "" : game.i18n.localize(group ? "PARADIGMENGINE.Check.Leader" : "PARADIGMENGINE.Check.Starter")
    }));
    if (group) context.difficulties = DIFFICULTY.map((d, index) => ({ ...d, index, selected: this.#difficulty === index }));
    context.ready = this.#ready;
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".asetup",
      permissions: { drop: () => true },
      callbacks: {
        dragover: () => this.element.classList.add("dragover"),
        drop: this.#onDrop.bind(this)
      }
    }).bind(this.element);
    if (!this.#dragListeners) {
      this.#dragListeners = true;
      const clear = () => this.element.classList.remove("dragover");
      this.element.addEventListener("drop", clear);
      this.element.addEventListener("dragleave", event => {
        if (!this.element.contains(event.relatedTarget)) clear();
      });
    }
  }

  close(options = {}) {
    return super.close({ animate: false, ...options });
  }

  _onClose(options) {
    super._onClose(options);
    if (ActionSetup.#instance === this) ActionSetup.#instance = null;
  }

  /* An Actor dropped joins the list; a folder brings every Actor in it. */
  async #onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    let actors = [];
    if (data.type === "Actor") {
      const actor = await Actor.implementation.fromDropData(data);
      if (actor) actors = [actor];
    } else if (data.type === "Folder") {
      const folder = await fromUuid(data.uuid);
      if (folder?.type === "Actor") {
        actors = [...folder.contents];
        for (const sub of folder.getSubfolders(true)) actors.push(...sub.contents);
      }
    }
    let changed = false;
    for (const actor of actors) if (addRow(this.#rows, actor)) changed = true;
    if (changed) this.render();
  }

  static #onRemove(event, target) {
    const index = Number(target.dataset.index);
    if (index < 1) return;
    this.#rows.splice(index, 1);
    this.render();
  }

  /* The controlled tokens' actors join the list. */
  static #onAddSelected() {
    let changed = false;
    for (const token of canvas.tokens?.controlled ?? []) {
      if (token.actor && addRow(this.#rows, token.actor)) changed = true;
    }
    if (changed) this.render();
  }

  static #onDifficulty(event, target) {
    const index = Number(target.dataset.index);
    this.#difficulty = this.#difficulty === index ? null : index;
    this.render();
  }

  static async #onBegin() {
    if (!this.#ready) return;
    await postMultiCard(this.#actor, this.#kind, this.#rows, this.#difficulty);
    this.close();
  }
}

/* A row for this actor, unless the list already holds it. */
function addRow(rows, actor) {
  if (!actor || !["pc", "npc"].includes(actor.type) || rows.some(r => r.uuid === actor.uuid)) return false;
  rows.push(multiRow(actor));
  return true;
}
