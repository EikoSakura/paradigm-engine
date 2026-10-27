/* Growth Points. A milestone awards points the PC spends at once: an
   Episode 1, an Arc 3, a Season 5, a Timeskip whatever the Storyteller
   sets, with the option tiers the Storyteller opens. Each option costs
   one point; Arc and Season options lock after one purchase in a
   milestone. The last point closes the milestone into the Growth Log and
   posts a card. */

import { ATTRIBUTES, GROWTH_CAPS, GROWTH_OPTIONS, GROWTH_TIERS, LADDER, costLabel, energyCost } from "./config.mjs";
import { foundationName, foundationOf, takeSkill, worldUuid } from "./skills.mjs";
import { partyMembers, partyOf } from "./party.mjs";

const { renderTemplate } = foundry.applications.handlebars;

const SIZES = [6, 8, 10, 12];

export const GROWTH_GROUPS = ["general", "arc", "season"];

/* NPCs hold no Bonds and no Luck Dice, so those options are not theirs. */
const PC_ONLY = new Set(["newBond", "bondRankUp", "stepLuck", "unlockLuck"]);

/* The options this actor can grow by. */
export function growthOptions(actor) {
  return actor.type === "pc" ? GROWTH_OPTIONS : GROWTH_OPTIONS.filter(o => !PC_ONLY.has(o.key));
}

export function optionLabel(key) {
  return game.i18n.localize(`PARADIGMENGINE.Growth.Option.${key}`);
}

function tierLabel(tier) {
  return game.i18n.localize(`PARADIGMENGINE.Growth.${tier}`);
}

/* The option tiers a milestone reaches. */
export function milestoneAccess(tier) {
  if (tier === "Episode") return { general: true, arc: false, season: false };
  if (tier === "Arc") return { general: true, arc: true, season: false };
  if (tier === "Season") return { general: true, arc: true, season: true };
  return { general: true, arc: false, season: false };
}

export function milestoneOpen(actor) {
  return !!actor.system.growth?.milestone.tier;
}

export async function startMilestone(actor, tier) {
  if (!(tier in GROWTH_TIERS) || milestoneOpen(actor)) return;
  await actor.update({
    "system.growth.milestone": { tier, gp: GROWTH_TIERS[tier], access: milestoneAccess(tier), items: [] }
  });
}

export async function startTimeskip(actor, gp, access) {
  if (!game.user.isGM || milestoneOpen(actor) || !(gp >= 1)) return;
  await actor.update({
    "system.growth.milestone": { tier: "Timeskip", gp, access: { general: true, ...access }, items: [] }
  });
}

/* Cancel closes the milestone where it stands: what was bought is logged,
   the points left are dropped. */
export async function cancelMilestone(actor) {
  if (!milestoneOpen(actor)) return;
  await finish(actor);
}

/* ----- option states ----- */

/* The Rank a Skill or Bond Rank Up may reach: one above the Character
   Rank, within the Ladder. */
export function rankCap(actor) {
  return Math.min(actor.system.rank + 1, LADDER.length - 1);
}

/* Skills with a Rank of their own below the cap. */
function rankableSkills(actor, cap) {
  return actor.itemTypes.skill.filter(i => !i.system.prerequisite && i.system.rank < cap);
}

function rankableBonds(actor, cap) {
  return actor.system.bonds.map((bond, index) => ({ bond, index })).filter(({ bond }) => bond.rank < cap);
}

/* Whether a Skill is the foundation of another the actor holds. */
function hasDependents(actor, skill) {
  return actor.itemTypes.skill.some(i => i !== skill && foundationOf(i) === skill);
}

/* Skills that can be retrained: any but a foundation still built on. */
function retrainableSkills(actor) {
  return actor.itemTypes.skill.filter(i => !hasDependents(actor, i));
}

/* Techniques whose Energy cost Technique Mastery can still lower. */
function masterableSkills(actor) {
  return actor.itemTypes.skill.filter(i => i.system.kind === "Technique" && energyCost(i.system) > 1);
}

