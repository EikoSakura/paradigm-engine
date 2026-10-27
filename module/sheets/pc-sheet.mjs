import BaseActorSheet from "./base-actor-sheet.mjs";
import { LADDER } from "../config.mjs";
import PcCreator from "../apps/pc-creator.mjs";
import RollDialog from "../apps/roll-dialog.mjs";
import { postBondCard, showRoll } from "../chat.mjs";

/* The Profile tab's Identity cells and prose cards, each card with its tag color. */
const PROFILE_IDENTITY = {
  player: "PARADIGMENGINE.Header.Player",
  age: "PARADIGMENGINE.Header.Age",
  gender: "PARADIGMENGINE.Profile.Gender",
  pronouns: "PARADIGMENGINE.Profile.Pronouns"
};
const PROFILE_TEXT = { personality: "--pink", history: "--blue", notes: "--green" };

export default class PcSheet extends BaseActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ["pc"],
    position: { width: 920, height: 760 },
    actions: {
      addBond: this.#onAddBond,
      deleteBond: this.#onDeleteBond,
      invoke: this.#onInvoke,
      benefit: this.#onBenefit,
      clearInvoked: this.#onClearInvoked,
      luckPick: this.#onLuckPick,
      openCreator: this.#onOpenCreator
    }
  };

  /* The Bond whose Invoke popover is open, or null. Display state only. */
  #invokeOpen = null;

  /* The Luck benefit's rolled die waiting for a slot, or null. */
  #luckPick = null;

  #onDocumentPointerDown = this.#closePopoverOnOutside.bind(this);

  static PARTS = {
    header: { template: "systems/paradigm-engine/templates/actor/header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    main: { template: "systems/paradigm-engine/templates/actor/main.hbs" },
    growth: { template: "systems/paradigm-engine/templates/actor/growth.hbs" },
    profile: { template: "systems/paradigm-engine/templates/actor/profile.hbs" }
  };

  static TABS = {
    primary: {
      tabs: [{ id: "main" }, { id: "growth" }, { id: "profile" }],
      initial: "main",
      labelPrefix: "PARADIGMENGINE.Tab"
    }
  };

  static FORM_ARRAYS = ["bonds", "luck"];

  /* The PC Creator button in the title bar, beside the mode toggle. */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    if (this.isEditable) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "creatorbtn";
      button.dataset.action = "openCreator";
      button.dataset.tooltip = "PARADIGMENGINE.Creator.Title";
      button.setAttribute("aria-label", game.i18n.localize("PARADIGMENGINE.Creator.Title"));
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-user-plus";
      icon.inert = true;
      button.append(icon);
      this.window.title.after(button);
    }
    return frame;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.rankBadge = this._badge("rank", system.rank, "difficulty");
    const canInvoke = this.isEditable && !this.isEditMode;
    /* The turn benefit needs a Bond within another PC: one whose name is a PC's name. */
    const pcNames = new Set(game.actors.filter(a => a.type === "pc" && a !== this.document).map(a => a.name.trim().toLowerCase()));
    const canSync = system.energy.value >= 1;
    context.bonds = system.bonds.map((bond, i) => ({
      ...bond,
      badge: this._badge(`bond.${i}`, bond.rank),
      die: LADDER[bond.rank].die,
      canInvoke: canInvoke && !bond.invoked,
      canSync: canSync && pcNames.has((bond.name ?? "").trim().toLowerCase()),
      open: canInvoke && this.#invokeOpen === i
    }));
    context.luckPick = canInvoke ? this.#luckPick : null;
    if (context.luckPick !== null) context.luckPickLabel = game.i18n.format("PARADIGMENGINE.Bond.Record", { value: context.luckPick });
    context.bondRanks = Object.fromEntries(LADDER.map((step, i) => [i, step.rank]));
    Object.assign(context, await this.#prepareProfile());
    return context;
  }

  /* ----- Profile ----- */

  async #prepareProfile() {
    const actor = this.document;
    const system = actor.system;
    const identity = Object.entries(PROFILE_IDENTITY).map(([key, label]) => ({
      key, value: system[key], label: game.i18n.localize(label)
    }));
    const profile = {};
    for (const [key, tc] of Object.entries(PROFILE_TEXT)) {
      profile[key] = {
        key, tc,
        label: game.i18n.localize(`PARADIGMENGINE.Profile.${key[0].toUpperCase()}${key.slice(1)}`),
        raw: system[key],
        html: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system[key], {
          relativeTo: actor,
          secrets: actor.isOwner
        })
      };
    }
    return { identity, profile };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this.#invokeOpen !== null) document.addEventListener("pointerdown", this.#onDocumentPointerDown, true);
    else document.removeEventListener("pointerdown", this.#onDocumentPointerDown, true);
    this.#placePopover();
  }

  /* The tab clips its overflow, so the popover hangs under its row when
     that fits inside the tab and flips above it otherwise. */
  #placePopover() {
    const popover = this.element?.querySelector(".bpop");
    if (!popover) return;
    const clip = popover.closest("section.tab")?.getBoundingClientRect();
    if (!clip) return;
    popover.classList.remove("up");
    const rect = popover.getBoundingClientRect();
    if (rect.bottom <= clip.bottom) return;
    const row = popover.parentElement.getBoundingClientRect();
    if (row.top - rect.height - 9 >= clip.top || row.top - clip.top > clip.bottom - row.bottom) popover.classList.add("up");
  }

  _onClose(options) {
    super._onClose(options);
    document.removeEventListener("pointerdown", this.#onDocumentPointerDown, true);
    this.#invokeOpen = null;
    this.#luckPick = null;
  }

  /* Closing pulls the popover out of the page at once instead of waiting
     on a re-render of the whole sheet. */
  #closePopoverOnOutside(event) {
    const popover = this.element?.querySelector(".bpop");
    if (!popover || popover.contains(event.target) || event.target.closest?.("[data-action=invoke]")) return;
    this.#closePopover();
  }

  #closePopover() {
    this.#invokeOpen = null;
    document.removeEventListener("pointerdown", this.#onDocumentPointerDown, true);
    const popover = this.element?.querySelector(".bpop");
    if (!popover) return;
    const button = popover.parentElement.querySelector("[data-action=invoke]");
    button?.classList.remove("sel");
    button?.setAttribute("aria-expanded", "false");
    popover.remove();
  }

  /* ----- Invoking Bonds ----- */

  static #onInvoke(event, target) {
    if (!this.isEditable) return;
    const i = Number(target.dataset.i);
    if (this.#invokeOpen === i) return this.#closePopover();
    this.#invokeOpen = i;
    this.render({ parts: ["main"] });
  }

  /* Mark the Bond invoked for the scene and return it, or null. */
  async #spendBond(i) {
    const bonds = this.document.system.toObject().bonds;
    const bond = bonds[i];
    if (!bond || bond.invoked) return null;
    bond.invoked = true;
    await this.document.update({ "system.bonds": bonds });
    return bond;
  }

  static async #onBenefit(event, target) {
    if (!this.isEditable) return;
    const i = Number(target.dataset.i);
    const benefit = target.dataset.benefit;
    const anchor = this.element.querySelector(`.brow[data-i="${i}"]`) ?? target;
    this.#closePopover();
    if (benefit === "turn") {
      const energy = this.document.system.energy.value;
      if (energy < 1) return;
      const bond = await this.#spendBond(i);
      if (!bond) return;
      await this.document.update({ "system.energy.value": energy - 1 });
      return postBondCard(this.document, bond, game.i18n.localize("PARADIGMENGINE.Chat.TurnEnergy"));
    }
    if (benefit === "luck") {
      const bond = await this.#spendBond(i);
      if (!bond) return;
      const die = this.document.system.luckDie;
      const roll = await new foundry.dice.Roll(`1d${die}`).evaluate();
      await showRoll(roll);
      this.#luckPick = roll.total;
      this.render();
      return postBondCard(this.document, bond,
        game.i18n.format("PARADIGMENGINE.Chat.LuckRoll", { die: `d${die}`, value: roll.total }));
    }
    const bond = await this.#spendBond(i);
    if (!bond) return;
    await postBondCard(this.document, bond,
      game.i18n.format("PARADIGMENGINE.Chat.BorrowDie", { die: LADDER[bond.rank].die }));
    RollDialog.open(this.document, { kind: "bond", index: i }, anchor, { tag: game.i18n.localize("PARADIGMENGINE.Bond.Title") });
  }

  static async #onClearInvoked(event, target) {
    if (!this.isEditable) return;
    const bonds = this.document.system.toObject().bonds;
    const bond = bonds[Number(target.dataset.i)];
    if (!bond) return;
    bond.invoked = false;
    await this.document.update({ "system.bonds": bonds });
  }

  /* The Luck benefit: the rolled die is recorded over the clicked slot, spent
     or not, which stands ready; the pick ends and the Luck values post. */
  static async #onLuckPick(event, target) {
    if (!this.isEditable || this.#luckPick === null) return;
    const luck = this.document.system.toObject().luck;
    const slot = luck[Number(target.dataset.i)];
    if (!slot) return;
    Object.assign(slot, { value: this.#luckPick, spent: false });
    this.#luckPick = null;
    await this.document.update({ "system.luck": luck });
    const values = this.document.system.luck.map(slot => (slot.spent ? "\u2014" : String(slot.value))).join(" \u00b7 ");
    const line = foundry.utils.escapeHTML(game.i18n.format("PARADIGMENGINE.Chat.LuckNow", { values }));
    await ChatMessage.implementation.create({
      content: `<div class="pe-card"><div class="cbody"><div class="rline"><span class="rmark">\u25c6</span><span>${line}</span></div></div></div>`,
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.document })
    });
  }

  static async #onAddBond() {
    if (!this.isEditable) return;
    const bonds = this.document.system.toObject().bonds;
    bonds.push({ name: "", rank: 0, invoked: false });
    await this.document.update({ "system.bonds": bonds });
  }

  static async #onDeleteBond(event, target) {
    if (!this.isEditable) return;
    const bonds = this.document.system.toObject().bonds;
    bonds.splice(Number(target.dataset.i), 1);
    await this.document.update({ "system.bonds": bonds });
  }

  static #onOpenCreator() {
    if (!this.isEditable) return;
    PcCreator.open(this.document);
  }
}
