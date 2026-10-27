import { cardOp, locked } from "../chat.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* Owned actors holding recorded, unspent Luck Dice. */
function luckHolders() {
  return game.actors
    .filter(a => a.isOwner && a.system.luck?.some(d => !d.spent && d.value > 0))
    .map(a => ({
      id: a.id,
      name: a.name,
      dice: a.system.luck
        .map((d, index) => ({ index, value: d.value, spent: d.spent }))
        .filter(d => !d.spent && d.value > 0)
    }));
}

/* The Spend Luck picker, opened from a die face on a roll card, or on a
   row of a shared card. Picking a die marks it spent on its owner (the
   spender's own actor), then the swap goes through the card relay. */
export default class LuckPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ message, dieIndex, row = null, ...options } = {}) {
    super(options);
    this.#message = message;
    this.#dieIndex = dieIndex;
    this.#row = row;
  }

  static DEFAULT_OPTIONS = {
    classes: ["paradigm-engine", "sheet", "luck-picker"],
    position: { width: 260, height: "auto" },
    actions: {
      pick: this.#onPick
    }
  };

  static PARTS = {
    body: { template: "systems/paradigm-engine/templates/apps/luck-picker.hbs" }
  };

  static #instance = null;

  #message;

  #dieIndex;

  #row;

  static open(message, dieIndex, row = null) {
    this.#instance?.close();
    this.#instance = new this({ message, dieIndex, row });
    this.#instance.render(true);
  }

  get title() {
    return game.i18n.localize("PARADIGMENGINE.Luck.Title");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.holders = luckHolders();
    return context;
  }

  /* A frameless popup has no window to shrink, so the closing animation
     core awaits would only run out its timeout; close at once. */
  close(options = {}) {
    return super.close({ animate: false, ...options });
  }

  _onClose(options) {
    super._onClose(options);
    if (LuckPicker.#instance === this) LuckPicker.#instance = null;
  }

  static async #onPick(event, target) {
    const actor = game.actors.get(target.dataset.actor);
    const index = Number(target.dataset.die);
    const die = actor?.system.luck[index];
    if (!die || die.spent || !die.value) return this.close();
    const message = this.#message;
    if (!message.canUserModify(game.user, "update") && !game.users.activeGM) return this.close();
    const luck = actor.system.luck.map(d => ({ ...d }));
    luck[index] = { ...luck[index], spent: true };
    await actor.update({ "system.luck": luck });
    await cardOp(message, { type: "luckSwap", dieIndex: this.#dieIndex, value: die.value, name: actor.name, row: this.#row });
    this.close();
  }
}

/* Face clicks on roll cards and on the rows of shared cards. */
export function registerLuck() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const flags = message.flags["paradigm-engine"];
    if (!flags?.card && !flags?.multi) return;
    if (!luckHolders().length) return;
    for (const face of html.querySelectorAll(".dicerow .face")) {
      const rowEl = face.closest("[data-row]");
      const row = rowEl ? Number(rowEl.dataset.row) : null;
      const card = row === null ? flags.card : flags.multi?.rows[row]?.card;
      if (!card || locked(card)) continue;
      face.classList.add("spendable");
      face.addEventListener("click", () => LuckPicker.open(message, Number(face.dataset.index), row));
    }
  });
}
