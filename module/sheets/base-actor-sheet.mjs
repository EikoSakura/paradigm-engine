import ProjectAnimeSheet from "./mixin.mjs";
import { LADDER, ATTRIBUTES } from "../config.mjs";
import { postItemCard } from "../chat.mjs";
import RollDialog from "../apps/roll-dialog.mjs";
import { openItemArea } from "../apps/area.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;

export default class BaseActorSheet extends ProjectAnimeSheet(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["actor"],
    position: { width: 880, height: 920 },
    actions: {
      flipBadge: this.#onFlipBadge,
      setPip: this.#onSetPip,
      toggleLuck: this.#onToggleLuck,
      stepRank: this.#onStepRank,
      stepMax: this.#onStepMax,
      stepMove: this.#onStepMove,
      createItem: this.#onCreateItem,
      openItem: this.#onOpenItem,
      deleteItem: this.#onDeleteItem,
      postItem: this.#onPostItem,
      openRoll: this.#onOpenRoll,
      openArea: this.#onOpenArea
    }
  };

  static FORM_ARRAYS = ["luck"];

  /* Stepper bounds for the pool maxes and Move: free range, floor 0.
     The 3..8 creation trade lives in the Character Creator alone. */
  static BOUNDS = { points: { min: 0, max: Infinity }, move: { min: 0, max: Infinity } };

  /* Which rank badges currently show their die or bonus face. Display state only, never stored. */
  #flipped = new Set();

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    const rank = LADDER[system.rank];

    context.system = system;
    context.editMode = this.isEditMode;
    context.name = this.document.name;
    context.img = this.document.img;
    context.portrait = this.document.img === foundry.documents.BaseActor.DEFAULT_ICON ? "" : this.document.img;
    context.initial = (this.document.name || "?").trim().charAt(0).toUpperCase() || "?";
    context.rank = { letter: rank.rank, number: rank.difficulty, cssVar: rank.cssVar };
    context.hearts = { ...system.hearts, pips: BaseActorSheet.#pips(system.hearts) };
    context.energy = { ...system.energy, pips: BaseActorSheet.#pips(system.energy) };
    context.move = system.move;
    context.luck = system.luck.map(slot => ({
      ...slot,
      stateLabel: game.i18n.localize(slot.spent ? "PROJECTANIME.Vitals.Spent" : "PROJECTANIME.Vitals.Ready")
    }));
    context.showLuck = true;
    context.showRivalToggle = false;
    context.attributes = ATTRIBUTES.map(a => ({
      key: a.key,
      name: game.i18n.localize(a.label),
      desc: game.i18n.localize(a.desc),
      badge: this._badge(`attributes.${a.key}`, system.attributes[a.key], "die")
    }));
    context.ladder = LADDER;
    context.traits = await this.#prepareItems("trait");
    context.techniques = await this.#prepareItems("technique");
    context.dieOptions = { 6: "d6", 8: "d8", 10: "d10", 12: "d12" };
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

  async #prepareItems(type) {
    const items = [...this.document.itemTypes[type]].sort((a, b) => a.sort - b.sort);
    const isTechnique = type === "technique";
    return Promise.all(items.map(async item => {
      const step = LADDER[item.system.rank];
      const card = {
        id: item.id,
        name: item.name,
        area: item.system.area,
        rulings: item.system.rulings,
        badge: this._badge(`${type}.${item.id}`, item.system.rank, isTechnique ? "die" : "mod"),
        enrichedText: await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.text, {
          relativeTo: item,
          secrets: this.document.isOwner
        })
      };
      if (isTechnique) {
        card.kindLabel = game.i18n.localize(`PROJECTANIME.Technique.${item.system.kind}`);
        card.costLabel = game.i18n.format("PROJECTANIME.Technique.Energy", { n: step.mod });
        card.activated = item.system.kind === "Activated";
      }
      return card;
    }));
  }

  static #pips({ value, max }) {
    return Array.from({ length: max }, (_, i) => i < value);
  }

  _badge(key, rankIndex, face) {
    const step = LADDER[rankIndex];
    const flipped = this.#flipped.has(key);
    const text = flipped ? (face === "mod" ? `+${step.mod}` : step.die) : step.rank;
    return { key, text, flipped, small: flipped && text.length > 3, cssVar: step.cssVar };
  }

  static #onFlipBadge(event, target) {
    const key = target.dataset.key;
    if (this.#flipped.has(key)) this.#flipped.delete(key);
    else this.#flipped.add(key);
    this.render({ parts: ["main"] });
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

  static async #onStepMove(event, target) {
    if (!this.isEditable) return;
    const bounds = this.constructor.BOUNDS.move;
    const move = Math.min(bounds.max, Math.max(bounds.min, this.document.system.move + Number(target.dataset.dir)));
    await this.document.update({ "system.move": move });
  }

  static async #onCreateItem(event, target) {
    if (!this.isEditable) return;
    const type = target.dataset.type;
    if (type !== "trait" && type !== "technique") return;
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

  static #onOpenRoll(event, target) {
    const first = target.dataset.first === "technique"
      ? { kind: "technique", id: target.dataset.itemId }
      : { kind: "attribute", key: target.dataset.key };
    RollDialog.open(this.document, first);
  }

  static #onOpenArea(event, target) {
    const item = this.document.items.get(target.dataset.itemId);
    if (item) openItemArea(item);
  }
}
