import { LADDER, SKILL_KINDS } from "../config.mjs";
import {
  attributeRows, availableSkills, bondCandidates, bondRankRows, growthOptions, modifySkillRows, optionLabel, skillRankRows, spend
} from "../growth.mjs";
import SkillTree from "./skill-tree.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* The pick window a Growth option opens when it has to choose what it
   touches: a new Skill by name, from the Skill Tree, or dropped in; a new
   Bond by name, from the Party and the NPCs, or dropped in; the Skill to
   modify; the Skill, Bond, or Attribute to Rank Up. One pick spends the
   point and closes the window. */
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
    if (pick === "newSkill" || pick === "newBond") {
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
    context.kind = pick;
    context.title = this.title;
    context.eyebrow = game.i18n.format(option.once ? "PARADIGMENGINE.Growth.CostOnce" : "PARADIGMENGINE.Growth.Cost", { group });
    context.isNewSkill = pick === "newSkill";
    context.isNewBond = pick === "newBond";
    context.isModifySkill = pick === "modifySkill";
    context.isSkillRank = pick === "skillRank";
    context.isBondRank = pick === "bondRank";
    context.isAttribute = pick === "attribute";
    const capStep = LADDER[pick === "attribute" ? 5 : actor.system.rank];
    if (pick === "skillRank" || pick === "bondRank" || pick === "attribute") context.cap = { rank: capStep.rank, cssVar: capStep.cssVar };
    if (pick === "newSkill" || pick === "newBond") context.newRank = { rank: LADDER[0].rank, cssVar: LADDER[0].cssVar };
    if (pick === "newSkill") {
      context.kinds = SKILL_KINDS.map(kind => ({ kind, label: game.i18n.localize(`PARADIGMENGINE.Skill.${kind}`), on: kind === this.#kind }));
      context.available = availableSkills(actor);
    }
    if (pick === "newBond") Object.assign(context, bondCandidates(actor));
    if (pick === "modifySkill") context.rows = modifySkillRows(actor);
    if (pick === "skillRank") context.rows = skillRankRows(actor);
    if (pick === "bondRank") context.rows = bondRankRows(actor);
    if (pick === "attribute") context.rows = attributeRows(actor);
    return context;
  }

  async #spend(choice) {
    const bought = await spend(this.#actor, this.#option.key, choice);
    if (bought) await this.close();
    return bought;
  }

  static async #onCreate() {
    const name = this.element.querySelector(".crow input")?.value ?? "";
    if (this.#option.pick === "newBond" && !name.trim()) return;
    await this.#spend({ name, kind: this.#kind });
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
    if (pick === "newSkill" && data.type === "Item") {
      const item = await Item.implementation.fromDropData(data);
      if (item?.type === "skill" && item.parent !== this.#actor) await this.#spend({ uuid: item.uuid });
    } else if (pick === "newBond" && data.type === "Actor") {
      const actor = await Actor.implementation.fromDropData(data);
      if (actor && actor !== this.#actor) await this.#spend({ name: actor.name });
    }
  }
}
