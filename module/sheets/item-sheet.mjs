import ParadigmEngineSheet from "./mixin.mjs";
import { LADDER, SKILL_KINDS, costLabel } from "../config.mjs";
import { postItemCard } from "../chat.mjs";
import { foundationName, foundationOf, resolveRank } from "../skills.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;

export default class ParadigmEngineItemSheet extends ParadigmEngineSheet(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["item"],
    position: { width: 520, height: "auto" },
    actions: {
      flipBadge: this.#onFlipBadge,
      stepRank: this.#onStepRank,
      setKind: this.#onSetKind,
      postItem: this.#onPostItem
    }
  };

  static PARTS = {
    header: { template: "systems/paradigm-engine/templates/item/header.hbs" },
    body: { template: "systems/paradigm-engine/templates/item/body.hbs" }
  };

  /* Whether the Rank box shows its die face. Display state only, never stored. */
  #flipped = false;

  /* The post button in the title bar, beside the mode toggle. */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "postbtn";
    button.dataset.action = "postItem";
    button.dataset.tooltip = "PARADIGMENGINE.Chat.Post";
    button.ariaLabel = game.i18n.localize("PARADIGMENGINE.Chat.Post");
    button.innerHTML = '<i class="fa-solid fa-message"></i>';
    this.window.title.after(button);
    return frame;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    const system = item.system;
    const step = LADDER[system.prerequisite ? resolveRank(item) : system.rank];

    context.system = system;
    context.name = item.name;
    context.img = item.img;
    context.editMode = this.isEditMode;
    context.typeLabel = game.i18n.localize(`TYPES.Item.${item.type}`);
    context.badge = { text: this.#flipped ? step.die : step.rank, flipped: this.#flipped, cssVar: step.cssVar };
    context.rankLocked = !!system.prerequisite;
    context.kindLabel = game.i18n.localize(`PARADIGMENGINE.Skill.${system.kind}`);
    context.costLabel = costLabel({ kind: system.kind, rank: LADDER.indexOf(step), mastery: system.mastery });
    context.technique = system.kind === "Technique";
    context.kinds = SKILL_KINDS.map(key => ({
      key,
      label: game.i18n.localize(`PARADIGMENGINE.Skill.${key}`),
      on: system.kind === key
    }));
    if (system.prerequisite) {
      const foundation = foundationOf(item);
      const found = LADDER[foundation ? resolveRank(foundation) : 0];
      context.prerequisite = {
        name: foundationName(item),
        rank: found.rank,
        cssVar: found.cssVar,
        missing: !foundation
      };
    }
    context.enrichedText = await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.text, {
      relativeTo: item,
      secrets: item.isOwner
    });
    return context;
  }

  static #onFlipBadge() {
    this.#flipped = !this.#flipped;
    this.render({ parts: ["header"] });
  }

  static async #onStepRank(event, target) {
    if (!this.isEditable || this.document.system.prerequisite) return;
    const rank = Math.clamp(this.document.system.rank + Number(target.dataset.dir), 0, 5);
    await this.document.update({ "system.rank": rank });
  }

  static async #onSetKind(event, target) {
    if (!this.isEditable) return;
    const kind = target.dataset.kind;
    if (!SKILL_KINDS.includes(kind) || kind === this.document.system.kind) return;
    await this.document.update({ "system.kind": kind });
  }

  static async #onPostItem() {
    await postItemCard(this.document);
  }
}
