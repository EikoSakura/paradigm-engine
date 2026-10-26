import { ATTRIBUTES, LADDER, SKILL_KINDS, costLabel } from "../config.mjs";
import { startingSkillRow } from "../starting-skills.mjs";
import { copyOf, emptyPick, paragraphs, pickFrom, plainLines, treeRoots } from "./pc-creator.mjs";
import SkillTree from "./skill-tree.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* The three cards, in order; the rail at the top names them. */
const CARDS = [
  { key: "attributes", label: "PARADIGMENGINE.Panel.Attributes" },
  { key: "skills", label: "PARADIGMENGINE.Panel.Skills" },
  { key: "finishing", label: "PARADIGMENGINE.Creator.HeartsEnergy" }
];

/* Attributes: five points, each from E up to A, as a PC's. */
const ATTR_POINTS = 5;
const ATTR_CAP = 4;

/* Hearts and Energy: eight points between them, as a PC's. */
const POOL_POINTS = 8;

/* The NPC Builder, opened by the Storyteller from an NPC File's title
   bar: one scrolling file on the skin, built like the PC Creator so an
   NPC starts where a PC does. Attributes spend five points, Skills are
   two at Rank E, Hearts and Energy split eight points, and the Rank is
   set freely. State
   seeds from the actor and drafts to the actor flag "builder", so
   reopening resumes. Create NPC writes the actor and replaces the
   builder's own Skills, never touching items added outside it. One
   builder per actor. */
