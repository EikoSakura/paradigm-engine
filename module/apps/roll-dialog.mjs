import { DIFFICULTY, LADDER, ATTRIBUTES } from "../config.mjs";
import { postActionRoll, postEnergyCard } from "../chat.mjs";
import { placeBurst } from "./area.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* The Action Roll picker. Opened from an Attribute or Technique name on an
   actor sheet; that die is locked as the first die. One dialog per actor. */
export default class RollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, first, trait, ...options } = {}) {
    super(options);
    this.#actor = actor;
    this.#first = first;
    if (trait) this.#trait = trait;
    if (game.user.targets.size === 1) {
      const rank = game.user.targets.first().actor?.system.rank;
      if (typeof rank === "number") this.#difficulty = rank;
    }
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "roll-dialog"],
    position: { width: 380, height: "auto" },
    actions: {
      step: this.#onStep,
      difficulty: this.#onDifficulty,
      limit: this.#onLimit,
      areaStep: this.#onAreaStep,
      place: this.#onPlace,
      roll: this.#onRoll
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/roll-dialog.hbs" }
  };

  static #instances = new Map();

  #actor;

  /* { kind: "attribute", key } or { kind: "technique", id } */
  #first;

  #second = "";

  #trait = "";

  /* Rank steps applied to [first, second] for this one roll, clamped E..S. */
  #steps = [0, 0];

  #bonus = 0;

  /* Difficulty: a DIFFICULTY index or null, plus the Limit Break raise. */
  #difficulty = null;

  #limitBreak = 0;

  /* The Area size when the rolled Technique covers one, capped at its
     Rank's Die Value; null while no area Technique is in the roll. */
  #areaSize = null;

  #areaCap = null;

  static open(actor, first, trait) {
    this.#instances.get(actor.uuid)?.close();
    const dialog = new this({ actor, first, trait });
    this.#instances.set(actor.uuid, dialog);
    dialog.render(true);
  }

  get title() {
    return game.i18n.localize("PROJECTANIME.Roll.Title");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const first = this.#resolveFirst();
    if (!first) {
      this.close();
      return context;
    }
    const seconds = this.#seconds();
    if (!seconds.some(s => s.value === this.#second)) this.#second = seconds[0]?.value ?? "";
    const traits = [...this.#actor.itemTypes.trait].sort((a, b) => a.sort - b.sort).map(item => ({
      value: item.id,
      label: `${item.name} +${LADDER[item.system.rank].mod}`
    }));
    if (this.#trait && !traits.some(t => t.value === this.#trait)) this.#trait = "";

    const second = this.#resolveSecond();
    const bases = [first.rank, second.rank];
    const ranks = this.#effRanks();
    this.#steps = ranks.map((r, i) => r - bases[i]);
    const stepClass = i => this.#steps[i] > 0 ? "up" : this.#steps[i] < 0 ? "down" : "";

    context.first = {
      name: first.name,
      die: LADDER[ranks[0]].die,
      stepClass: stepClass(0),
      upDisabled: ranks[0] >= 5,
      downDisabled: ranks[0] <= 0,
      isTechnique: first.tech,
      costLabel: first.tech ? game.i18n.format("PROJECTANIME.Technique.Energy", { n: LADDER[first.rank].mod }) : ""
    };
    context.secondDie = {
      die: LADDER[ranks[1]].die,
      stepClass: stepClass(1),
      upDisabled: ranks[1] >= 5,
      downDisabled: ranks[1] <= 0
    };
    context.seconds = seconds.map(s => ({ ...s, selected: s.value === this.#second }));
    context.traits = traits.map(t => ({ ...t, selected: t.value === this.#trait }));
    context.bonus = this.#bonus;
    const technique = this.#techniqueItem();
    if (technique?.system.area) {
      const cap = LADDER[technique.system.rank].dieValue;
      if (this.#areaCap !== cap) {
        this.#areaCap = cap;
        this.#areaSize = cap;
      }
      context.area = {
        size: this.#areaSize,
        downDisabled: this.#areaSize <= 1,
        upDisabled: this.#areaSize >= cap
      };
    } else {
      this.#areaCap = null;
      this.#areaSize = null;
    }
    context.difficulties = DIFFICULTY.map((d, index) => ({ ...d, index, selected: this.#difficulty === index }));
    context.hasDifficulty = this.#difficulty !== null;
    context.limitBreak = this.#limitBreak;
    context.lbDownDisabled = this.#limitBreak <= 0;
    context.lbUpDisabled = this.#difficulty === null || this.#limitBreak >= 6 - this.#difficulty;
    context.effective = this.#limitBreak > 0 ? DIFFICULTY[Math.min(this.#difficulty + this.#limitBreak, 6)] : null;
    context.formula = this.#formula();
    return context;
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("change", this.#onChange.bind(this));
  }

  _onClose(options) {
    super._onClose(options);
    if (RollDialog.#instances.get(this.#actor.uuid) === this) RollDialog.#instances.delete(this.#actor.uuid);
  }

  #resolveFirst() {
    if (this.#first.kind === "attribute") {
      const attribute = ATTRIBUTES.find(a => a.key === this.#first.key);
      if (!attribute) return null;
      return {
        name: game.i18n.localize(attribute.label),
        rank: this.#actor.system.attributes[attribute.key],
        tech: false
      };
    }
    const item = this.#actor.items.get(this.#first.id);
    if (!item) return null;
    return { name: item.name, rank: item.system.rank, tech: true };
  }

  /* From an Attribute: the other four Attributes and the actor's Techniques.
     From a Technique: the five Attributes. */
  #seconds() {
    const attributes = ATTRIBUTES
      .filter(a => !(this.#first.kind === "attribute" && a.key === this.#first.key))
      .map(a => ({
        value: `attribute.${a.key}`,
        label: `${game.i18n.localize(a.label)} · ${LADDER[this.#actor.system.attributes[a.key]].die}`
      }));
    if (this.#first.kind === "technique") return attributes;
    const techniques = [...this.#actor.itemTypes.technique].sort((a, b) => a.sort - b.sort).map(item => {
      const step = LADDER[item.system.rank];
      const cost = game.i18n.format("PROJECTANIME.Technique.Energy", { n: step.mod });
      return { value: `technique.${item.id}`, label: `${item.name} · ${step.die} · ${cost}` };
    });
    return [...attributes, ...techniques];
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

  /* The one Technique in the roll, first or second die, or null. */
  #techniqueItem() {
    if (this.#first.kind === "technique") return this.#actor.items.get(this.#first.id) ?? null;
    const [kind, id] = this.#second.split(".");
    return kind === "technique" ? this.#actor.items.get(id) ?? null : null;
  }

  #resolveTrait() {
    if (!this.#trait) return null;
    const item = this.#actor.items.get(this.#trait);
    if (!item) return null;
    return { name: item.name, rank: item.system.rank };
  }

  #effRanks() {
    const first = this.#resolveFirst();
    const second = this.#resolveSecond();
    if (!first || !second) return null;
    return [first, second].map((d, i) => Math.clamp(d.rank + this.#steps[i], 0, 5));
  }

  #formula() {
    const ranks = this.#effRanks();
    if (!ranks) return "";
    const parts = ranks.map(r => `1${LADDER[r].die}`);
    const trait = this.#resolveTrait();
    if (trait) parts.push(String(LADDER[trait.rank].mod));
    let formula = parts.join(" + ");
    if (this.#bonus > 0) formula += ` + ${this.#bonus}`;
    else if (this.#bonus < 0) formula += ` − ${-this.#bonus}`;
    return formula;
  }

  #onChange(event) {
    const el = event.target.closest("[name]");
    if (!el) return;
    if (el.name === "second") this.#second = el.value;
    else if (el.name === "trait") this.#trait = el.value;
    else if (el.name === "bonus") this.#bonus = Math.trunc(Number(el.value) || 0);
    else return;
    this.render();
  }

  static #onStep(event, target) {
    this.#steps[Number(target.dataset.die)] += Number(target.dataset.delta);
    this.render();
  }

  static #onDifficulty(event, target) {
    const index = Number(target.dataset.index);
    this.#difficulty = this.#difficulty === index ? null : index;
    this.#limitBreak = this.#difficulty === null ? 0 : Math.min(this.#limitBreak, 6 - this.#difficulty);
    this.render();
  }

  static #onLimit(event, target) {
    if (this.#difficulty === null) return;
    this.#limitBreak = Math.clamp(this.#limitBreak + Number(target.dataset.delta), 0, 6 - this.#difficulty);
    this.render();
  }

  static #onAreaStep(event, target) {
    if (this.#areaCap === null) return;
    this.#areaSize = Math.clamp(this.#areaSize + Number(target.dataset.delta), 1, this.#areaCap);
    this.render();
  }

  static async #onPlace() {
    if (this.#areaSize === null) return;
    await placeBurst(this.#areaSize);
  }

  static async #onRoll() {
    const first = this.#resolveFirst();
    const second = this.#resolveSecond();
    if (!first || !second) return this.close();
    const technique = this.#techniqueItem();
    if (technique) {
      const cost = LADDER[technique.system.rank].mod;
      const { value } = this.#actor.system.energy;
      if (cost > value) return postEnergyCard(this.#actor, technique);
      await this.#actor.update({ "system.energy.value": value - cost });
    }
    const ranks = this.#effRanks();
    await postActionRoll(
      this.#actor,
      { name: first.name, rank: ranks[0] },
      { name: second.name, rank: ranks[1] },
      this.#resolveTrait(),
      this.#bonus,
      this.#difficulty,
      this.#limitBreak
    );
    this.close();
  }
}
