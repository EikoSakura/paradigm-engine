/* Starting Skills: Skills a new PC takes at creation on top of the two
   picks. Two lists, configured from the settings window by dropping
   Skills in: Granted, which every PC gets free, and Choice, from which a
   PC picks a set number. The PC Creator shows both and copies the Skills
   onto the PC on Create. Held as world settings of Skill UUIDs. */

import { LADDER } from "./config.mjs";
import { resolveRank } from "./skills.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const GRANTED = "startingSkills";
const CHOICE = "startingChoice";
const COUNT = "startingChoiceCount";
const COUNT_MAX = 9;

/* A starting Skill as the creator and the settings window list it. */
export function startingSkillRow(item) {
  return {
    uuid: item.uuid,
    name: item.name,
    img: item.img,
    kind: game.i18n.localize(`PARADIGMENGINE.Skill.${item.system.kind}`),
    rank: LADDER[resolveRank(item)].rank
  };
}

function readList(setting) {
  const uuids = game.settings.get("paradigm-engine", setting);
  const out = [];
  for (const uuid of Array.isArray(uuids) ? uuids : []) {
    const item = fromUuidSync(uuid, { strict: false });
    if (item instanceof Item && item.type === "skill") out.push(item);
  }
  return out;
}

/* The granted Skills as Items, missing ones skipped. */
export function readStartingSkills() {
  return readList(GRANTED);
}

/* The choice list and how many of it a PC picks, never more than it holds. */
export function readStartingChoice() {
  const skills = readList(CHOICE);
  const stored = game.settings.get("paradigm-engine", COUNT);
  const count = Math.clamp(Number.isInteger(stored) ? stored : 1, 0, Math.min(skills.length, COUNT_MAX));
  return { skills, count };
}

export default class StartingSkillsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["paradigm-engine", "starting-skills"],
    position: { width: 420, height: "auto" },
    actions: {
      remove: this.#onRemove,
      stepCount: this.#onStepCount
    }
  };

  static PARTS = {
    body: { template: "systems/paradigm-engine/templates/apps/starting-skills.hbs" }
  };

  get title() {
    return game.i18n.localize("PARADIGMENGINE.Settings.StartingSkills.Name");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const choice = readStartingChoice();
    context.granted = readStartingSkills().map(startingSkillRow);
    context.choice = choice.skills.map(startingSkillRow);
    context.count = choice.count;
    context.downDisabled = choice.count <= 0;
    context.upDisabled = choice.count >= Math.min(choice.skills.length, COUNT_MAX);
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".card",
      permissions: { drop: () => game.user.isGM },
      callbacks: { drop: this.#onDrop.bind(this) }
    }).bind(this.element);
  }

  async #onDrop(event) {
    const setting = event.currentTarget.dataset.list === "choice" ? CHOICE : GRANTED;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data.type !== "Item") return;
    const item = await Item.implementation.fromDropData(data);
    if (!item || item.type !== "skill" || item.parent) return;
    const uuids = readList(setting).map(i => i.uuid);
    if (uuids.includes(item.uuid)) return;
    await game.settings.set("paradigm-engine", setting, [...uuids, item.uuid]);
    this.render();
  }

  static async #onRemove(event, target) {
    const setting = target.dataset.list === "choice" ? CHOICE : GRANTED;
    const uuids = readList(setting).map(i => i.uuid).filter(uuid => uuid !== target.dataset.uuid);
    await game.settings.set("paradigm-engine", setting, uuids);
    this.render();
  }

  static async #onStepCount(event, target) {
    const { skills, count } = readStartingChoice();
    const next = Math.clamp(count + Number(target.dataset.dir), 0, Math.min(skills.length, COUNT_MAX));
    if (next === count) return;
    await game.settings.set("paradigm-engine", COUNT, next);
    this.render();
  }
}

export function registerStartingSkills() {
  for (const setting of [GRANTED, CHOICE]) {
    game.settings.register("paradigm-engine", setting, {
      scope: "world",
      config: false,
      type: Array,
      default: []
    });
  }
  game.settings.register("paradigm-engine", COUNT, {
    scope: "world",
    config: false,
    type: Number,
    default: 1
  });
  game.settings.registerMenu("paradigm-engine", "startingSkillsMenu", {
    name: "PARADIGMENGINE.Settings.StartingSkills.Name",
    label: "PARADIGMENGINE.Settings.StartingSkills.Label",
    hint: "",
    icon: "fa-solid fa-sparkles",
    type: StartingSkillsConfig,
    restricted: true
  });
}
