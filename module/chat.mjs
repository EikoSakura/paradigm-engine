import { DIFFICULTY, LADDER } from "./config.mjs";

const { renderTemplate } = foundry.applications.handlebars;

/* Post a Skill to chat. The card is a snapshot at post time. */
export async function postItemCard(item) {
  const step = LADDER[item.system.rank];
  const context = {
    name: item.name,
    rank: step.rank,
    cssVar: step.cssVar,
    kindLabel: game.i18n.localize(`PARADIGMENGINE.Skill.${item.system.kind}`),
    costLabel: game.i18n.format("PARADIGMENGINE.Skill.Energy", { n: step.mod }),
    activated: item.system.kind === "Activated",
    rulings: item.system.rulings.filter(r => r.trim()),
    enrichedText: await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.text, {
      relativeTo: item,
      secrets: false
    })
  };
  const content = await renderTemplate("systems/paradigm-engine/templates/chat/item-card.hbs", context);
  return ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.implementation.getSpeaker({ actor: item.actor })
  });
}

/* Post the blocked-roll card: a Skill the actor cannot pay for. */
export async function postEnergyCard(actor, item) {
  const step = LADDER[item.system.rank];
  const context = {
    name: item.name,
    rank: step.rank,
    cssVar: step.cssVar,
    costLabel: game.i18n.format("PARADIGMENGINE.Skill.Energy", { n: step.mod }),
    line: game.i18n.format("PARADIGMENGINE.Chat.NoEnergy", { left: actor.system.energy.value })
  };
  const content = await renderTemplate("systems/paradigm-engine/templates/chat/energy-card.hbs", context);
  return ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.implementation.getSpeaker({ actor })
  });
}

/* Combo or Fumble, read from two faces as they stand, or null. */
export function readSplash(faces) {
  if (faces.length !== 2 || faces[0] !== faces[1]) return null;
  if (faces[0] >= 6) return "combo";
  if (faces[0] === 1) return "fumble";
  return null;
}

/* Band of a roll against an effective Difficulty, in rules order: Fumble,
   then the SS rule, then the numbers of the Rank above the Difficulty and
   the Difficulty itself. Adversary results carry two rows only: reach the
   Difficulty and it gets what it is aiming for, below it does not, and a
   Fumble fails. */
export function evaluateBand(faces, total, effective, adversary = false) {
  if (faces.length === 2 && faces[0] === 1 && faces[1] === 1) return "Fumble";
  if (adversary) return total >= DIFFICULTY[effective].number ? "Success" : "Failure";
  if (effective >= 6) return total >= DIFFICULTY[6].number ? "Critical" : "Failure";
  if (total >= DIFFICULTY[effective + 1].number) return "Critical";
  if (total >= DIFFICULTY[effective].number) return "Success";
  return "Failure";
}

const RIDERS = {
  Critical: [],
  Success: [],
  Failure: ["Spotlight"],
  Fumble: ["Spotlight", "Luck"]
};

/* Template context from a roll card's stored state: { title, faces, lucky,
   luck, bonus }. The total is recomputed from the faces so Luck
   replacements re-total. */
function rollCardContext(card) {
  let band = null;
  if (card.difficulty) {
    const d = card.difficulty;
    const step = DIFFICULTY[d.effective];
    band = {
      rank: step.rank,
      number: step.number,
      cssVar: step.cssVar,
      word: game.i18n.localize(`PARADIGMENGINE.Band.${d.band}`),
      fumble: d.band === "Fumble",
      limitBreak: d.limitBreak > 0 ? game.i18n.format("PARADIGMENGINE.Roll.LimitBreakTag", { n: d.limitBreak }) : null,
      riders: d.adversary ? [] : RIDERS[d.band].map(k => ({ key: k, text: game.i18n.localize(`PARADIGMENGINE.Rider.${k}`) }))
    };
  }
  return {
    band,
    title: card.title,
    faces: card.faces.map((value, i) => ({ value, lucky: card.lucky[i] })),
    total: card.faces.reduce((a, b) => a + b, 0) + card.bonus,
    bonus: card.bonus ? `${card.bonus > 0 ? "+" : "−"}${Math.abs(card.bonus)}` : null,
    luck: card.luck.map(name => game.i18n.format("PARADIGMENGINE.Roll.Luck", { name }))
  };
}

/* Post an Action Roll: two dice and one optional flat bonus, backed by a
   real Roll. first and second are { name, rank } with any die steps already
   applied; bonus is a signed integer; difficulty is a DIFFICULTY index or
   null, raised by limitBreak steps and capped at SS. The card's state rides
   the message as a flag so Luck spends can re-render it. */
export async function postActionRoll(actor, first, second, bonus = 0, difficulty = null, limitBreak = 0) {
  let formula = [first, second].map(d => `1${LADDER[d.rank].die}`).join(" + ");
  if (bonus > 0) formula += ` + ${bonus}`;
  else if (bonus < 0) formula += ` - ${-bonus}`;
  const roll = await new foundry.dice.Roll(formula).evaluate();
  const card = {
    title: `${first.name} + ${second.name}`,
    faces: roll.dice.map(d => d.total),
    lucky: [false, false],
    luck: [],
    bonus
  };
  if (difficulty !== null) {
    const effective = Math.min(difficulty + limitBreak, 6);
    const adversary = actor?.type === "adversary";
    card.difficulty = { index: difficulty, limitBreak, effective, adversary, band: evaluateBand(card.faces, roll.total, effective, adversary) };
  }
  const splash = readSplash(card.faces);
  const content = await renderTemplate("systems/paradigm-engine/templates/chat/roll-card.hbs", rollCardContext(card));
  return ChatMessage.implementation.create({
    content,
    rolls: [roll],
    sound: CONFIG.sounds.dice,
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flags: { "paradigm-engine": splash ? { card, splash } : { card } }
  });
}

/* Replace one die of a roll card with a spent Luck Die's recorded number and
   re-render. Runs on a client allowed to update the message; a spend that
   lands on a card already standing on a Fumble is refused. The splash flag
   updates when the Combo or Fumble state changes, and every client plays the
   splash from the update. */
export async function applyLuckSwap(message, dieIndex, value, spenderName) {
  const card = foundry.utils.deepClone(message.getFlag("paradigm-engine", "card"));
  if (!card || !(dieIndex in card.faces)) return;
  if (readSplash(card.faces) === "fumble") return;
  card.faces[dieIndex] = value;
  card.lucky[dieIndex] = true;
  card.luck.push(spenderName);
  if (card.difficulty) {
    const total = card.faces.reduce((a, b) => a + b, 0) + card.bonus;
    card.difficulty.band = evaluateBand(card.faces, total, card.difficulty.effective, card.difficulty.adversary);
  }
  const splash = readSplash(card.faces);
  const prior = message.getFlag("paradigm-engine", "splash") ?? null;
  const flags = { "paradigm-engine": { card } };
  if (splash !== prior) {
    if (splash) flags["paradigm-engine"].splash = splash;
    else flags["paradigm-engine"].splash = new foundry.data.operators.ForcedDeletion();
  }
  const content = await renderTemplate("systems/paradigm-engine/templates/chat/roll-card.hbs", rollCardContext(card));
  await message.update({ content, flags });
}
