import BaseActorSheet from "./base-actor-sheet.mjs";
import { LADDER, GROWTH_OPTIONS, GROWTH_TIERS } from "../config.mjs";
import PcCreator from "../apps/pc-creator.mjs";
import GrowthPick from "../apps/growth-pick.mjs";
import { GROWTH_GROUPS, cancelMilestone, growthCards, growthLog, spend, startMilestone, startTimeskip } from "../growth.mjs";
import RollDialog from "../apps/roll-dialog.mjs";
import { postBondCard } from "../chat.mjs";

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
      growthStart: this.#onGrowthStart,
      growthCancel: this.#onGrowthCancel,
      growthTake: this.#onGrowthTake,
      growthTsStep: this.#onGrowthTsStep,
      growthTsAccess: this.#onGrowthTsAccess,
      growthTsAward: this.#onGrowthTsAward,
      addBond: this.#onAddBond,
      deleteBond: this.#onDeleteBond,
      invoke: this.#onInvoke,
      benefit: this.#onBenefit,
      clearInvoked: this.#onClearInvoked,
      luckPick: this.#onLuckPick,
      luckDone: this.#onLuckDone,
      openCreator: this.#onOpenCreator
    }
  };

  /* The Bond whose Invoke popover is open, or null. Display state only. */
  #invokeOpen = null;

  /* Twist of Fate: while true the Luck hexes are in the pick state. */
  #luckPick = false;

  #onDocumentPointerDown = this.#closePopoverOnOutside.bind(this);

  /* The Timeskip award being set up, or null. Display state only. */
  #timeskip = null;

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
    context.bonds = system.bonds.map((bond, i) => ({
      ...bond,
      badge: this._badge(`bond.${i}`, bond.rank),
      die: LADDER[bond.rank].die,
      canInvoke: canInvoke && !bond.invoked,
      open: canInvoke && this.#invokeOpen === i
    }));
    context.canSync = system.energy.value >= 1;
    context.luckPick = this.#luckPick && canInvoke;
    if (context.luckPick) {
      context.luck = context.luck.map(slot => ({
        ...slot,
        pickLabel: game.i18n.localize(slot.spent ? "PARADIGMENGINE.Bond.Replenish" : "PARADIGMENGINE.Bond.Reroll")
      }));
    }
    context.bondRanks = Object.fromEntries(LADDER.map((step, i) => [i, step.rank]));
    Object.assign(context, this.#prepareGrowth());
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

  /* ----- Growth ----- */

  #prepareGrowth() {
    const actor = this.document;
    const milestone = actor.system.growth.milestone;
    const open = !!milestone.tier;
    const canStart = this.isEditable && !open && !this.#timeskip;
    const tiers = Object.entries(GROWTH_TIERS).map(([tier, gp]) => ({
      tier, gp, label: game.i18n.localize(`PARADIGMENGINE.Growth.${tier}`), on: milestone.tier === tier, can: canStart
    }));
    if (game.user.isGM) {
      tiers.push({
        tier: "Timeskip", gp: 0, label: game.i18n.localize("PARADIGMENGINE.Growth.Timeskip"),
        on: milestone.tier === "Timeskip" || !!this.#timeskip, can: this.isEditable && !open
      });
    }
    const tail = open
      ? game.i18n.format("PARADIGMENGINE.Growth.ToSpend", { tier: game.i18n.localize(`PARADIGMENGINE.Growth.${milestone.tier}`), n: milestone.gp })
      : game.i18n.localize("PARADIGMENGINE.Growth.SpendOnAward");
    const context = {
      milestone: {
        open,
        gp: milestone.gp,
        pips: Array.from({ length: Math.max(milestone.gp, 5) }, (_, i) => i < milestone.gp),
        tiers,
        tail,
        cancelLabel: game.i18n.localize(milestone.items.length ? "PARADIGMENGINE.Growth.End" : "PARADIGMENGINE.Growth.Cancel")
      },
      cards: growthCards(actor).map(card => ({
        ...card,
        options: card.options.map(o => ({ ...o, can: o.can && this.isEditable }))
      })),
      log: growthLog(actor)
    };
    if (this.#timeskip && !open) {
      context.timeskip = {
        gp: this.#timeskip.gp,
        access: GROWTH_GROUPS.map(group => ({
          group,
          label: game.i18n.localize(`PARADIGMENGINE.Growth.Group.${group}`),
          on: this.#timeskip.access[group]
        }))
      };
    }
    return context;
  }

  static async #onGrowthStart(event, target) {
    if (!this.isEditable) return;
    const tier = target.dataset.tier;
    if (tier === "Timeskip") {
      if (!game.user.isGM) return;
      this.#timeskip = this.#timeskip ? null : { gp: 1, access: { general: true, arc: true, season: false } };
      return this.render({ parts: ["growth"] });
    }
    await startMilestone(this.document, tier);
  }

  static async #onGrowthCancel() {
    if (!this.isEditable) return;
    await cancelMilestone(this.document);
  }

  /* An option with a pick opens its window; the rest apply at once. */
  static async #onGrowthTake(event, target) {
    if (!this.isEditable) return;
    const option = GROWTH_OPTIONS.find(o => o.key === target.dataset.key);
    if (!option) return;
    if (option.pick) GrowthPick.open(this.document, option.key);
    else await spend(this.document, option.key);
  }

  static #onGrowthTsStep(event, target) {
    if (!this.#timeskip) return;
    this.#timeskip.gp = Math.clamp(this.#timeskip.gp + Number(target.dataset.dir), 1, 20);
    this.render({ parts: ["growth"] });
  }

  static #onGrowthTsAccess(event, target) {
    const group = target.dataset.group;
    if (!this.#timeskip || group === "general" || !(group in this.#timeskip.access)) return;
    this.#timeskip.access[group] = !this.#timeskip.access[group];
    this.render({ parts: ["growth"] });
  }

  static async #onGrowthTsAward() {
    if (!this.isEditable || !this.#timeskip) return;
    const { gp, access } = this.#timeskip;
    this.#timeskip = null;
    await startTimeskip(this.document, gp, access);
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
    this.#luckPick = false;
    this.#timeskip = null;
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
    if (benefit === "Sync") {
      const energy = this.document.system.energy.value;
      if (energy < 1) return;
      const bond = await this.#spendBond(i);
      if (!bond) return;
      await this.document.update({ "system.energy.value": energy - 1 });
      return postBondCard(this.document, bond, "Sync", game.i18n.localize("PARADIGMENGINE.Chat.SyncEnergy"));
    }
    if (benefit === "TwistOfFate") {
      const bond = await this.#spendBond(i);
      if (!bond) return;
      this.#luckPick = true;
      this.render();
      return postBondCard(this.document, bond, "TwistOfFate");
    }
    const bond = await this.#spendBond(i);
    if (!bond) return;
    await postBondCard(this.document, bond, "BorrowStrength",
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

  /* Twist of Fate, one hex at a time: a spent die is replenished with a
     fresh roll, a ready die is rerolled. */
  static async #onLuckPick(event, target) {
    if (!this.isEditable || !this.#luckPick) return;
    const luck = this.document.system.toObject().luck;
    const slot = luck[Number(target.dataset.i)];
    if (!slot) return;
    const roll = await new foundry.dice.Roll(`1d${this.document.system.luckDie}`).evaluate();
    Object.assign(slot, { value: roll.total, spent: false });
    await this.document.update({ "system.luck": luck });
  }

  static async #onLuckDone() {
    this.#luckPick = false;
    this.render();
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
