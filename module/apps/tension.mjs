/* The Tension meter: a world number 0 to 6 drawn as six beni diamond
   slots docked top center over the board on every client. The
   Storyteller's slot clicks and the GM-only gain chips on roll cards are
   the only writers. */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const CAP = 6;

let meter = null;

export function registerTension() {
  game.settings.register("paradigm-engine", "tension", {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    onChange: () => {
      meter?.render();
      refreshChips();
    }
  });
  game.settings.register("paradigm-engine", "tensionAnnounce", {
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });
  game.settings.register("paradigm-engine", "tensionAuto", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  game.settings.registerMenu("paradigm-engine", "tensionMenu", {
    name: "PARADIGMENGINE.Tension.Menu",
    label: "PARADIGMENGINE.Tension.Configure",
    icon: "fa-solid fa-gears",
    type: TensionSettings,
    restricted: true
  });
  Hooks.once("ready", () => {
    meter = new TensionMeter();
    meter.render(true);
  });
  Hooks.on("renderChatMessageHTML", renderChip);
  Hooks.on("createChatMessage", autoGain);
}

/* The meter: every client renders it, only the Storyteller's clicks
   write. A slot click sets Tension to that slot; a click on the current
   top slot drops it by one. */
class TensionMeter extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tension-meter",
    window: { frame: false, positioned: false },
    actions: {
      setSlot: this.#onSetSlot
    }
  };

  static PARTS = {
    meter: { template: "systems/paradigm-engine/templates/apps/tension-meter.hbs" }
  };

  /* The meter stays open through play. */
  async close(options) {
    return this;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const value = game.settings.get("paradigm-engine", "tension");
    context.slots = Array.from({ length: CAP }, (_, i) => i < value);
    return context;
  }

  static async #onSetSlot(event, target) {
    if (!game.user.isGM) return;
    const i = Number(target.dataset.i);
    const value = game.settings.get("paradigm-engine", "tension");
    await game.settings.set("paradigm-engine", "tension", i + 1 === value ? i : i + 1);
  }
}

/* All the Tension options in one window, reached from System Settings. */
class TensionSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tension-settings",
    classes: ["paradigm-engine", "sheet", "tension-settings"],
    tag: "form",
    position: { width: 380, height: "auto" },
    form: {
      handler: this.#onSubmit,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    body: { template: "systems/paradigm-engine/templates/apps/tension-settings.hbs" }
  };

  get title() {
    return game.i18n.localize("PARADIGMENGINE.Tension.Menu");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.announce = game.settings.get("paradigm-engine", "tensionAnnounce");
    context.auto = game.settings.get("paradigm-engine", "tensionAuto");
    return context;
  }

  static async #onSubmit(event, form, formData) {
    await game.settings.set("paradigm-engine", "tensionAnnounce", !!formData.object.announce);
    await game.settings.set("paradigm-engine", "tensionAuto", !!formData.object.auto);
  }
}

async function announce(key, data) {
  if (!game.settings.get("paradigm-engine", "tensionAnnounce")) return;
  await ChatMessage.implementation.create({
    content: `<div class="pe-tline">${game.i18n.format(`PARADIGMENGINE.Tension.${key}`, data)}</div>`
  });
}

/* Gain n Tension, clamped at the cap; a Fumble pays 2. */
async function gainTension(n = 1) {
  const value = game.settings.get("paradigm-engine", "tension");
  if (value >= CAP) return;
  const gained = Math.min(n, CAP - value);
  await game.settings.set("paradigm-engine", "tension", value + gained);
  await announce("GainLine", { n: gained });
}

/* The GM's gain chip, swapped in over a roll card's Tension rider line.
   The applied state rides the message as a flag so the chip stays spent
   on every later render. */
function renderChip(message, html) {
  if (!game.user.isGM) return;
  const rider = html.querySelector('.pe-card [data-rider="Tension"], .pe-card [data-rider="Tension2"]');
  if (!rider) return;
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "tchip";
  chip.dataset.n = rider.dataset.rider === "Tension2" ? 2 : 1;
  if (message.getFlag("paradigm-engine", "tensionApplied")) {
    chip.classList.add("done");
    chip.disabled = true;
    chip.textContent = game.i18n.localize("PARADIGMENGINE.Tension.Gained");
  } else {
    setChipState(chip, game.settings.get("paradigm-engine", "tension") >= CAP);
    chip.addEventListener("click", () => applyChip(message, chip));
  }
  rider.replaceChildren(chip);
}

function setChipState(chip, full) {
  chip.classList.toggle("full", full);
  chip.disabled = full;
  chip.textContent = game.i18n.localize(full ? "PARADIGMENGINE.Tension.Full"
    : chip.dataset.n === "2" ? "PARADIGMENGINE.Tension.Raise2" : "PARADIGMENGINE.Tension.Raise");
}

/* Unspent chips already on screen follow the value: 6 locks, room unlocks. */
function refreshChips() {
  const full = game.settings.get("paradigm-engine", "tension") >= CAP;
  for (const chip of document.querySelectorAll(".pe-card .tchip:not(.done)")) setChipState(chip, full);
}

async function applyChip(message, chip) {
  if (message.getFlag("paradigm-engine", "tensionApplied")) return;
  if (game.settings.get("paradigm-engine", "tension") >= CAP) return;
  chip.classList.add("done");
  chip.disabled = true;
  chip.textContent = game.i18n.localize("PARADIGMENGINE.Tension.Gained");
  await message.setFlag("paradigm-engine", "tensionApplied", true);
  await gainTension(Number(chip.dataset.n) || 1);
}

/* With Auto Gain on, the active GM's client applies a roll card's Tension
   rider as the card lands, and the chip reads Gained. A full track leaves
   the chip live for a later click. */
async function autoGain(message) {
  if (game.users.activeGM?.isSelf !== true) return;
  if (!game.settings.get("paradigm-engine", "tensionAuto")) return;
  const difficulty = message.getFlag("paradigm-engine", "card")?.difficulty;
  const band = difficulty?.band;
  if (!band || band === "Critical" || difficulty.adversary) return;
  if (message.getFlag("paradigm-engine", "tensionApplied")) return;
  if (game.settings.get("paradigm-engine", "tension") >= CAP) return;
  await message.setFlag("paradigm-engine", "tensionApplied", true);
  await gainTension(band === "Fumble" ? 2 : 1);
}
