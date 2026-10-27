import { ATTRIBUTES, LADDER, SKILL_KINDS, costLabel } from "../config.mjs";
import { readStartingChoice, readStartingSkills, startingSkillRow } from "../starting-skills.mjs";
import SkillTree from "./skill-tree.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* The five cards, in order; the rail at the top names them. */
const CARDS = [
  { key: "attributes", label: "PARADIGMENGINE.Panel.Attributes" },
  { key: "skills", label: "PARADIGMENGINE.Panel.Skills" },
  { key: "bond", label: "PARADIGMENGINE.Creator.Bond" },
  { key: "luck", label: "PARADIGMENGINE.Vitals.LuckDice" },
  { key: "finishing", label: "PARADIGMENGINE.Creator.Finishing" }
];

/* Attributes: five points, each from E up to C. */
const ATTR_POINTS = 5;
const ATTR_CAP = 2;

/* Skills: five points, one to make a Skill at E and one per Rank Up,
   at least one Skill, none above C. */
const SKILL_POINTS = 5;
const SKILL_CAP = 2;

/* Finishing Touches: eight points between Hearts and Energy. */
const POOL_POINTS = 8;

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
export function plainLines(html) {
  const div = document.createElement("div");
  div.innerHTML = html ?? "";
  const lines = [...div.querySelectorAll("p")].map(p => p.textContent.trim()).filter(Boolean);
  return lines.length ? lines.join("\n") : div.textContent.trim();
}

export function emptyPick() {
  return { name: "", kind: "Technique", text: "", source: "", rank: 0 };
}

/* A pick filled from a world Skill: the tree's, or one dropped in. */
export function pickFrom(item) {
  return {
    name: item.name,
    kind: SKILL_KINDS.includes(item.system.kind) ? item.system.kind : "Technique",
    text: plainLines(item.system.text),
    source: item.system.source || item.uuid,
    rank: 0
  };
}

