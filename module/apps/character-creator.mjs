import { ATTRIBUTES, LADDER } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STEP_LABELS = [
  "PROJECTANIME.Header.Character",
  "PROJECTANIME.Panel.Attributes",
  "PROJECTANIME.Panel.Traits",
  "PROJECTANIME.Panel.Techniques",
  "PROJECTANIME.Creator.Bond",
  "PROJECTANIME.Creator.Finishing"
];

const TRADE = { floor: 3, cap: 8, total: 17 };

/* Creator textareas are plain text; the items' Description fields hold HTML. */
export function paragraphs(text) {
  return text.split("\n").map(line => line.trim()).filter(line => line).map(line => {
    const p = document.createElement("p");
    p.textContent = line;
    return p.outerHTML;
  }).join("");
}

/* Reverse of paragraphs(), for seeding the creator textareas back from
   an item's stored Description. */
function plainLines(html) {
  const div = document.createElement("div");
  div.innerHTML = html ?? "";
  const lines = [...div.querySelectorAll("p")].map(p => p.textContent.trim()).filter(Boolean);
  return lines.length ? lines.join("\n") : div.textContent.trim();
}

/* The Character Creator wizard, opened from a character sheet's title
   bar. State seeds from the actor, and every change is kept on the actor
   flag "creator", so reopening resumes the selections instead of starting
   over. Create Character writes the opening actor and replaces the
   creator's own two Traits and two Techniques, never touching items added
   outside it. One creator per actor. */