/* Whether the option can be bought now, and its live reading. */
export function optionState(actor, option) {
  const system = actor.system;
  const toRank = r => game.i18n.format("PARADIGMENGINE.Growth.ToRank", { rank: r.rank });
  const atRank = r => game.i18n.format("PARADIGMENGINE.Growth.AtRank", { rank: r.rank });
  const of = (n, max) => game.i18n.format("PARADIGMENGINE.Growth.Of", { n, max });
  const step = (from, to) => game.i18n.format("PARADIGMENGINE.Growth.Step", { from, to });
  const dieNext = SIZES[SIZES.indexOf(system.luckDie) + 1];
  const cap = LADDER[rankCap(actor)];
  switch (option.key) {
    case "newSkill": return { can: true, sub: atRank(LADDER[0]) };
    case "skillRankUp": return { can: rankableSkills(actor, rankCap(actor)).length > 0, sub: toRank(cap) };
    case "modifySkill": return { can: actor.itemTypes.skill.length > 0, sub: "" };
    case "retrainSkill": return { can: retrainableSkills(actor).length > 0, sub: "" };
    case "newBond": return { can: true, sub: atRank(LADDER[0]) };
    case "bondRankUp": return { can: rankableBonds(actor, rankCap(actor)).length > 0, sub: toRank(cap) };
    case "heart": return { can: system.hearts.max < GROWTH_CAPS.points, sub: of(system.hearts.max, GROWTH_CAPS.points) };
    case "energy": return { can: system.energy.max < GROWTH_CAPS.points, sub: of(system.energy.max, GROWTH_CAPS.points) };
    case "attrRankUp": return { can: ATTRIBUTES.some(a => system.attributes[a.key] < 5), sub: toRank(LADDER[5]) };
    case "stepLuck": return { can: !!dieNext, sub: dieNext ? step(`d${system.luckDie}`, `d${dieNext}`) : `d${system.luckDie}` };
    case "unlockLuck": return { can: system.luck.length < GROWTH_CAPS.luckDice, sub: of(system.luck.length, GROWTH_CAPS.luckDice) };
    case "comboMastery": {
      const min = system.comboMin;
      const can = min > GROWTH_CAPS.comboMin;
      const doubles = n => game.i18n.format("PARADIGMENGINE.Growth.Doubles", { n });
      return { can, sub: can ? step(doubles(min), doubles(min - 1)) : doubles(min) };
    }
    case "techMastery": return { can: masterableSkills(actor).length > 0, sub: "" };
    default: return { can: false, sub: "" };
  }
}

/* The three cards for the sheet: each option with its label, reading, and
   whether a Take is possible under the open milestone. */
export function growthCards(actor) {
  const milestone = actor.system.growth.milestone;
  const open = !!milestone.tier;
  return GROWTH_GROUPS.map(group => {
    const reach = open && milestone.gp > 0 && milestone.access[group];
    return {
      group,
      label: game.i18n.localize(`PARADIGMENGINE.Growth.Group.${group}`),
      tail: game.i18n.localize(`PARADIGMENGINE.Growth.GroupTail.${group}`),
      off: !reach,
      options: growthOptions(actor).filter(o => o.group === group).map(o => {
        const state = optionState(actor, o);
        const taken = !!o.once && milestone.items.some(i => i.key === o.key);
        return {
          key: o.key,
          label: optionLabel(o.key),
          sub: state.sub,
          taken,
          can: reach && state.can && !taken
        };
      })
    };
  });
}

/* ----- spending ----- */

function canSpend(actor, key) {
  const option = growthOptions(actor).find(o => o.key === key);
  const milestone = actor.system.growth.milestone;
  if (!option || !actor.isOwner || !milestone.tier || milestone.gp < 1 || !milestone.access[option.group]) return null;
  if (option.once && milestone.items.some(i => i.key === key)) return null;
  if (!optionState(actor, option).can) return null;
  return option;
}

