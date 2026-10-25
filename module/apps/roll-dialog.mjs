import { DIFFICULTY, LADDER, ATTRIBUTES, costLabel, energyCost } from "../config.mjs";
import { postActionRoll, postEnergyCard } from "../chat.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* The Action Roll popup. Opened from an Attribute or Skill name on an actor
   sheet or a Skill bar slot, that die is locked as the first die; opened
   from a Checks button or a card, the first die is picked from the five
   Attributes; opened by Borrow Strength, the Bond's Rank die is locked as
   the first die in an Attribute's place. The popup hangs under the clicked element. One popup per
   actor. Enter rolls, Escape or a click outside closes.

   Options beyond the anchor:
   - title: the header word in place of Action Roll.
   - tag: a chip in the header, such as a Clash side's name.
   - difficulty: "free" (the picker, the default), "none" (totals only),
     { locked: index } (shown, not picked), or "only" (the picker alone,
     with a Begin button and no dice).
   - extra: flags posted beside the roll card.
   - submit: a function taking the result in place of posting a card. */
export default class RollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, first = null, anchor = null, title = "", tag = "", difficulty = "free", extra = {}, submit = null, ...options } = {}) {
    super(options);
    this.#actor = actor;
    this.#first = first;
    this.#anchor = anchor;
    this.#title = title;
    this.#tag = tag;
    this.#mode = typeof difficulty === "object" ? "locked" : difficulty;
    this.#extra = extra;
    this.#submit = submit;
    if (this.#mode === "locked") this.#difficulty = difficulty.locked;
    else if (this.#mode !== "none" && game.user.targets.size === 1) {
      const rank = game.user.targets.first().actor?.system.rank;
      if (typeof rank === "number") this.#difficulty = rank;
    }
    if (!this.#first) this.#firstKey = this.#bestAttribute();
  }

  static DEFAULT_OPTIONS = {
    classes: ["paradigm-engine", "roll-popup"],
    window: { frame: false, positioned: true },
    position: { width: 320, height: "auto" },
    actions: {
      step: this.#onStep,
      pickFirst: this.#onPickFirst,
      pick: this.#onPick,
      difficulty: this.#onDifficulty,
      limit: this.#onLimit,
      roll: this.#onRoll
    }
  };

  static PARTS = {
    body: { template: "systems/paradigm-engine/templates/apps/roll-dialog.hbs" }
  };

  /* Gap between the anchor and the popup, room for the tail. */
  static #GAP = 10;

  static #instances = new Map();

  #actor;

  /* { kind: "attribute", key }, { kind: "skill", id }, { kind: "bond", index },
     or null to pick. */
  #first;

  /* The picked first Attribute when #first is null. */
  #firstKey = "";

  /* The element the popup hangs under, or null to center. */
  #anchor;

  #title;

  #tag;

  #mode;

  #extra;

  #submit;

  #second = "";

  /* Rank steps applied to [first, second] for this one roll, clamped E..S. */
  #steps = [0, 0];

  /* Difficulty: a DIFFICULTY index or null, plus the Limit Break raise. */
  #difficulty = null;

  #limitBreak = 0;

  #flip = false;

  #onDocumentPointerDown = this.#closeOnOutside.bind(this);

  #onDocumentKeyDown = this.#onKeyDown.bind(this);

  static open(actor, first = null, anchor = null, options = {}) {
    this.#instances.get(actor.uuid)?.close();
    const dialog = new this({ actor, first, anchor, ...options });
    this.#instances.set(actor.uuid, dialog);
    dialog.render({ force: true, position: dialog.#anchorPosition() });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.flip = this.#flip;
    context.title = this.#title || game.i18n.localize("PARADIGMENGINE.Roll.Title");
    context.tag = this.#tag;
    context.difficultyOnly = this.#mode === "only";
    context.showDifficulty = this.#mode === "free" || this.#mode === "only";
    context.difficulties = DIFFICULTY.map((d, index) => ({ ...d, index, selected: this.#difficulty === index }));
    context.hasDifficulty = this.#difficulty !== null;
    context.locked = this.#mode === "locked" && this.#difficulty !== null ? DIFFICULTY[this.#difficulty] : null;
    context.rollLabel = game.i18n.localize(this.#mode === "only" ? "PARADIGMENGINE.Check.Begin" : "PARADIGMENGINE.Roll.Roll");
    if (this.#mode === "only") {
      context.versus = this.#difficulty === null ? "" : game.i18n.format("PARADIGMENGINE.Roll.Versus", { n: DIFFICULTY[this.#difficulty].number });
      context.canRoll = this.#difficulty !== null;
      return context;
    }
    const first = this.#resolveFirst();
    if (!first) {
      this.close();
      return context;
    }
    const seconds = this.#seconds();
    const current = seconds.find(s => s.value === this.#second);
    if (!current || current.off) this.#second = seconds.find(s => !s.off)?.value ?? "";
    const second = this.#resolveSecond();
    const bases = [first.rank, second?.rank ?? 0];
    const ranks = this.#effRanks() ?? bases;
    this.#steps = ranks.map((r, i) => r - bases[i]);
    const stepper = i => ({
      die: LADDER[ranks[i]].die,
      upDisabled: ranks[i] >= 5,
      downDisabled: ranks[i] <= 0
    });

    context.first = { name: first.name, costLabel: first.skill ? costLabel(first.skill.system) : "", ...stepper(0) };
    if (!this.#first) {
      context.firstPick = ATTRIBUTES.map(a => ({
        key: a.key,
        name: game.i18n.localize(a.label),
        die: LADDER[this.#actor.system.attributes[a.key]].die,
        selected: a.key === this.#firstKey
      }));
    }
    const rows = seconds.map(s => {
      const selected = s.value === this.#second;
      return { ...s, selected, stepper: selected ? stepper(1) : null };
    });
    context.attributes = rows.filter(r => r.kind === "attribute");
    context.skills = rows.filter(r => r.kind === "skill");
    const max = this.#difficulty === null || this.#mode !== "free" ? 0 : 6 - this.#difficulty;
    context.segments = Array.from({ length: max }, (_, i) => ({ n: i + 1, on: i < this.#limitBreak, last: i === max - 1 }));
    context.full = max > 0 && this.#limitBreak === max;
    context.base = this.#difficulty === null ? null : DIFFICULTY[this.#difficulty];
    context.effective = this.#limitBreak > 0 ? DIFFICULTY[Math.min(this.#difficulty + this.#limitBreak, 6)] : null;
    const target = context.effective ?? context.base;
    context.formula = this.#formula(ranks);
    context.versus = target ? game.i18n.format("PARADIGMENGINE.Roll.Versus", { n: target.number }) : "";
    context.canRoll = true;
    return context;
  }

  /* The popup takes focus so Enter rolls and Escape closes at once; the
     document listeners run ahead of core's window-level keybindings. */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.tabIndex = -1;
    this.element.focus({ preventScroll: true });
    document.addEventListener("pointerdown", this.#onDocumentPointerDown, true);
    document.addEventListener("keydown", this.#onDocumentKeyDown);
  }

  /* Sit above every open window, and flip above the anchor when the popup
     would run off the bottom of the screen. */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.style.zIndex = String(++ApplicationV2._maxZ);
    if (!this.#anchor?.isConnected) return;
    const rect = this.#anchor.getBoundingClientRect();
    const height = this.element.getBoundingClientRect().height;
    const below = rect.bottom + RollDialog.#GAP + height <= document.documentElement.clientHeight;
    const flip = !below && rect.top - RollDialog.#GAP - height >= 0;
    if (flip !== this.#flip) {
      this.#flip = flip;
      this.element.classList.toggle("flip", flip);
    }
    const left = Math.min(rect.left, document.documentElement.clientWidth - this.element.offsetWidth - 8);
    this.setPosition({ left: Math.max(0, left), top: flip ? rect.top - RollDialog.#GAP - height : rect.bottom + RollDialog.#GAP });
  }

  /* A frameless popup has no window to shrink, so the closing animation
     core awaits would only run out its timeout; close at once. */
  close(options = {}) {
    return super.close({ animate: false, ...options });
  }

  _onClose(options) {
    super._onClose(options);
    document.removeEventListener("pointerdown", this.#onDocumentPointerDown, true);
    document.removeEventListener("keydown", this.#onDocumentKeyDown);
    if (RollDialog.#instances.get(this.#actor.uuid) === this) RollDialog.#instances.delete(this.#actor.uuid);
  }

  #anchorPosition() {
    if (!this.#anchor?.isConnected) return {};
    const rect = this.#anchor.getBoundingClientRect();
    return { left: rect.left, top: rect.bottom + RollDialog.#GAP };
  }

  #closeOnOutside(event) {
    if (!this.element || this.element.contains(event.target)) return;
    this.close();
  }

  #onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (event.key === "Enter") {
      const active = document.activeElement;
      if (!this.element?.contains(active) || active.tagName === "BUTTON") return;
      event.preventDefault();
      RollDialog.#onRoll.call(this);
    }
  }

  /* The highest-ranked Attribute, first in sheet order on a tie. */
  #bestAttribute() {
    const attributes = this.#actor.system.attributes;
    return ATTRIBUTES.reduce((best, a) => (attributes[a.key] > attributes[best] ? a.key : best), ATTRIBUTES[0].key);
  }

  #resolveFirst() {
    if (this.#first?.kind === "bond") {
      const bond = this.#actor.system.bonds?.[this.#first.index];
      if (!bond) return null;
      return { name: bond.name || game.i18n.localize("PARADIGMENGINE.Bond.Title"), rank: bond.rank, skill: false };
    }
    const key = this.#first ? (this.#first.kind === "attribute" ? this.#first.key : null) : this.#firstKey;
    if (key !== null) {
      const attribute = ATTRIBUTES.find(a => a.key === key);
      if (!attribute) return null;
      return {
        name: game.i18n.localize(attribute.label),
        rank: this.#actor.system.attributes[attribute.key],
        skill: false
      };
    }
    const item = this.#actor.items.get(this.#first.id);
    if (!item) return null;
    return { name: item.name, rank: item.system.rank, skill: item };
  }

  /* From an Attribute: the other four Attributes, then every Skill by name;
     a Technique the actor cannot pay for is listed but off. From a Skill:
     the five Attributes. From a Bond, which stands in for an Attribute: all
     five Attributes and the Skills. */
  #seconds() {
    const fromSkill = this.#first?.kind === "skill";
    const firstKey = this.#first ? this.#first.key : this.#firstKey;
    const attributes = ATTRIBUTES
      .filter(a => fromSkill || a.key !== firstKey)
      .map(a => ({
        kind: "attribute",
        value: `attribute.${a.key}`,
        name: game.i18n.localize(a.label),
        die: LADDER[this.#actor.system.attributes[a.key]].die,
        costLabel: "",
        off: false
      }));
    if (fromSkill) return attributes;
    const energy = this.#actor.system.energy.value;
    const skills = [...this.#actor.itemTypes.skill]
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
      .map(item => ({
        kind: "skill",
        value: `skill.${item.id}`,
        name: item.name,
        die: LADDER[item.system.rank].die,
        costLabel: costLabel(item.system),
        off: energyCost(item.system) > energy
      }));
    return [...attributes, ...skills];
  }

  #resolveSecond() {
    const [kind, key] = this.#second.split(".");
    if (kind === "attribute") {
      const attribute = ATTRIBUTES.find(a => a.key === key);
      if (!attribute) return null;
      return { name: game.i18n.localize(attribute.label), rank: this.#actor.system.attributes[key] };
    }
    const item = this.#actor.items.get(key);
    if (!item) return null;
    return { name: item.name, rank: item.system.rank };
  }

  /* The one Skill in the roll, first or second die, or null. */
  #skillItem() {
    if (this.#first?.kind === "skill") return this.#actor.items.get(this.#first.id) ?? null;
    const [kind, id] = this.#second.split(".");
    return kind === "skill" ? this.#actor.items.get(id) ?? null : null;
  }

  #effRanks() {
    const first = this.#resolveFirst();
    const second = this.#resolveSecond();
    if (!first || !second) return null;
    return [first, second].map((d, i) => Math.clamp(d.rank + this.#steps[i], 0, 5));
  }

  #formula(ranks) {
    return ranks.map(r => `1${LADDER[r].die}`).join(" + ");
  }

  static #onStep(event, target) {
    this.#steps[Number(target.dataset.die)] += Number(target.dataset.delta);
    this.render();
  }

  static #onPickFirst(event, target) {
    this.#firstKey = target.dataset.key;
    this.#steps = [0, 0];
    if (this.#second === `attribute.${this.#firstKey}`) this.#second = "";
    this.render();
  }

  static #onPick(event, target) {
    this.#second = target.dataset.value;
    this.#steps[1] = 0;
    this.render();
  }

  static #onDifficulty(event, target) {
    if (this.#mode !== "free" && this.#mode !== "only") return;
    const index = Number(target.dataset.index);
    this.#difficulty = this.#difficulty === index ? null : index;
    this.#limitBreak = this.#difficulty === null ? 0 : Math.min(this.#limitBreak, 6 - this.#difficulty);
    this.render();
  }

  /* Segment n fills the meter through n; clicking the last lit segment
     empties it back one. */
  static #onLimit(event, target) {
    if (this.#difficulty === null) return;
    const n = Number(target.dataset.n);
    this.#limitBreak = Math.clamp(n === this.#limitBreak ? n - 1 : n, 0, 6 - this.#difficulty);
    this.render();
  }

  static async #onRoll() {
    if (this.#mode === "only") {
      if (this.#difficulty === null) return;
      const difficulty = this.#difficulty;
      this.close();
      return this.#submit?.({ difficulty });
    }
    const first = this.#resolveFirst();
    const second = this.#resolveSecond();
    if (!first || !second) return this.close();
    const skill = this.#skillItem();
    const cost = skill ? energyCost(skill.system) : 0;
    if (cost > 0) {
      const { value } = this.#actor.system.energy;
      if (cost > value) return postEnergyCard(this.#actor, skill);
      await this.#actor.update({ "system.energy.value": value - cost });
    }
    const ranks = this.#effRanks();
    const result = {
      first: { name: first.name, rank: ranks[0] },
      second: { name: second.name, rank: ranks[1] },
      difficulty: this.#mode === "none" ? null : this.#difficulty,
      limitBreak: this.#mode === "free" ? this.#limitBreak : 0
    };
    this.close();
    if (this.#submit) return this.#submit(result);
    await postActionRoll(this.#actor, result.first, result.second, 0, result.difficulty, result.limitBreak, this.#extra);
  }
}