export default class CharacterCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, ...options } = {}) {
    super(options);
    this.#actor = actor;
    this.#seed();
    this.#restore();
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "character-creator"],
    position: { width: 880, height: "auto" },
    actions: {
      goto: this.#onGoto,
      back: this.#onBack,
      next: this.#onNext,
      stepAttr: this.#onStepAttr,
      flipBadge: this.#onFlipBadge,
      setKind: this.#onSetKind,
      stepPool: this.#onStepPool,
      flipSeal: this.#onFlipSeal,
      rollLuck: this.#onRollLuck,
      create: this.#onCreate
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/character-creator.hbs" }
  };

  static #instances = new Map();

  #actor;

  #step = 0;

  #name = "";

  /* Attribute Ranks double as spent Step Ups: all start at E (0), cap C (2). */
  #attrs = { might: 0, agility: 0, mind: 0, spirit: 0, charm: 0 };

  #traits = [{ name: "", text: "" }, { name: "", text: "" }];

  #techs = [{ name: "", kind: "Activated", text: "" }, { name: "", kind: "Activated", text: "" }];

  #bond = { name: "" };

  /* The creation trade: Hearts, Energy, Move one for one, floor 3, cap 8,
     always totalling 17. */
  #pools = { hearts: 6, energy: 6, move: 5 };

  #luck = [null, null, null];

  #sealFlip = false;

  /* Which rank badges currently show their die or bonus face. Display state only. */
  #flipped = new Set();

  #creating = false;

  /* Items the seed read the Trait and Technique rows from; Create replaces them. */
  #seededIds = [];

  #dirty = false;

  #save = foundry.utils.debounce(() => this.#writeFlag(), 1000);

  /* Pre-fill from the actor: reopening the creator shows what is already
     there instead of a blank run. */
  #seed() {
    const actor = this.#actor;
    const system = actor.system;
    this.#name = actor.name ?? "";
    for (const key of Object.keys(this.#attrs)) {
      this.#attrs[key] = Math.clamp(system.attributes[key] ?? 0, 0, 2);
    }
    const traits = actor.itemTypes.trait;
    const techs = actor.itemTypes.technique;
    this.#seededIds = [...traits.slice(0, 2), ...techs.slice(0, 2)].map(item => item.id);
    this.#traits = this.#traits.map((row, i) => traits[i]
      ? { name: traits[i].name, text: plainLines(traits[i].system.text) }
      : row);
    this.#techs = this.#techs.map((row, i) => techs[i]
      ? {
        name: techs[i].name,
        kind: techs[i].system.kind === "Triggered" ? "Triggered" : "Activated",
        text: plainLines(techs[i].system.text)
      }
      : row);
    if (system.bonds[0]?.name) this.#bond.name = system.bonds[0].name;
    this.#pools = {
      hearts: Math.clamp(system.hearts.max ?? 6, TRADE.floor, TRADE.cap),
      energy: Math.clamp(system.energy.max ?? 6, TRADE.floor, TRADE.cap),
      move: Math.clamp(system.move ?? 5, TRADE.floor, TRADE.cap)
    };
    if (system.luck.length === 3 && system.luck.every(slot => slot.value >= 1)) {
      this.#luck = system.luck.map(slot => slot.value);
    }
  }

  /* The saved draft wins over the seed. */
  #restore() {
    const saved = this.#actor.getFlag("project-anime", "creator");
    if (!saved) return;
    if (typeof saved.name === "string") this.#name = saved.name;
    if (Number.isInteger(saved.step)) this.#step = Math.clamp(saved.step, 0, 5);
    for (const key of Object.keys(this.#attrs)) {
      if (Number.isInteger(saved.attrs?.[key])) this.#attrs[key] = Math.clamp(saved.attrs[key], 0, 2);
    }
    this.#traits = this.#traits.map((row, i) => ({
      name: typeof saved.traits?.[i]?.name === "string" ? saved.traits[i].name : row.name,
      text: typeof saved.traits?.[i]?.text === "string" ? saved.traits[i].text : row.text
    }));
    this.#techs = this.#techs.map((row, i) => {
      const kind = saved.techs?.[i]?.kind;
      return {
        name: typeof saved.techs?.[i]?.name === "string" ? saved.techs[i].name : row.name,
        kind: kind === "Triggered" || kind === "Activated" ? kind : row.kind,
        text: typeof saved.techs?.[i]?.text === "string" ? saved.techs[i].text : row.text
      };
    });
    if (typeof saved.bond?.name === "string") this.#bond.name = saved.bond.name;
    for (const key of Object.keys(this.#pools)) {
      if (Number.isInteger(saved.pools?.[key])) this.#pools[key] = Math.clamp(saved.pools[key], TRADE.floor, TRADE.cap);
    }
    if (Array.isArray(saved.luck) && saved.luck.length === 3) {
      this.#luck = saved.luck.map(v => (Number.isInteger(v) && v >= 1 && v <= 6 ? v : null));
    }
  }

  #snapshot() {
    return {
      step: this.#step,
      name: this.#name,
      attrs: { ...this.#attrs },
      traits: this.#traits.map(t => ({ ...t })),
      techs: this.#techs.map(t => ({ ...t })),
      bond: { ...this.#bond },
      pools: { ...this.#pools },
      luck: [...this.#luck]
    };
  }

  #touch() {
    this.#dirty = true;
    this.#save();
  }

  async #writeFlag() {
    if (!this.#dirty || !this.#actor.isOwner) return;
    this.#dirty = false;
    try {
      await this.#actor.setFlag("project-anime", "creator", this.#snapshot());
    } catch {
      /* The actor can be gone by the time the debounce fires. */
    }
  }

  static open(actor) {
    const existing = this.#instances.get(actor.uuid);
    if (existing) return existing.bringToFront();
    const creator = new this({ actor });
    this.#instances.set(actor.uuid, creator);
    creator.render(true);
  }

  get title() {
    return game.system.title;
  }

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    const dots = document.createElement("div");
    dots.className = "dots";
    for (let i = 0; i < 3; i++) dots.append(document.createElement("span"));
    this.window.title.before(dots);
    const sheetname = document.createElement("span");
    sheetname.className = "sheetname";
    sheetname.textContent = game.i18n.localize("PROJECTANIME.Creator.Title");
    this.window.title.after(sheetname);
    return frame;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const checks = this.#checks();
    const spent = this.#spent();

    context.obiName = this.#name.trim() || game.i18n.localize("PROJECTANIME.Creator.New");
    context.steps = STEP_LABELS.map((label, index) => ({
      index,
      n: index + 1,
      label: game.i18n.localize(label),
      active: index === this.#step,
      done: checks[index]
    }));
    context.active = STEP_LABELS.map((_, index) => index === this.#step);

    context.name = this.#name;
    context.stepUps = 5 - spent;
    context.attributes = ATTRIBUTES.map(a => {
      const rank = this.#attrs[a.key];
      return {
        key: a.key,
        name: game.i18n.localize(a.label),
        badge: this.#badge(`attributes.${a.key}`, rank, "die"),
        downDisabled: rank <= 0,
        upDisabled: rank >= 2 || spent >= 5
      };
    });
    context.traits = this.#traits.map((t, i) => ({ i, ...t, badge: this.#badge(`trait.${i}`, 1, "mod") }));
    context.techs = this.#techs.map((t, i) => ({
      i,
      ...t,
      activated: t.kind === "Activated",
      badge: this.#badge(`tech.${i}`, 0, "die"),
      costLabel: game.i18n.format("PROJECTANIME.Technique.Energy", { n: LADDER[0].mod })
    }));
    context.bond = { name: this.#bond.name, badge: this.#badge("bond", 0, "die") };
    context.seal = this.#sealFlip
      ? { text: String(LADDER[1].difficulty), label: game.i18n.localize("PROJECTANIME.Ladder.Difficulty") }
      : { text: LADDER[1].rank, label: game.i18n.localize("PROJECTANIME.Header.Rank") };
    const free = this.#free();
    context.free = free;
    context.pools = Object.fromEntries(Object.entries(this.#pools).map(([key, value]) => [key, {
      value,
      pips: Array(value).fill(true),
      downDisabled: value <= TRADE.floor,
      upDisabled: value >= TRADE.cap || free <= 0
    }]));
    context.luck = this.#luck.map(value => ({ value, filled: value !== null }));
    context.rolled = this.#luck.every(v => v !== null);

    context.position = game.i18n.format("PROJECTANIME.Creator.Position", { n: this.#step + 1, total: 6 });
    context.first = this.#step === 0;
    context.last = this.#step === 5;
    context.canCreate = checks.every(Boolean);
    return context;
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("input", this.#onInput.bind(this));
  }

  async _preClose(options) {
    await super._preClose(options);
    await this.#writeFlag();
  }

  _onClose(options) {
    super._onClose(options);
    if (CharacterCreator.#instances.get(this.#actor.uuid) === this) CharacterCreator.#instances.delete(this.#actor.uuid);
  }

  #spent() {
    return Object.values(this.#attrs).reduce((a, b) => a + b, 0);
  }

  #free() {
    return TRADE.total - this.#pools.hearts - this.#pools.energy - this.#pools.move;
  }

  #checks() {
    return [
      this.#name.trim().length > 0,
      this.#spent() === 5,
      this.#traits.every(t => t.name.trim().length > 0),
      this.#techs.every(t => t.name.trim().length > 0),
      this.#bond.name.trim().length > 0,
      this.#luck.every(v => v !== null) && this.#free() === 0
    ];
  }

  #badge(key, rankIndex, face) {
    const step = LADDER[rankIndex];
    const flipped = this.#flipped.has(key);
    const text = flipped ? (face === "mod" ? `+${step.mod}` : step.die) : step.rank;
    return { key, text, flipped, small: flipped && text.length > 3, cssVar: step.cssVar };
  }

  /* Text fields write straight into state; a render here would drop focus
     from the input being typed in, so the obi name, rail checks, and the
     Create button sync in place instead. */
  #onInput(event) {
    const el = event.target;
    if (!el.name) return;
    const [group, i, key] = el.name.split(".");
    if (group === "name") this.#name = el.value;
    else if (group === "bond" && i === "name") this.#bond.name = el.value;
    else if (group === "trait" || group === "tech") {
      const row = (group === "trait" ? this.#traits : this.#techs)[Number(i)];
      if (row && (key === "name" || key === "text")) row[key] = el.value;
    } else return;
    this.#touch();
    this.#syncLive();
  }

  #syncLive() {
    const checks = this.#checks();
    this.element.querySelector(".obi .cname").textContent =
      this.#name.trim() || game.i18n.localize("PROJECTANIME.Creator.New");
    this.element.querySelectorAll(".crail button").forEach((b, i) => b.classList.toggle("done", checks[i]));
    const create = this.element.querySelector('[data-action="create"]');
    if (create) create.disabled = !checks.every(Boolean);
  }

  #goto(step) {
    this.#step = Math.clamp(step, 0, 5);
    this.#touch();
    this.render();
  }

  static #onGoto(event, target) {
    this.#goto(Number(target.dataset.step));
  }

  static #onBack() {
    this.#goto(this.#step - 1);
  }

  static #onNext() {
    this.#goto(this.#step + 1);
  }

  static #onStepAttr(event, target) {
    const key = target.dataset.key;
    const dir = Number(target.dataset.dir);
    const rank = this.#attrs[key];
    if (rank === undefined) return;
    if (dir > 0 ? rank >= 2 || this.#spent() >= 5 : rank <= 0) return;
    this.#attrs[key] = rank + dir;
    this.#touch();
    this.render();
  }

  static #onFlipBadge(event, target) {
    const key = target.dataset.key;
    if (this.#flipped.has(key)) this.#flipped.delete(key);
    else this.#flipped.add(key);
    this.render();
  }

  static #onSetKind(event, target) {
    const row = this.#techs[Number(target.dataset.i)];
    if (!row) return;
    row.kind = target.dataset.kind === "Triggered" ? "Triggered" : "Activated";
    this.#touch();
    this.render();
  }

  static #onStepPool(event, target) {
    const key = target.dataset.pool;
    const dir = Number(target.dataset.dir);
    const value = this.#pools[key];
    if (value === undefined) return;
    if (dir > 0 ? value >= TRADE.cap || this.#free() <= 0 : value <= TRADE.floor) return;
    this.#pools[key] = value + dir;
    this.#touch();
    this.render();
  }

  static #onFlipSeal() {
    this.#sealFlip = !this.#sealFlip;
    this.render();
  }

  /* Rolled once through the Roll API, recorded, no chat message. */
  static async #onRollLuck() {
    if (this.#luck.every(v => v !== null)) return;
    const roll = await new foundry.dice.Roll("3d6").evaluate();
    this.#luck = roll.dice[0].results.map(r => r.result);
    this.#touch();
    this.render();
  }

  /* Safe to run again on a created character: grown Rank, extra Bonds,
     and Luck Die sizes survive, and only the rows the creator itself
     seeded or wrote before are replaced. */
  static async #onCreate() {
    if (this.#creating || !this.#checks().every(Boolean)) return;
    this.#creating = true;
    try {
      const actor = this.#actor;
      const source = actor.system.toObject();
      const luck = source.luck.length === 3
        ? source.luck.map((slot, i) => ({ ...slot, value: this.#luck[i], spent: false }))
        : this.#luck.map(value => ({ die: 6, value, spent: false }));
      const bonds = [
        { name: this.#bond.name.trim(), rank: source.bonds[0]?.rank ?? 0 },
        ...source.bonds.slice(1)
      ];
      await actor.update({
        name: this.#name.trim(),
        system: {
          rank: Math.max(source.rank, 1),
          attributes: { ...this.#attrs },
          hearts: { value: this.#pools.hearts, max: this.#pools.hearts },
          energy: { value: this.#pools.energy, max: this.#pools.energy },
          move: this.#pools.move,
          luck,
          bonds
        }
      });
      const mine = actor.items.filter(item => item.getFlag("project-anime", "creator")).map(item => item.id);
      const stale = [...new Set([...this.#seededIds, ...mine])].filter(id => actor.items.has(id));
      if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale);
      const flags = { "project-anime": { creator: true } };
      await actor.createEmbeddedDocuments("Item", [
        ...this.#traits.map(t => ({ name: t.name.trim(), type: "trait", system: { rank: 1, text: paragraphs(t.text) }, flags })),
        ...this.#techs.map(t => ({ name: t.name.trim(), type: "technique", system: { rank: 0, kind: t.kind, text: paragraphs(t.text) }, flags }))
      ]);
      await this.close();
      actor.sheet.render(true);
    } finally {
      this.#creating = false;
    }
  }
}