/* A new Skill from a pick: a world Skill by uuid, taken onto the actor,
   else one created by name and kind. rank is what a Skill with a Rank of
   its own starts at; a specialization keeps its foundation's. */
async function newSkillFrom(actor, choice, rank) {
  if (choice.uuid) {
    const source = await fromUuid(choice.uuid);
    if (source?.type !== "skill" || source.parent === actor) return null;
    const skill = await takeSkill(actor, source);
    if (skill && !skill.system.prerequisite && skill.system.rank !== rank) await skill.update({ "system.rank": rank });
    return skill;
  }
  const name = (choice.name ?? "").trim() || CONFIG.Item.documentClass.defaultName({ type: "skill", parent: actor });
  const kind = choice.kind === "Talent" ? "Talent" : "Technique";
  return Item.implementation.create({ name, type: "skill", system: { rank, kind } }, { parent: actor, renderSheet: true });
}

/* Buy an option. choice names what it touches: an item id, a bond index,
   an attribute key, a Skill to take, or a name to create. Returns false
   when nothing was bought. */
export async function spend(actor, key, choice = {}) {
  const option = canSpend(actor, key);
  if (!option) return false;
  const system = actor.system;
  const update = {};
  let item = { key, name: "", rank: null };
  switch (key) {
    case "newSkill": {
      const skill = await newSkillFrom(actor, choice, 0);
      if (!skill) return false;
      item = { key, name: skill.name, rank: skill.system.rank };
      break;
    }
    case "skillRankUp": {
      const skill = rankableSkills(actor, rankCap(actor)).find(i => i.id === choice.itemId);
      if (!skill) return false;
      await skill.update({ "system.rank": skill.system.rank + 1 });
      item = { key, name: skill.name, rank: skill.system.rank };
      break;
    }
    case "modifySkill": {
      const skill = actor.items.get(choice.itemId);
      if (skill?.type !== "skill") return false;
      item = { key, name: skill.name, rank: skill.system.rank };
      const sheet = skill.sheet;
      await sheet.render({ force: true });
      sheet.setMode?.("edit");
      break;
    }
    case "retrainSkill": {
      const old = retrainableSkills(actor).find(i => i.id === choice.itemId);
      if (!old) return false;
      const rank = old.system.rank;
      const skill = await newSkillFrom(actor, choice, rank);
      if (!skill) return false;
      await old.delete();
      item = { key, name: `${old.name} → ${skill.name}`, rank: skill.system.rank };
      break;
    }
    case "newBond": {
      const name = (choice.name ?? "").trim();
      if (!name) return false;
      update["system.bonds"] = [...system.toObject().bonds, { name, rank: 0, invoked: false }];
      item = { key, name, rank: 0 };
      break;
    }
    case "bondRankUp": {
      const bonds = system.toObject().bonds;
      const bond = bonds[choice.index];
      if (!bond || bond.rank >= rankCap(actor)) return false;
      bond.rank += 1;
      update["system.bonds"] = bonds;
      item = { key, name: bond.name, rank: bond.rank };
      break;
    }
    case "heart":
    case "energy": {
      const pool = system[key === "heart" ? "hearts" : "energy"];
      update[`system.${key === "heart" ? "hearts" : "energy"}`] = { max: pool.max + 1, value: pool.value + 1 };
      break;
    }
    case "attrRankUp": {
      const attribute = ATTRIBUTES.find(a => a.key === choice.key);
      if (!attribute || system.attributes[attribute.key] >= 5) return false;
      const rank = system.attributes[attribute.key] + 1;
      update[`system.attributes.${attribute.key}`] = rank;
      item = { key, name: game.i18n.localize(attribute.label), rank };
      break;
    }
    case "stepLuck": {
      update["system.luckDie"] = SIZES[SIZES.indexOf(system.luckDie) + 1];
      break;
    }
    case "unlockLuck": {
      const roll = await new foundry.dice.Roll(`1d${system.luckDie}`).evaluate();
      update["system.luck"] = [...system.toObject().luck, { value: roll.total, spent: false }];
      await roll.toMessage({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        flavor: game.i18n.localize("PARADIGMENGINE.Vitals.LuckDice")
      });
      break;
    }
    case "comboMastery": {
      update["system.comboMin"] = system.comboMin - 1;
      item = { key, name: game.i18n.format("PARADIGMENGINE.Growth.Doubles", { n: system.comboMin - 1 }), rank: null };
      break;
    }
    case "techMastery": {
      const skill = masterableSkills(actor).find(i => i.id === choice.itemId);
      if (!skill) return false;
      await skill.update({ "system.mastery": skill.system.mastery + 1 });
      item = { key, name: `${skill.name} · ${costLabel(skill.system)}`, rank: null };
      break;
    }
    default: return false;
  }
  const milestone = system.toObject().growth.milestone;
  milestone.gp -= 1;
  milestone.items.push(item);
  update["system.growth.milestone"] = milestone;
  await actor.update(update);
  if (milestone.gp === 0) await finish(actor);
  return true;
}

