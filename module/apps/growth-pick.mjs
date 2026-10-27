import { LADDER, SKILL_KINDS } from "../config.mjs";
import {
  attributeRows, availableSkills, bondCandidates, bondRankRows, growthOptions, modifySkillRows, optionLabel, rankCap, retrainSkillRows,
  skillRankRows, spend, techniqueRows
} from "../growth.mjs";
import SkillTree from "./skill-tree.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* The pick window a Growth option opens when it has to choose what it
   touches: a new Skill by name, from the Skill Tree, or dropped in; a new
   Bond by name, from the Party and the NPCs, or dropped in; the Skill to
   modify; the Skill to retrain, then its replacement as a new Skill is
   picked; the Skill, Bond, or Attribute to Rank Up; the Technique to
   master. One pick spends the point and closes the window. */
export default class GrowthPick extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["paradigm-engine", "growth-pick"],
    window: { resizable: true },
    position: { width: 400, height: "auto" },
    actions: {
      growthCreate: this.#onCreate,
      setKind: this.#onSetKind,
      pickSkill: this.#onPickSkill,
      pickActor: this.#onPickActor,
      pickItem: this.#onPickItem,
      pickBond: this.#onPickBond,
      pickAttribute: this.#onPickAttribute,
      pickRetrain: this.#onPickRetrain,
      backRetrain: this.#onBackRetrain,
      openTree: this.#onOpenTree
    }
  };

  static PARTS = {
    body: { template: "systems/paradigm-engine/templates/apps/growth-pick.hbs", scrollable: [""] }
  };

  static #instances = new Map();

  #actor;

  #option;

  #kind = "Technique";

  /* Retrain: the id of the Skill being replaced, once chosen. */
  #retrainId = null;

  #hooks = [];

  constructor({ actor, option, ...options } = {}) {
    super(options);
    this.#actor = actor;
    this.#option = option;
  }

  static open(actor, key) {
    const option = growthOptions(actor).find(o => o.key === key);
    if (!option?.pick) return null;
    const id = `growth-pick-${actor.uuid.replaceAll(".", "-")}`;
    const prior = GrowthPick.#instances.get(actor.uuid);
    if (prior && prior.#option.key !== key) prior.close();
    let app = prior && prior.#option.key === key ? prior : null;
    if (!app) {
      app = new GrowthPick({ actor, option, id });
      GrowthPick.#instances.set(actor.uuid, app);
    }
    app.render({ force: true });
    return app;
  }

  get title() {
    return optionLabel(this.#option.key);
  }

  /* The Skill a Retrain is replacing, while it still stands. */
  get #retraining() {
    const skill = this.#retrainId ? this.#actor.items.get(this.#retrainId) : null;
    return skill?.type === "skill" ? skill : null;
  }

  /* Whether the window is choosing a new Skill: New Skill, or the second
     step of a Retrain. */
  get #choosingSkill() {
    const pick = this.#option.pick;
    return pick === "newSkill" || (pick === "retrain" && !!this.#retraining);
  }

  /* The lists read live data: a change on the actor, or a Skill coming or
     going, redraws them. The window closes with its milestone. */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const refresh = foundry.utils.debounce(() => {
      if (!this.#actor.system.growth.milestone.tier) return this.close();
      this.render();
    }, 50);
    this.#hooks.push(["updateActor", Hooks.on("updateActor", actor => { if (actor === this.#actor) refresh(); })]);
    for (const hook of ["createItem", "updateItem", "deleteItem"]) {
      this.#hooks.push([hook, Hooks.on(hook, refresh)]);
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const pick = this.#option.pick;
    if (this.#choosingSkill || pick === "newBond") {
      new foundry.applications.ux.DragDrop.implementation({
        dropSelector: ".gpick",
        permissions: { drop: () => this.#actor.isOwner },
        callbacks: { drop: this.#onDrop.bind(this) }
      }).bind(this.element);
      const input = this.element.querySelector(".crow input");
      input?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          GrowthPick.#onCreate.call(this);
        }
      });
      input?.focus();
    }
  }

  _onClose(options) {
    super._onClose(options);
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
    if (GrowthPick.#instances.get(this.#actor.uuid) === this) GrowthPick.#instances.delete(this.#actor.uuid);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.#actor;
    const option = this.#option;
    const pick = option.pick;
    const group = game.i18n.localize(`PARADIGMENGINE.Growth.Group.${option.group}`);
    const retraining = pick === "retrain" ? this.#retraining : null;
    context.kind = pick;
    context.title = this.title;
    context.eyebrow = game.i18n.format(option.once ? "PARADIGMENGINE.Growth.CostOnce" : "PARADIGMENGINE.Growth.Cost", { group });
    context.isNewSkill = this.#choosingSkill;
    context.isNewBond = pick === "newBond";
    context.isModifySkill = pick === "modifySkill";
    context.isRetrain = pick === "retrain" && !retraining;
    context.isSkillRank = pick === "skillRank";
    context.isBondRank = pick === "bondRank";
    context.isAttribute = pick === "attribute";
    context.isTechnique = pick === "technique";
    const cap = pick === "attribute" ? 5 : rankCap(actor);
    const capStep = LADDER[cap];
    if (pick === "skillRank" || pick === "bondRank" || pick === "attribute") {
      context.cap = { rank: capStep.rank, cssVar: capStep.cssVar, label: game.i18n.localize("PARADIGMENGINE.Growth.UpTo") };
    }
    const newRank = retraining ? retraining.system.rank : 0;
    if (this.#choosingSkill || pick === "newBond") context.newRank = { rank: LADDER[newRank].rank, cssVar: LADDER[newRank].cssVar };
    if (this.#choosingSkill) {
      context.kinds = SKILL_KINDS.map(kind => ({ kind, label: game.i18n.localize(`PARADIGMENGINE.Skill.${kind}`), on: kind === this.#kind }));
      context.available = availableSkills(actor, retraining);
    }
    if (retraining) {
      context.retraining = { name: retraining.name, label: game.i18n.localize("PARADIGMENGINE.Growth.Replacing") };
    }
    if (pick === "newBond") Object.assign(context, bondCandidates(actor));
    if (pick === "modifySkill") context.rows = modifySkillRows(actor);
    if (context.isRetrain) context.rows = retrainSkillRows(actor);
    if (pick === "skillRank") context.rows = skillRankRows(actor, cap);
    if (pick === "bondRank") context.rows = bondRankRows(actor, cap);
    if (pick === "attribute") context.rows = attributeRows(actor);
    if (pick === "technique") context.rows = techniqueRows(actor);
    return context;
  }

  /* A Retrain carries the Skill it replaces into every spend. */
  async #spend(choice) {
    if (this.#option.pick === "retrain") {
      if (!this.#retraining) return false;
      choice = { ...choice, itemId: this.#retrainId };
    }
    const bought = await spend(this.#actor, this.#option.key, choice);
    if (bought) await this.close();
    return bought;
  }

  static async #onCreate() {
    const name = this.element.querySelector(".crow input")?.value ?? "";
    if (this.#option.pick === "newBond" && !name.trim()) return;
    await this.#spend({ name, kind: this.#kind });
  }

  /* Retrain, first step: the Skill to replace is chosen and the window
     turns to picking its replacement. */
  static #onPickRetrain(event, target) {
    const skill = this.#actor.items.get(target.dataset.itemId);
    if (skill?.type !== "skill") return;
    this.#retrainId = skill.id;
    this.#kind = skill.system.kind;
    this.render();
  }

  static #onBackRetrain() {
    this.#retrainId = null;
    this.render();
  }

  static #onSetKind(event, target) {
    this.#kind = SKILL_KINDS.includes(target.dataset.kind) ? target.dataset.kind : "Technique";
    this.render();
  }

  static async #onPickSkill(event, target) {
    await this.#spend({ uuid: target.dataset.uuid });
  }

  static async #onPickActor(event, target) {
    const actor = await fromUuid(target.dataset.uuid);
    if (actor instanceof Actor) await this.#spend({ name: actor.name });
  }

  static async #onPickItem(event, target) {
    await this.#spend({ itemId: target.dataset.itemId });
  }

  static async #onPickBond(event, target) {
    await this.#spend({ index: Number(target.dataset.index) });
  }

  static async #onPickAttribute(event, target) {
    await this.#spend({ key: target.dataset.key });
  }

  static #onOpenTree() {
    SkillTree.open(this.#actor);
  }

  /* A Skill dropped in is taken as the new Skill; a character dropped in
     is the new Bond. */
  async #onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const pick = this.#option.pick;
    if (this.#choosingSkill && data.type === "Item") {
      const item = await Item.implementation.fromDropData(data);
      if (item?.type === "skill" && item.parent !== this.#actor) await this.#spend({ uuid: item.uuid });
    } else if (pick === "newBond" && data.type === "Actor") {
      const actor = await Actor.implementation.fromDropData(data);
      if (actor && actor !== this.#actor) await this.#spend({ name: actor.name });
    }
  }
}