/* The Skill Tree's roots, the Skills a new PC can take. */
export function treeRoots() {
  return game.items
    .filter(i => i.type === "skill" && i.system.inTree && !i.system.prerequisite)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/* A world Skill's data, ready to land on the PC. */
export function copyOf(item, flags) {
  const data = item.inCompendium ? game.items.fromCompendium(item, { clearFolder: true }) : item.toObject();
  delete data._id;
  data.system.source = item.system.source || item.uuid;
  data.flags = { ...data.flags, "paradigm-engine": { ...(data.flags?.["paradigm-engine"] ?? {}), ...flags } };
  return data;
}

/* The PC Creator, opened from a PC File's title bar: one scrolling file
   on the skin, the name in the header and five cards under it. State
   seeds from the actor, and every change is kept on the actor flag
   "creator", so reopening resumes the selections instead of starting
   over. Create PC writes the opening actor and replaces the creator's
   own two Skills, never touching items added outside it. One creator
   per actor. */
export default class PcCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, ...options } = {}) {
    super(options);
    this.#actor = actor;
    this.#seed();
    this.#restore();
  }

  static DEFAULT_OPTIONS = {
    classes: ["paradigm-engine", "pc-creator"],
    position: { width: 860, height: 760 },
    window: { resizable: true },
    actions: {
      goto: this.#onGoto,
      stepAttr: this.#onStepAttr,
      flipBadge: this.#onFlipBadge,
      setKind: this.#onSetKind,
      openTree: this.#onOpenTree,
      takeSkill: this.#onTakeSkill,
      stepSkill: this.#onStepSkill,
      addSkill: this.#onAddSkill,
      removeSkill: this.#onRemoveSkill,
      choose: this.#onChoose,
      stepPool: this.#onStepPool,
      rollLuck: this.#onRollLuck,
      create: this.#onCreate
    }
  };

  static PARTS = {
    body: { template: "systems/paradigm-engine/templates/apps/pc-creator.hbs" }
  };

  static #instances = new Map();

  #actor;

  #name = "";

  /* Attribute Ranks double as spent points: all start at E (0), cap C (2). */
  #attrs = { might: 0, agility: 0, mind: 0, spirit: 0, charm: 0 };

  #skills = [emptyPick()];

  /* UUIDs picked from the Choice list. */
  #choice = [];

  #bond = { name: "", relation: "" };

  #pools = { hearts: 4, energy: 4 };

  #luck = [null, null, null];

  /* Which rank badges currently show their die face. Display state only. */
  #flipped = new Set();

  #creating = false;

  /* Items the seed read the Skill rows from; Create replaces them. */
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
      this.#attrs[key] = Math.clamp(system.attributes[key] ?? 0, 0, ATTR_CAP);
    }
    const skills = actor.itemTypes.skill.filter(item => !item.getFlag("paradigm-engine", "granted"));
    this.#seededIds = skills.map(item => item.id);
    this.#skills = this.#fitSkills(skills.map(item => ({
      name: item.name,
      kind: SKILL_KINDS.includes(item.system.kind) ? item.system.kind : "Technique",
      text: plainLines(item.system.text),
      source: item.system.source,
      rank: item.system.rank
    })));
    this.#choice = actor.itemTypes.skill
      .filter(item => item.getFlag("paradigm-engine", "choice") && item.system.source)
      .map(item => item.system.source);
    if (system.bonds[0]?.name) {
      this.#bond.name = system.bonds[0].name;
      this.#bond.relation = system.bonds[0].relation ?? "";
    }
    const hearts = Math.clamp(system.hearts.max ?? 4, 0, POOL_POINTS);
    this.#pools = { hearts, energy: Math.clamp(system.energy.max ?? 4, 0, POOL_POINTS - hearts) };
    if (system.luck.length >= 3 && system.luck.slice(0, 3).every(slot => slot.value >= 1)) {
      this.#luck = system.luck.slice(0, 3).map(slot => slot.value);
    }
  }

  /* The saved draft wins over the seed. */
  #restore() {
    const saved = this.#actor.getFlag("paradigm-engine", "creator");
    if (!saved) return;
    if (typeof saved.name === "string") this.#name = saved.name;
    for (const key of Object.keys(this.#attrs)) {
      if (Number.isInteger(saved.attrs?.[key])) this.#attrs[key] = Math.clamp(saved.attrs[key], 0, ATTR_CAP);
    }
    if (Array.isArray(saved.skills)) {
      this.#skills = this.#fitSkills(saved.skills.map(s => ({
        name: typeof s?.name === "string" ? s.name : "",
        kind: SKILL_KINDS.includes(s?.kind) ? s.kind : "Technique",
        text: typeof s?.text === "string" ? s.text : "",
        source: typeof s?.source === "string" ? s.source : "",
        rank: s?.rank
      })));
    }
    if (Array.isArray(saved.choice)) this.#choice = saved.choice.filter(uuid => typeof uuid === "string");
    if (typeof saved.bond?.name === "string") this.#bond.name = saved.bond.name;
    if (typeof saved.bond?.relation === "string") this.#bond.relation = saved.bond.relation;
    if (Number.isInteger(saved.pools?.hearts) && Number.isInteger(saved.pools?.energy)) {
      const hearts = Math.clamp(saved.pools.hearts, 0, POOL_POINTS);
      this.#pools = { hearts, energy: Math.clamp(saved.pools.energy, 0, POOL_POINTS - hearts) };
    }
    if (Array.isArray(saved.luck) && saved.luck.length === 3) {
      this.#luck = saved.luck.map(v => (Number.isInteger(v) && v >= 1 && v <= 6 ? v : null));
    }
  }

  #snapshot() {
    return {
      name: this.#name,
      attrs: { ...this.#attrs },
      skills: this.#skills.map(t => ({ ...t })),
      choice: [...this.#choice],
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
      await this.#actor.setFlag("paradigm-engine", "creator", this.#snapshot());
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
    return game.i18n.localize("PARADIGMENGINE.Creator.Title");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const checks = this.#checks();
    const spent = this.#spent();
    const left = ATTR_POINTS - spent;

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
    const skillLeft = SKILL_POINTS - this.#skillSpent();
    context.skillLeft = skillLeft;
    context.canAdd = skillLeft > 0;
    context.skills = this.#skills.map((t, i) => ({
      i,
      ...t,
      locked: !!t.source,
      technique: t.kind === "Technique",
      kindLabel: game.i18n.localize(`PARADIGMENGINE.Skill.${t.kind}`),
      badge: this.#badge(`skill.${i}`, t.rank),
      costLabel: costLabel({ kind: t.kind, rank: t.rank }),
      downDisabled: t.rank <= 0,
      upDisabled: t.rank >= SKILL_CAP || skillLeft <= 0,
      removable: this.#skills.length > 1
    }));
    const sources = new Set(this.#skills.map(t => t.source).filter(Boolean));
    context.tree = treeRoots().map(item => ({ ...startingSkillRow(item), taken: sources.has(item.uuid) }));

    const choice = this.#choiceState();
    context.choice = choice.count > 0 ? {
      count: choice.count,
      left: choice.count - choice.picked.length,
      side: game.i18n.format("PARADIGMENGINE.Creator.ChoiceSide", { n: choice.count }),
      full: choice.picked.length >= choice.count,
      skills: choice.skills.map(item => {
        const on = choice.picked.includes(item.uuid);
        return { ...startingSkillRow(item), on, disabled: !on && choice.picked.length >= choice.count };
      })
    } : null;
    context.granted = readStartingSkills().map(startingSkillRow);
    context.bond = { ...this.#bond, badge: this.#badge("bond", 0) };
    context.luck = this.#luck.map(value => ({ value, filled: value !== null }));
    context.rolled = this.#luck.every(v => v !== null);

    const free = this.#free();
    context.poolLeft = free;
    context.pools = Object.fromEntries(Object.entries(this.#pools).map(([key, value]) => [key, {
      value,
      pips: Array.from({ length: POOL_POINTS }, (_, i) => i < value),
      downDisabled: value <= 0,
      upDisabled: free <= 0
    }]));
    context.rank = LADDER[1].rank;

    context.todo = this.#todo(checks);
    context.canCreate = this.#complete(checks);
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".card.bond, .sk",
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
    if (PcCreator.#instances.get(this.#actor.uuid) === this) PcCreator.#instances.delete(this.#actor.uuid);
  }

  #spent() {
    return Object.values(this.#attrs).reduce((a, b) => a + b, 0);
  }

  /* Skill Points spent: one per Skill, one more per Rank above E. */
  #skillSpent() {
    return this.#skills.reduce((n, t) => n + 1 + t.rank, 0);
  }

  /* Skill rows clamped to the cap and cut to the points, one row at least. */
  #fitSkills(rows) {
    const out = [];
    let spent = 0;
    for (const row of rows) {
      if (spent >= SKILL_POINTS) break;
      const rank = Math.clamp(Number.isInteger(row.rank) ? row.rank : 0, 0, Math.min(SKILL_CAP, SKILL_POINTS - spent - 1));
      out.push({ ...row, rank });
      spent += 1 + rank;
    }
    return out.length ? out : [emptyPick()];
  }

  #free() {
    return POOL_POINTS - this.#pools.hearts - this.#pools.energy;
  }

  /* The Choice list with the picks that still stand in it. */
  #choiceState() {
    const { skills, count } = readStartingChoice();
    const uuids = new Set(skills.map(i => i.uuid));
    const picked = this.#choice.filter(uuid => uuids.has(uuid)).slice(0, count);
    return { skills, count, picked };
  }

  #checks() {
    const choice = this.#choiceState();
    return {
      name: this.#name.trim().length > 0,
      attributes: this.#spent() === ATTR_POINTS,
      skills: this.#skills.every(t => t.name.trim().length > 0) && this.#skillSpent() === SKILL_POINTS,
      choice: choice.picked.length >= choice.count,
      bond: this.#bond.name.trim().length > 0,
      luck: this.#luck.every(v => v !== null),
      finishing: this.#free() === 0
    };
  }

  #complete(checks) {
    return Object.values(checks).every(Boolean);
  }

  #todo(checks) {
    const rows = [
      ["name", "PARADIGMENGINE.Header.Name"],
      ["attributes", "PARADIGMENGINE.Panel.Attributes"],
      ["skills", "PARADIGMENGINE.Panel.Skills"],
      ["choice", "PARADIGMENGINE.Creator.Choice"],
      ["bond", "PARADIGMENGINE.Creator.Bond"],
      ["luck", "PARADIGMENGINE.Vitals.LuckDice"],
      ["finishing", "PARADIGMENGINE.Creator.HeartsEnergy"]
    ];
    if (this.#choiceState().count === 0) rows.splice(3, 1);
    return rows.map(([key, label]) => ({ key, label: game.i18n.localize(label), done: checks[key] }));
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
    else if (group === "bond" && (i === "name" || i === "relation")) this.#bond[i] = el.value;
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

  static #onStepSkill(event, target) {
    const row = this.#skills[Number(target.dataset.i)];
    const dir = Number(target.dataset.dir);
    if (!row) return;
    if (dir > 0 ? row.rank >= SKILL_CAP || this.#skillSpent() >= SKILL_POINTS : row.rank <= 0) return;
    row.rank += dir;
    this.#touch();
    this.render();
  }

  static #onAddSkill() {
    if (this.#skillSpent() >= SKILL_POINTS) return;
    this.#skills.push(emptyPick());
    this.#touch();
    this.render();
  }

  static #onRemoveSkill(event, target) {
    const i = Number(target.dataset.i);
    if (!(i in this.#skills) || this.#skills.length <= 1) return;
    this.#skills.splice(i, 1);
    this.#touch();
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
      if (slot >= 0) this.#skills[slot] = pickFrom(item);
      else if (this.#skillSpent() < SKILL_POINTS) this.#skills.push(pickFrom(item));
      else return;
    }
    this.#touch();
    this.render();
  }

  static #onChoose(event, target) {
    const uuid = target.dataset.uuid;
    const { count, picked } = this.#choiceState();
    if (picked.includes(uuid)) this.#choice = picked.filter(u => u !== uuid);
    else if (picked.length < count) this.#choice = [...picked, uuid];
    else return;
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

  /* Rolled once through the Roll API, recorded, no chat message. */
  static async #onRollLuck() {
    if (this.#luck.every(v => v !== null)) return;
    const roll = await new foundry.dice.Roll("3d6").evaluate();
    this.#luck = roll.dice[0].results.map(r => r.result);
    this.#touch();
    this.render();
  }

  /* A character dropped on the Bond card is the Bond; a Skill dropped on
     a pick fills it. */
  async #onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const slot = event.currentTarget.closest(".sk");
    if (slot) {
      if (data.type !== "Item") return;
      const item = await Item.implementation.fromDropData(data);
      if (!item || item.type !== "skill" || item.parent === this.#actor) return;
      const i = Number(slot.dataset.i);
      if (!(i in this.#skills)) return;
      this.#skills[i] = pickFrom(item);
    } else {
      if (data.type !== "Actor") return;
      const actor = await Actor.implementation.fromDropData(data);
      if (!actor || actor === this.#actor) return;
      this.#bond.name = actor.name;
    }
    this.#touch();
    this.render();
  }

  /* Safe to run again on a created PC: grown Rank, extra Bonds,
     and Luck Die sizes survive, and only the rows the creator itself
     seeded or wrote before are replaced. */
  static async #onCreate() {
    if (this.#creating || !this.#complete(this.#checks())) return;
    this.#creating = true;
    try {
      const actor = this.#actor;
      const source = actor.system.toObject();
      const luck = [...this.#luck.map(value => ({ value, spent: false })), ...source.luck.slice(3)];
      const bonds = [
        {
          name: this.#bond.name.trim(),
          relation: this.#bond.relation.trim(),
          rank: source.bonds[0]?.rank ?? 0,
          invoked: source.bonds[0]?.invoked ?? false
        },
        ...source.bonds.slice(1)
      ];
      await actor.update({
        name: this.#name.trim(),
        system: {
          rank: Math.max(source.rank, 1),
          attributes: { ...this.#attrs },
          hearts: { value: this.#pools.hearts, max: this.#pools.hearts },
          energy: { value: this.#pools.energy, max: this.#pools.energy },
          luck,
          bonds
        }
      });
      const mine = actor.items.filter(item => item.getFlag("paradigm-engine", "creator")).map(item => item.id);
      const stale = [...new Set([...this.#seededIds, ...mine])].filter(id => actor.items.has(id));
      if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale);
      const flags = { "paradigm-engine": { creator: true } };
      const picks = this.#skills.map(t => {
        const item = t.source ? fromUuidSync(t.source, { strict: false }) : null;
        if (item instanceof Item && item.type === "skill") {
          const data = copyOf(item, { creator: true });
          data.system.rank = t.rank;
          return data;
        }
        return {
          name: t.name.trim(),
          type: "skill",
          system: { rank: t.rank, kind: t.kind, text: paragraphs(t.text) },
          flags
        };
      });
      const { picked } = this.#choiceState();
      const chosen = picked
        .map(uuid => fromUuidSync(uuid, { strict: false }))
        .filter(item => item instanceof Item && item.type === "skill")
        .map(item => copyOf(item, { creator: true, granted: true, choice: true }));
      const granted = readStartingSkills().map(item => copyOf(item, { creator: true, granted: true }));
      await actor.createEmbeddedDocuments("Item", [...picks, ...chosen, ...granted]);
      await this.close();
      actor.sheet.render(true);
    } finally {
      this.#creating = false;
    }
  }
}