/* Close the milestone: its purchases go to the Growth Log, newest last,
   and a card posts them. Nothing bought leaves no row. */
async function finish(actor) {
  const growth = actor.system.toObject().growth;
  const { tier, items } = growth.milestone;
  const empty = { tier: "", gp: 0, access: { general: true, arc: false, season: false }, items: [] };
  if (!items.length) return actor.update({ "system.growth.milestone": empty });
  await actor.update({ "system.growth.milestone": empty, "system.growth.log": [...growth.log, { tier, items }] });
  const content = await renderTemplate("systems/paradigm-engine/templates/chat/growth-card.hbs", {
    name: actor.name,
    tier: tierLabel(tier),
    items: logItems(items)
  });
  await ChatMessage.implementation.create({ content, speaker: ChatMessage.implementation.getSpeaker({ actor }) });
}

/* A log row's chips: the option, the thing it touched, and its Rank. */
export function logItems(items) {
  return items.map(i => ({
    label: optionLabel(i.key),
    name: i.name,
    rank: i.rank === null ? "" : LADDER[i.rank].rank,
    cssVar: i.rank === null ? "" : LADDER[i.rank].cssVar
  }));
}

export function growthLog(actor) {
  return [...actor.system.growth.log].reverse().map(row => ({
    tier: row.tier,
    label: tierLabel(row.tier),
    items: logItems(row.items)
  }));
}

/* ----- pick lists ----- */

function skillRow(actor, skill, extra = {}) {
  const step = LADDER[skill.system.rank];
  return {
    id: skill.id,
    name: skill.name,
    kindLabel: game.i18n.localize(`PARADIGMENGINE.Skill.${skill.system.kind}`),
    technique: skill.system.kind === "Technique",
    costLabel: costLabel(skill.system),
    foundation: skill.system.prerequisite ? foundationName(skill) : "",
    rank: step.rank,
    cssVar: step.cssVar,
    ...extra
  };
}

export function modifySkillRows(actor) {
  return actor.itemTypes.skill.map(skill => skillRow(actor, skill, { can: true }));
}

/* Every Skill, the foundations still built on marked off. */
export function retrainSkillRows(actor) {
  return actor.itemTypes.skill.map(skill => skillRow(actor, skill, { can: !hasDependents(actor, skill) }));
}

/* Every Technique, those at the floor of 1 Energy marked off, the rest
   with the cost Technique Mastery would leave. */
export function techniqueRows(actor) {
  return actor.itemTypes.skill.filter(skill => skill.system.kind === "Technique").map(skill => {
    const can = energyCost(skill.system) > 1;
    const next = can ? costLabel({ kind: skill.system.kind, rank: skill.system.rank, mastery: skill.system.mastery + 1 }) : "";
    return skillRow(actor, skill, { can, nextCost: next });
  });
}

