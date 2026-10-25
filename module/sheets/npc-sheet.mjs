import BaseActorSheet from "./base-actor-sheet.mjs";
import NpcBuilder from "../apps/npc-builder.mjs";

export default class NpcSheet extends BaseActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ["npc"],
    position: { width: 920, height: 760 },
    actions: {
      openBuilder: this.#onOpenBuilder
    }
  };

  static PARTS = {
    header: { template: "systems/paradigm-engine/templates/actor/header.hbs" },
    main: { template: "systems/paradigm-engine/templates/actor/npc-main.hbs" }
  };

  /* The NPC Builder button in the title bar, beside the mode
     toggle. Storyteller only. */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    if (this.isEditable && game.user.isGM) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "creatorbtn";
      button.dataset.action = "openBuilder";
      button.dataset.tooltip = "PARADIGMENGINE.Builder.Title";
      button.setAttribute("aria-label", game.i18n.localize("PARADIGMENGINE.Builder.Title"));
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-skull";
      icon.inert = true;
      button.append(icon);
      this.window.title.after(button);
    }
    return frame;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.eyebrow = game.i18n.localize("TYPES.Actor.npc");
    context.showLuck = false;
    return context;
  }

  static #onOpenBuilder() {
    if (!this.isEditable || !game.user.isGM) return;
    NpcBuilder.open(this.document);
  }
}
