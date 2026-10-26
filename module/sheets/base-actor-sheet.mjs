import ParadigmEngineSheet from "./mixin.mjs";
import { LADDER, ATTRIBUTES, GROWTH_TIERS, costLabel } from "../config.mjs";
import GrowthPick from "../apps/growth-pick.mjs";
import { GROWTH_GROUPS, cancelMilestone, growthCards, growthLog, growthOptions, spend, startMilestone, startTimeskip } from "../growth.mjs";
import { postItemCard } from "../chat.mjs";
import RollDialog from "../apps/roll-dialog.mjs";
import SkillTree from "../apps/skill-tree.mjs";
import { foundationName, foundationOf, takeSkill } from "../skills.mjs";
import { clashSideOf } from "../apps/clash.mjs";
import { startClashRoll, startGroup, startOpposed } from "../checks.mjs";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, frameOf, frameStyle, portraitOf, wireFrameDrag } from "../portrait.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;

export default class BaseActorSheet extends ParadigmEngineSheet(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["actor"],
    position: { width: 880, height: 920 },
    actions: {
      flipBadge: this.#onFlipBadge,
      setPip: this.#onSetPip,
      toggleLuck: this.#onToggleLuck,
      stepLuckDie: this.#onStepLuckDie,
      rollLuck: this.#onRollLuck,
      rollLuckAll: this.#onRollLuckAll,
      stepRank: this.#onStepRank,
      stepMax: this.#onStepMax,
      stepZoom: this.#onStepZoom,
      growthStart: this.#onGrowthStart,
      growthCancel: this.#onGrowthCancel,
      growthTake: this.#onGrowthTake,
      growthTsStep: this.#onGrowthTsStep,
      growthTsAccess: this.#onGrowthTsAccess,
      growthTsAward: this.#onGrowthTsAward,
      createItem: this.#onCreateItem,
      openItem: this.#onOpenItem,
      deleteItem: this.#onDeleteItem,
      postItem: this.#onPostItem,
      openRoll: this.#onOpenRoll,
      openTree: this.#onOpenTree,
      groupAction: this.#onGroupAction,
      opposedAction: this.#onOpposedAction,
      clashCheck: this.#onClashCheck
    }
  };

  static FORM_ARRAYS = ["luck"];

  /* Stepper bounds for the pool maxes: free range, floor 0. The 3..8
     creation trade lives in the PC Creator alone. */
  static BOUNDS = { points: { min: 0, max: Infinity } };

  /* Which rank badges currently show their die face. Display state only, never stored. */
  #flipped = new Set();

  /* The Timeskip award being set up, or null. Display state only. */
  #timeskip = null;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;

    context.system = system;
    context.editMode = this.isEditMode;
    context.name = this.document.name;
    context.img = this.document.img;
    context.portrait = portraitOf(this.document);
    context.frameStyle = frameStyle(frameOf(this.document));
    context.initial = (this.document.name || "?").trim().charAt(0).toUpperCase() || "?";
    context.rankBadge = this._badge("rank", system.rank, "difficulty");
    context.hearts = { ...system.hearts, pips: BaseActorSheet.#pips(system.hearts) };
    context.energy = { ...system.energy, pips: BaseActorSheet.#pips(system.energy) };
    context.luck = (system.luck ?? []).map(slot => ({
      ...slot,
      stateLabel: game.i18n.localize(slot.spent ? "PARADIGMENGINE.Vitals.Spent" : "PARADIGMENGINE.Vitals.Ready")
    }));
    context.showLuck = true;
    context.luckDie = system.luckDie ?? 6;
    context.attributes = ATTRIBUTES.map(a => ({
      key: a.key,
      name: game.i18n.localize(a.label),
      desc: game.i18n.localize(a.desc),
      badge: this._badge(`attributes.${a.key}`, system.attributes[a.key])
    }));
    context.skills = await this.#prepareItems();
    context.clash = clashSideOf(this.document);
    Object.assign(context, this.#prepareGrowth());
    return context;
  }

  async _preparePartContext(partId, context) {
    if (context.tabs && partId in context.tabs) context.tab = context.tabs[partId];
    return context;
  }

  /* Form inputs cover only some columns of each row; keep the rest from the stored row. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const system = data.system;
    if (system) {
      const source = this.document.system.toObject();
      for (const key of this.constructor.FORM_ARRAYS) {
        if (!(key in system)) continue;
        system[key] = Object.entries(system[key]).map(([i, row]) =>
          foundry.utils.getType(row) === "Object" ? { ...source[key][Number(i)], ...row } : row
        );
      }
    }
    return data;
  }

  async #prepareItems() {
    const items = [...this.document.itemTypes.skill].sort((a, b) => a.sort - b.sort);
    return Promise.all(items.map(async item => {
      return {
        id: item.id,
        name: item.name,
        badge: this._badge(`skill.${item.id}`, item.system.rank),
        kindLabel: game.i18n.localize(`PARADIGMENGINE.Skill.${item.system.kind}`),
        costLabel: costLabel(item.system),
        technique: item.system.kind === "Technique",
        foundation: item.system.prerequisite ? foundationName(item) : "",
        locked: !!item.system.prerequisite && !foundationOf(item),
        enrichedText: await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.text, {
          relativeTo: item,
          secrets: this.document.isOwner
        })
      };
    }));
  }

  static #pips({ value, max }) {
    return Array.from({ length: max }, (_, i) => i < value);
  }

  /* A flipped badge shows the Rank's die, or its Difficulty when alt is "difficulty". */
  _badge(key, rankIndex, alt = "die") {
    const step = LADDER[rankIndex];
    const flipped = this.#flipped.has(key);
    const text = flipped ? (alt === "difficulty" ? String(step.difficulty) : step.die) : step.rank;
    return { key, text, flipped, small: flipped && text.length > 3, cssVar: step.cssVar };
  }

  static #onFlipBadge(event, target) {
    const key = target.dataset.key;
    if (this.#flipped.has(key)) this.#flipped.delete(key);
    else this.#flipped.add(key);
    this.render({ parts: ["header", "main"] });
  }

  static async #onSetPip(event, target) {
    if (!this.isEditable) return;
    const kind = target.dataset.kind;
    if (kind !== "hearts" && kind !== "energy") return;
    const i = Number(target.dataset.i);
    const current = this.document.system[kind].value;
    await this.document.update({ [`system.${kind}.value`]: i + 1 === current ? i : i + 1 });
  }

  static async #onToggleLuck(event, target) {
    if (!this.isEditable) return;
    const luck = this.document.system.toObject().luck;
    const slot = luck[Number(target.dataset.i)];
    if (!slot) return;
    slot.spent = !slot.spent;
    await this.document.update({ "system.luck": luck });
  }

  /* One Luck Die size for all three dice, d6 to d12; values above the new
     size clamp to it. */
  static async #onStepLuckDie(event, target) {
    if (!this.isEditable || this.document.type !== "pc") return;
    const sizes = [6, 8, 10, 12];
    const i = sizes.indexOf(this.document.system.luckDie) + Number(target.dataset.dir);
    if (!(i in sizes)) return;
    const die = sizes[i];
    const luck = this.document.system.toObject().luck.map(slot => ({ ...slot, value: Math.min(slot.value, die) }));
    await this.document.update({ "system.luckDie": die, "system.luck": luck });
  }

  /* Roll one Luck Die, or all three: the results are recorded unspent and
     the roll goes to chat. */
  static async #onRollLuck(event, target) {
    await this.#rollLuck([Number(target.dataset.i)]);
  }

  static async #onRollLuckAll() {
    await this.#rollLuck(this.document.system.luck.map((_, i) => i));
  }

  async #rollLuck(indices) {
    if (!this.isEditable || this.document.type !== "pc" || !indices.length) return;
    const die = this.document.system.luckDie;
    const roll = await new foundry.dice.Roll(`${indices.length}d${die}`).evaluate();
    const luck = this.document.system.toObject().luck;
    roll.dice[0].results.forEach((r, n) => {
      const slot = luck[indices[n]];
      if (slot) Object.assign(slot, { value: r.result, spent: false });
    });
    await this.document.update({ "system.luck": luck });
    await roll.toMessage({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.document }),
      flavor: game.i18n.localize("PARADIGMENGINE.Vitals.LuckDice")
    });
  }

  static async #onStepRank(event, target) {
    if (!this.isEditable) return;
    const dir = Number(target.dataset.dir);
    const step = v => Math.min(5, Math.max(0, v + dir));
    const { kind, key } = target.dataset;
    if (kind === "rank") {
      await this.document.update({ "system.rank": step(this.document.system.rank) });
    } else if (kind === "attribute" && key in this.document.system.attributes) {
      await this.document.update({ [`system.attributes.${key}`]: step(this.document.system.attributes[key]) });
    }
  }

  /* The portrait's zoom, from the frame tools in Edit. */
  static async #onStepZoom(event, target) {
    if (!this.isEditable) return;
    const frame = frameOf(this.document);
    const zoom = Math.clamp(Math.round((frame.zoom + Number(target.dataset.dir) * ZOOM_STEP) * 10) / 10, ZOOM_MIN, ZOOM_MAX);
    if (zoom === frame.zoom) return;
    await this.document.setFlag("paradigm-engine", "frame", { ...frame, zoom });
  }

  /* ----- Growth: a milestone's points, the option cards, the log ----- */

  #prepareGrowth() {
    const actor = this.document;
    const growth = actor.system.growth;
    if (!growth) return {};
    const milestone = growth.milestone;
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
    const option = growthOptions(this.document).find(o => o.key === target.dataset.key);
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

  _onClose(options) {
    super._onClose(options);
    this.#timeskip = null;
  }

  /* In Edit the portrait drags inside its frame to set the focus. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const img = this.element.querySelector(".figure img.art.framing");
    if (img) wireFrameDrag(img, frameOf(this.document), frame => this.document.setFlag("paradigm-engine", "frame", frame));
  }

  static async #onStepMax(event, target) {
    if (!this.isEditable) return;
    const kind = target.dataset.kind;
    if (kind !== "hearts" && kind !== "energy") return;
    const bounds = this.constructor.BOUNDS.points;
    const { value, max } = this.document.system[kind];
    const newMax = Math.min(bounds.max, Math.max(bounds.min, max + Number(target.dataset.dir)));
    await this.document.update({
      [`system.${kind}.max`]: newMax,
      [`system.${kind}.value`]: Math.min(value, newMax)
    });
  }

  static async #onCreateItem(event, target) {
    if (!this.isEditable) return;
    const type = target.dataset.type;
    if (type !== "skill") return;
    const name = CONFIG.Item.documentClass.defaultName({ type, parent: this.document });
    await this.document.createEmbeddedDocuments("Item", [{ name, type }], { renderSheet: true });
  }

  static #onOpenItem(event, target) {
    const item = this.document.items.get(target.dataset.itemId);
    item?.sheet.render(true);
  }

  static async #onDeleteItem(event, target) {
    if (!this.isEditable) return;
    const item = this.document.items.get(target.dataset.itemId);
    await item?.deleteDialog();
  }

  static async #onPostItem(event, target) {
    const item = this.document.items.get(target.dataset.itemId);
    if (item) await postItemCard(item);
  }

  /* A Skill from outside this actor lands as a copy stamped with its world
     UUID, so the chain and the tree can tell which node it is. A Skill from
     this actor sorts as usual. */
  async _onDropItem(event, item) {
    if (item.type !== "skill" || item.parent?.uuid === this.actor.uuid) return super._onDropItem(event, item);
    if (!this.actor.isOwner) return null;
    return takeSkill(this.actor, item);
  }

  /* A PC opens its own tree; an NPC opens the world tree. */
  static #onOpenTree() {
    SkillTree.open(this.document.type === "pc" ? this.document : null);
  }

  static #onOpenRoll(event, target) {
    const first = target.dataset.first === "skill"
      ? { kind: "skill", id: target.dataset.itemId }
      : { kind: "attribute", key: target.dataset.key };
    RollDialog.open(this.document, first, target);
  }

  static #onGroupAction() {
    startGroup(this.document);
  }

  static #onOpposedAction() {
    startOpposed(this.document);
  }

  static #onClashCheck(event, target) {
    startClashRoll(this.document, target);
  }
}
