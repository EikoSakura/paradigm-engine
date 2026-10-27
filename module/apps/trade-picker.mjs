import { cardOp, locked } from "../chat.mjs";
import { clashRolls } from "../apps/clash.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* The Trade picker, opened from the Trade button on a Clash roll card.
   It lists the other rolls of this Clash, any side, with their dice: pick
   one of your own, then one of theirs, and the two swap through the card
   relay. */
export default class TradePicker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ message, ...options } = {}) {
    super(options);
    this.#message = message;
  }

  static DEFAULT_OPTIONS = {
    classes: ["paradigm-engine", "sheet", "luck-picker", "trade-picker"],
    position: { width: 300, height: "auto" },
    actions: {
      mine: this.#onMine,
      pick: this.#onPick
    }
  };

  static PARTS = {
    body: { template: "systems/paradigm-engine/templates/apps/trade-picker.hbs" }
  };

  static #instance = null;

  #message;

  #mine = 0;

  static open(message) {
    this.#instance?.close();
    this.#instance = new this({ message });
    this.#instance.render(true);
  }

  get title() {
    return game.i18n.localize("PARADIGMENGINE.Clash.Trade");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const flags = this.#message.flags["paradigm-engine"] ?? {};
    const card = flags.card;
    context.mine = card.faces.map((value, index) => ({ value, index, on: index === this.#mine }));
    context.others = clashRolls(flags.clash?.clashId)
      .filter(m => m.id !== this.#message.id)
      .map(m => {
        const other = m.flags["paradigm-engine"].card;
        return {
          id: m.id,
          name: m.speaker?.alias || m.author?.name || "",
          off: locked(other),
          dice: other.faces.map((value, index) => ({ value, index }))
        };
      });
    return context;
  }

  close(options = {}) {
    return super.close({ animate: false, ...options });
  }

  _onClose(options) {
    super._onClose(options);
    if (TradePicker.#instance === this) TradePicker.#instance = null;
  }

  static #onMine(event, target) {
    this.#mine = Number(target.dataset.index);
    this.render();
  }

  static async #onPick(event, target) {
    const message = this.#message;
    const other = game.messages.get(target.dataset.id);
    if (!other) return this.close();
    if (!game.user.isGM && !game.users.activeGM) return this.close();
    await cardOp(message, { type: "trade", dieIndex: this.#mine, otherId: other.id, otherIndex: Number(target.dataset.index) });
    this.close();
  }
}