export default class NpcBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, ...options } = {}) {
    super(options);
    this.#actor = actor;
    this.#seed();
    this.#restore();
  }

  static DEFAULT_OPTIONS = {
    classes: ["paradigm-engine", "npc-builder"],
    position: { width: 860, height: 760 },
    window: { resizable: true },
    actions: {
      goto: this.#onGoto,
      stepAttr: this.#onStepAttr,
      flipBadge: this.#onFlipBadge,
      setKind: this.#onSetKind,
      openTree: this.#onOpenTree,
      takeSkill: this.#onTakeSkill,
      stepPool: this.#onStepPool,
      stepRank: this.#onStepRank,
      flipStamp: this.#onFlipStamp,
      create: this.#onCreate
    }
  };

  static PARTS = {
    body: { template: "systems/paradigm-engine/templates/apps/npc-builder.hbs" }
  };

  static #instances = new Map();

  #actor;

  #name = "";

  #rank = 1;

  #attrs = { might: 0, agility: 0, mind: 0, spirit: 0, charm: 0 };

  #skills = [emptyPick(), emptyPick()];

  #pools = { hearts: 4, energy: 4 };

  /* Which rank badges currently show their die face, and whether the
     stamp reads the Difficulty. Display state only. */
  #flipped = new Set();

  #stampFlip = false;

  #creating = false;

  /* Items the seed read the Skill rows from; Create replaces them. */
  #seededIds = [];

  #dirty = false;

  #save = foundry.utils.debounce(() => this.#writeFlag(), 1000);

  /* Pre-fill from the actor: reopening the builder shows what is already
     there instead of a blank run. */
  #seed() {
    const actor = this.#actor;
    const system = actor.system;
    this.#name = actor.name ?? "";
    this.#rank = Math.clamp(system.rank ?? 1, 0, 5);
    for (const key of Object.keys(this.#attrs)) {
      this.#attrs[key] = Math.clamp(system.attributes[key] ?? 0, 0, ATTR_CAP);
    }
    const skills = actor.itemTypes.skill;
    this.#seededIds = skills.slice(0, 2).map(item => item.id);
    this.#skills = this.#skills.map((row, i) => skills[i]
      ? {
        name: skills[i].name,
        kind: SKILL_KINDS.includes(skills[i].system.kind) ? skills[i].system.kind : "Technique",
        text: plainLines(skills[i].system.text),
        source: skills[i].system.source
      }
      : row);
    const hearts = Math.clamp(system.hearts.max ?? 4, 0, POOL_POINTS);
    this.#pools = { hearts, energy: Math.clamp(system.energy.max ?? 4, 0, POOL_POINTS - hearts) };
  }

  /* The saved draft wins over the seed. */
  #restore() {
    const saved = this.#actor.getFlag("paradigm-engine", "builder");
    if (!saved) return;
    if (typeof saved.name === "string") this.#name = saved.name;
    if (Number.isInteger(saved.rank)) this.#rank = Math.clamp(saved.rank, 0, 5);
    for (const key of Object.keys(this.#attrs)) {
      if (Number.isInteger(saved.attrs?.[key])) this.#attrs[key] = Math.clamp(saved.attrs[key], 0, ATTR_CAP);
    }
    this.#skills = this.#skills.map((row, i) => {
      const kind = saved.skills?.[i]?.kind;
      return {
        name: typeof saved.skills?.[i]?.name === "string" ? saved.skills[i].name : row.name,
        kind: SKILL_KINDS.includes(kind) ? kind : row.kind,
        text: typeof saved.skills?.[i]?.text === "string" ? saved.skills[i].text : row.text,
        source: typeof saved.skills?.[i]?.source === "string" ? saved.skills[i].source : row.source
      };
    });
    if (Number.isInteger(saved.pools?.hearts) && Number.isInteger(saved.pools?.energy)) {
      const hearts = Math.clamp(saved.pools.hearts, 0, POOL_POINTS);
      this.#pools = { hearts, energy: Math.clamp(saved.pools.energy, 0, POOL_POINTS - hearts) };
    }
  }

  #snapshot() {
    return {
      name: this.#name,
      rank: this.#rank,
      attrs: { ...this.#attrs },
      skills: this.#skills.map(t => ({ ...t })),
      pools: { ...this.#pools }
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
      await this.#actor.setFlag("paradigm-engine", "builder", this.#snapshot());
    } catch {
      /* The actor can be gone by the time the debounce fires. */
    }
  }

  static open(actor) {
    if (!game.user.isGM) return;
    const existing = this.#instances.get(actor.uuid);
    if (existing) return existing.bringToFront();
    const builder = new this({ actor });
    this.#instances.set(actor.uuid, builder);
    builder.render(true);
  }

  get title() {
    return game.i18n.localize("PARADIGMENGINE.Builder.Title");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const checks = this.#checks();
    const left = ATTR_POINTS - this.#spent();

    context.name = this.#name;
    context.rail = CARDS.map((card, i) => ({
      key: card.key,
      n: i + 1,
      label: game.i18n.localize(card.label),
      done: checks[card.key]
    }));

    context.attrLeft = left;
    context.attributes = ATTRIBUTES.map(a => {
      const rank = this.#attrs[a.key];
      return {
        key: a.key,
        name: game.i18n.localize(a.label),
        badge: this.#badge(`attributes.${a.key}`, rank),
        die: LADDER[rank].die,
        downDisabled: rank <= 0,
        upDisabled: rank >= ATTR_CAP || left <= 0
      };
    });
    context.skills = this.#skills.map((t, i) => ({
      i,
      ...t,
      locked: !!t.source,
      technique: t.kind === "Technique",
      kindLabel: game.i18n.localize(`PARADIGMENGINE.Skill.${t.kind}`),
      badge: this.#badge(`skill.${i}`, 0),
      costLabel: costLabel({ kind: t.kind, rank: 0 })
    }));
    const sources = new Set(this.#skills.map(t => t.source).filter(Boolean));
    context.tree = treeRoots().map(item => ({ ...startingSkillRow(item), taken: sources.has(item.uuid) }));

    const free = this.#free();
    context.poolLeft = free;
    context.pools = Object.fromEntries(Object.entries(this.#pools).map(([key, value]) => [key, {
      value,
      pips: Array.from({ length: POOL_POINTS }, (_, i) => i < value),
      downDisabled: value <= 0,
      upDisabled: free <= 0
    }]));

    const step = LADDER[this.#rank];
    context.stamp = this.#stampFlip
      ? { text: String(step.difficulty), label: game.i18n.localize("PARADIGMENGINE.Ladder.Difficulty") }
      : { text: step.rank, label: game.i18n.localize("PARADIGMENGINE.Header.Rank") };
    context.rankDownDisabled = this.#rank <= 0;
    context.rankUpDisabled = this.#rank >= 5;

    context.todo = this.#todo(checks);
    context.canCreate = this.#complete(checks);
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".sk",
      permissions: { drop: () => this.#actor.isOwner },
      callbacks: { drop: this.#onDrop.bind(this) }
    }).bind(this.element);
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
    if (NpcBuilder.#instances.get(this.#actor.uuid) === this) NpcBuilder.#instances.delete(this.#actor.uuid);
  }

  #spent() {
    return Object.values(this.#attrs).reduce((a, b) => a + b, 0);
  }

  #free() {
    return POOL_POINTS - this.#pools.hearts - this.#pools.energy;
  }

  #checks() {
    return {
      name: this.#name.trim().length > 0,
      attributes: this.#spent() === ATTR_POINTS,
      skills: this.#skills.every(t => t.name.trim().length > 0),
      finishing: this.#free() === 0
    };
  }

  #complete(checks) {
    return Object.values(checks).every(Boolean);
  }

  #todo(checks) {
    return [
      ["name", "PARADIGMENGINE.Header.Name"],
      ["attributes", "PARADIGMENGINE.Panel.Attributes"],
      ["skills", "PARADIGMENGINE.Panel.Skills"],
      ["finishing", "PARADIGMENGINE.Creator.HeartsEnergy"]
    ].map(([key, label]) => ({ key, label: game.i18n.localize(label), done: checks[key] }));
  }

  #badge(key, rankIndex) {
    const step = LADDER[rankIndex];
    const flipped = this.#flipped.has(key);
    const text = flipped ? step.die : step.rank;
    return { key, text, flipped, small: flipped && text.length > 3, cssVar: step.cssVar };
  }

  /* Text fields write straight into state; a render here would drop focus
     from the input being typed in, so the rail, the checklist, and the
     Create button sync in place instead. */
  #onInput(event) {
    const el = event.target;
    if (!el.name) return;
    const [group, i, key] = el.name.split(".");
    if (group === "name") this.#name = el.value;
    else if (group === "skill") {
      const row = this.#skills[Number(i)];
      if (row && !row.source && (key === "name" || key === "text")) row[key] = el.value;
    } else return;
    this.#touch();
    this.#syncLive();
  }

  #syncLive() {
    const checks = this.#checks();
    const root = this.element;
    root.querySelectorAll(".rail button").forEach(b => b.classList.toggle("done", checks[b.dataset.card]));
    root.querySelectorAll(".todo span").forEach(s => s.classList.toggle("done", checks[s.dataset.key]));
    const create = root.querySelector('[data-action="create"]');
    if (create) create.disabled = !this.#complete(checks);
  }

  /* The rail scrolls the file to its card. */
  static #onGoto(event, target) {
    this.element.querySelector(`.card.${target.dataset.card}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  static #onStepAttr(event, target) {
    const key = target.dataset.key;
    const dir = Number(target.dataset.dir);
    const rank = this.#attrs[key];
    if (rank === undefined) return;
    if (dir > 0 ? rank >= ATTR_CAP || this.#spent() >= ATTR_POINTS : rank <= 0) return;
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
    const row = this.#skills[Number(target.dataset.i)];
    if (!row || row.source) return;
    row.kind = target.dataset.kind === "Talent" ? "Talent" : "Technique";
    this.#touch();
    this.render();
  }

  static #onOpenTree() {
    SkillTree.open(this.#actor);
  }

  /* Take from the tree fills the next empty pick, or the first one not
     already from a world Skill; Taken clears the pick it filled. */
  static #onTakeSkill(event, target) {
    const uuid = target.dataset.uuid;
    const held = this.#skills.findIndex(t => t.source === uuid);
    if (held >= 0) {
      this.#skills[held] = emptyPick();
    } else {
      const item = fromUuidSync(uuid, { strict: false });
      if (!(item instanceof Item) || item.type !== "skill") return;
      let slot = this.#skills.findIndex(t => !t.source && !t.name.trim());
      if (slot < 0) slot = this.#skills.findIndex(t => !t.source);
      if (slot < 0) return;
      this.#skills[slot] = pickFrom(item);
    }
    this.#touch();
    this.render();
  }

  static #onStepPool(event, target) {
    const key = target.dataset.pool;
    const dir = Number(target.dataset.dir);
    const value = this.#pools[key];
    if (value === undefined) return;
    if (dir > 0 ? this.#free() <= 0 : value <= 0) return;
    this.#pools[key] = value + dir;
    this.#touch();
    this.render();
  }

  static #onStepRank(event, target) {
    this.#rank = Math.clamp(this.#rank + Number(target.dataset.dir), 0, 5);
    this.#touch();
    this.render();
  }

  static #onFlipStamp() {
    this.#stampFlip = !this.#stampFlip;
    this.render();
  }

  /* A Skill dropped on a pick fills it. */
  async #onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const slot = event.currentTarget.closest(".sk");
    if (!slot || data.type !== "Item") return;
    const item = await Item.implementation.fromDropData(data);
    if (!item || item.type !== "skill" || item.parent === this.#actor) return;
    const i = Number(slot.dataset.i);
    if (!(i in this.#skills)) return;
    this.#skills[i] = pickFrom(item);
    this.#touch();
    this.render();
  }

  /* Safe to run again on a built NPC: only the Skills the builder itself
     seeded or wrote before are replaced. */
  static async #onCreate() {
    if (this.#creating || !this.#complete(this.#checks())) return;
    this.#creating = true;
    try {
      const actor = this.#actor;
      await actor.update({
        name: this.#name.trim(),
        system: {
          rank: this.#rank,
          attributes: { ...this.#attrs },
          hearts: { value: this.#pools.hearts, max: this.#pools.hearts },
          energy: { value: this.#pools.energy, max: this.#pools.energy }
        }
      });
      const mine = actor.items.filter(item => item.getFlag("paradigm-engine", "builder")).map(item => item.id);
      const stale = [...new Set([...this.#seededIds, ...mine])].filter(id => actor.items.has(id));
      if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale);
      const flags = { "paradigm-engine": { builder: true } };
      const picks = this.#skills.map(t => {
        const item = t.source ? fromUuidSync(t.source, { strict: false }) : null;
        if (item instanceof Item && item.type === "skill") {
          const data = copyOf(item, { builder: true });
          data.system.rank = 0;
          return data;
        }
        return {
          name: t.name.trim(),
          type: "skill",
          system: { rank: 0, kind: t.kind, text: paragraphs(t.text) },
          flags
        };
      });
      await actor.createEmbeddedDocuments("Item", picks);
      await this.close();
      actor.sheet.render(true);
    } finally {
      this.#creating = false;
    }
  }
}