export function skillRankRows(actor, cap = rankCap(actor)) {
  return actor.itemTypes.skill.map(skill => {
    const can = !skill.system.prerequisite && skill.system.rank < cap;
    const next = can ? LADDER[skill.system.rank + 1] : null;
    return skillRow(actor, skill, { can, nextRank: next?.rank ?? "", nextCssVar: next?.cssVar ?? "" });
  });
}

export function bondRankRows(actor, cap = rankCap(actor)) {
  return actor.system.bonds.map((bond, index) => {
    const step = LADDER[bond.rank];
    const can = bond.rank < cap;
    const next = can ? LADDER[bond.rank + 1] : null;
    return { index, name: bond.name, rank: step.rank, cssVar: step.cssVar, can, nextRank: next?.rank ?? "", nextCssVar: next?.cssVar ?? "" };
  });
}

export function attributeRows(actor) {
  return ATTRIBUTES.map(a => {
    const value = actor.system.attributes[a.key];
    const step = LADDER[value];
    const can = value < 5;
    const next = can ? LADDER[value + 1] : null;
    return { key: a.key, name: game.i18n.localize(a.label), die: step.die, rank: step.rank, cssVar: step.cssVar, can, nextRank: next?.rank ?? "", nextCssVar: next?.cssVar ?? "" };
  });
}

/* The world Skills in the tree this PC can take: the roots, and every
   specialization whose foundation the PC knows, less those it has.
   leaving names a Skill about to be retrained away: nothing built on it
   is offered. */
export function availableSkills(actor, leaving = null) {
  const world = game.items
    .filter(i => i.type === "skill" && i.system.inTree)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const inTree = new Set(world.map(i => i.uuid));
  const owned = actor.itemTypes.skill;
  const ownedBy = item => owned.find(o => o.system.source === item.uuid) ?? owned.find(o => o.name === item.name);
  return world
    .filter(item => {
      if (ownedBy(item)) return false;
      const parent = item.system.prerequisite;
      if (!parent || !inTree.has(parent)) return true;
      if (leaving && (parent === worldUuid(leaving) || parent === leaving.uuid)) return false;
      const foundation = fromUuidSync(parent, { strict: false });
      return !!foundation && !!ownedBy(foundation) && ownedBy(foundation) !== leaving;
    })
    .map(item => {
      const step = LADDER[item.system.prerequisite ? item.system.rank : 0];
      const kind = item.system.kind;
      return {
        uuid: item.uuid,
        name: item.name,
        kindLabel: game.i18n.localize(`PARADIGMENGINE.Skill.${kind}`),
        technique: kind === "Technique",
        costLabel: costLabel({ kind, rank: LADDER.indexOf(step) }),
        foundation: item.system.prerequisite ? fromUuidSync(item.system.prerequisite, { strict: false })?.name ?? "" : "",
        rank: step.rank,
        cssVar: step.cssVar
      };
    });
}

/* Characters to bond with: the PC's Party, then the NPCs the user can see;
   one already bonded reads its Rank and cannot be picked again. */
export function bondCandidates(actor) {
  const bonded = new Map(actor.system.bonds.map(b => [b.name, LADDER[b.rank]]));
  const row = a => {
    const step = bonded.get(a.name);
    return {
      uuid: a.uuid,
      name: a.name,
      img: a.img === foundry.documents.BaseActor.DEFAULT_ICON ? "" : a.img,
      initial: (a.name || "?").trim().charAt(0).toUpperCase() || "?",
      player: a.type === "pc" ? a.system.player : "",
      bonded: !!step,
      rank: step?.rank ?? "",
      cssVar: step?.cssVar ?? ""
    };
  };
  const party = partyOf(actor);
  const members = party ? partyMembers(party).filter(a => a.id !== actor.id) : [];
  const npcs = game.actors
    .filter(a => a.type === "npc" && a.visible)
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  return { party: members.map(row), npcs: npcs.map(row) };
}
