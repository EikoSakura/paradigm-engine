import { DIFFICULTY, LADDER, costLabel } from "./config.mjs";
import { resolveRank } from "./skills.mjs";
import { frameOf, frameStyle, portraitOf } from "./portrait.mjs";

const { renderTemplate } = foundry.applications.handlebars;
const TEMPLATES = "systems/paradigm-engine/templates/chat";

/* Post a Skill to chat. The card is a snapshot at post time. */
export async function postItemCard(item) {
  const step = LADDER[resolveRank(item)];
  const context = {
    name: item.name,
    rank: step.rank,
    cssVar: step.cssVar,
    kindLabel: game.i18n.localize(`PARADIGMENGINE.Skill.${item.system.kind}`),
    costLabel: costLabel(item.system),
    technique: item.system.kind === "Technique",
    enrichedText: await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.text, {
      relativeTo: item,
      secrets: false
    })
  };
  const content = await renderTemplate(`${TEMPLATES}/item-card.hbs`, context);
  return ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.implementation.getSpeaker({ actor: item.actor })
  });
}

/* Post the blocked-roll card: a Skill the actor cannot pay for. */
export async function postEnergyCard(actor, item) {
  const step = LADDER[resolveRank(item)];
  const context = {
    name: item.name,
    rank: step.rank,
    cssVar: step.cssVar,
    costLabel: costLabel(item.system),
    line: game.i18n.format("PARADIGMENGINE.Chat.NoEnergy", { left: actor.system.energy.value })
  };
  const content = await renderTemplate(`${TEMPLATES}/energy-card.hbs`, context);
  return ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.implementation.getSpeaker({ actor })
  });
}

/* Post an invoked Bond: the Bond's Rank and name over one line naming the
   actor and the benefit, with its detail where there is one. */
export async function postBondCard(actor, bond, benefit, detail = "") {
  const step = LADDER[bond.rank];
  const context = {
    name: bond.name || game.i18n.localize("PARADIGMENGINE.Bond.Title"),
    rank: step.rank,
    cssVar: step.cssVar,
    line: game.i18n.format("PARADIGMENGINE.Chat.Invoke", {
      name: actor.name,
      benefit: game.i18n.localize(`PARADIGMENGINE.Bond.${benefit}`)
    }),
    detail
  };
  const content = await renderTemplate(`${TEMPLATES}/bond-card.hbs`, context);
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

/* Band of a roll against an effective Difficulty, in rules order: Fumble
   on double 1s, then the Difficulty itself: reach its number and the roll
   succeeds, below it fails. Doubles of 6 or higher that reach it are a
   Combo; a Combo only succeeds if the total meets the Difficulty, so one
   below it fails like any other roll. NPC results read the same way. */
export function evaluateBand(faces, total, effective, npc = false) {
  const splash = readSplash(faces);
  if (splash === "fumble") return "Fumble";
  if (total < DIFFICULTY[effective].number) return "Failure";
  return splash === "combo" ? "Combo" : "Success";
}

export function isSuccess(band) {
  return band === "Success" || band === "Combo";
}

/* The one rider: a PC's Fumble cannot be altered by Luck Dice. */
function riders(band, npc) {
  if (npc || band !== "Fumble") return [];
  return [{ key: "Luck", text: game.i18n.localize("PARADIGMENGINE.Rider.Luck") }];
}

/* The die size behind a Ladder step: the d12 of d12+1. */
function dieMax(rank) {
  return Number(LADDER[rank].die.match(/\d+/)[0]);
}

export function cardTotal(card) {
  return card.faces.reduce((a, b) => a + b, 0) + card.bonus;
}

/* Re-read a card's band from its faces as they stand. */
export function rebandCard(card) {
  if (!card.difficulty) return;
  card.difficulty.band = evaluateBand(card.faces, cardTotal(card), card.difficulty.effective, card.difficulty.npc);
}

/* The Actor behind a UUID: an Actor's own, or a Token's. */
function actorOf(uuid) {
  const doc = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  if (doc instanceof Actor) return doc;
  return doc?.actor ?? null;
}

/* A Combo recovers 1 Energy for its roller, once per card, up to their
   maximum; a Combo unmade later gives it back. The card keeps the Energy
   it holds. Runs on a client that owns the actor: the roller posting, or
   the Storyteller applying a card op. */
export async function applyComboEnergy(actor, card) {
  if (!card || !actor?.isOwner || !actor.system?.energy) return;
  const want = card.difficulty?.band === "Combo" ? 1 : 0;
  const have = card.energy ?? 0;
  if (want === have) return;
  const { value, max } = actor.system.energy;
  const next = Math.clamp(value + want - have, 0, Math.max(max, value));
  card.energy = have + next - value;
  if (next !== value) await actor.update({ "system.energy.value": next });
}

/* A Fumble costs its roller 1 Heart, once per card, down to none; a Fumble
   unmade later, by a Shift, gives it back. The Fumble reads from the dice
   as they stand, with or without a Difficulty, as the splash does. The
   card keeps the Hearts it took. Runs where applyComboEnergy does. */
export async function applyFumbleHeart(actor, card) {
  if (!card || !actor?.isOwner || !actor.system?.hearts) return;
  const want = readSplash(card.faces) === "fumble" ? 1 : 0;
  const have = card.hearts ?? 0;
  if (want === have) return;
  const { value, max } = actor.system.hearts;
  const next = Math.clamp(value - want + have, 0, Math.max(max, value));
  card.hearts = have + value - next;
  if (next !== value) await actor.update({ "system.hearts.value": next });
}

/* Both roll outcomes a card pays or takes. */
export async function applyRollEffects(actor, card) {
  await applyComboEnergy(actor, card);
  await applyFumbleHeart(actor, card);
}

/* Roll two dice, backed by a real Roll. first and second are { name, rank }
   with any die steps already applied. The card keeps the faces, so Luck
   replacements and Shifts re-total; its bonus holds the flat part of the
   formula, the +1 of an S die, which counts in the total and shows no
   line of its own. */
export async function rollDice(first, second, bonus = 0) {
  let formula = [first, second].map(d => `1${LADDER[d.rank].die}`).join(" + ");
  if (bonus > 0) formula += ` + ${bonus}`;
  else if (bonus < 0) formula += ` - ${-bonus}`;
  const roll = await new foundry.dice.Roll(formula).evaluate();
  const faces = roll.dice.map(d => d.total);
  const card = {
    title: `${first.name} + ${second.name}`,
    faces,
    lucky: [false, false],
    luck: [],
    bonus: roll.total - faces.reduce((a, b) => a + b, 0),
    maxes: [first.rank, second.rank].map(dieMax)
  };
  return { roll, card };
}

/* Set a card's Difficulty: a DIFFICULTY index raised by limitBreak steps
   and capped at SS. */
export function setDifficulty(card, difficulty, limitBreak = 0, npc = false) {
  const effective = Math.min(difficulty + limitBreak, 6);
  card.difficulty = { index: difficulty, limitBreak, effective, npc, band: null };
  rebandCard(card);
}

/* A roll that lands on a shared card has no message of its own: the dice
   sound and the 3D dice still play. */
export async function showRoll(roll) {
  foundry.audio.AudioHelper.play({ src: CONFIG.sounds.dice }, true);
  if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true);
}

/* The Limit Break line of a banded card: the raise, then what it did.
   A Success marks one more box per Rank raised in a Clash, or costs the
   target one more Heart elsewhere; a Failure is a setback of 1 Heart plus
   one per Rank raised. */
function limitBreakLine(d, clash) {
  const n = d.limitBreak;
  if (!(n > 0)) return null;
  const tag = game.i18n.format("PARADIGMENGINE.Roll.LimitBreakTag", { n });
  let outcome;
  if (!isSuccess(d.band)) outcome = game.i18n.format("PARADIGMENGINE.Roll.LimitSetback", { n: n + 1 });
  else if (clash) outcome = game.i18n.format(n === 1 ? "PARADIGMENGINE.Roll.LimitBox" : "PARADIGMENGINE.Roll.LimitBoxes", { n });
  else outcome = game.i18n.format(n === 1 ? "PARADIGMENGINE.Roll.LimitHeart" : "PARADIGMENGINE.Roll.LimitHearts", { n });
  return `${tag} · ${outcome}`;
}

/* Boxes a Clash roll marks: one for a Success, plus one per Limit Break
   Rank. */
export function clashBoxes(card) {
  const d = card?.difficulty;
  return isSuccess(d?.band) ? 1 + (d.limitBreak ?? 0) : 0;
}

/* Template context from a roll card's stored state; clash says the card
   stands in a Clash. */
export function rollCardContext(card, clash = false) {
  let band = null;
  if (card.difficulty) {
    const d = card.difficulty;
    const step = DIFFICULTY[d.effective];
    band = {
      key: d.band,
      rank: step.rank,
      number: step.number,
      cssVar: step.cssVar,
      word: game.i18n.localize(`PARADIGMENGINE.Band.${d.band}`),
      fumble: d.band === "Fumble",
      combo: d.band === "Combo",
      success: isSuccess(d.band),
      limitBreak: limitBreakLine(d, clash),
      riders: riders(d.band, d.npc)
    };
  }
  return {
    band,
    title: card.title,
    faces: card.faces.map((value, i) => ({ value, lucky: card.lucky[i], traded: card.traded?.[i], flipped: card.flipped?.[i], index: i })),
    total: cardTotal(card),
    luck: card.luck.map(name => game.i18n.format("PARADIGMENGINE.Roll.Luck", { name })),
    trades: (card.trades ?? []).map(t => game.i18n.format("PARADIGMENGINE.Clash.TradeLine", t)),
    flips: (card.flips ?? []).map(f => game.i18n.format("PARADIGMENGINE.Roll.FlipLine", f)),
    energy: card.energy > 0 ? game.i18n.localize("PARADIGMENGINE.Roll.ComboEnergy") : null,
    hearts: card.hearts > 0 ? game.i18n.localize("PARADIGMENGINE.Roll.FumbleHeart") : null,
    canFlip: canFlip(card)
  };
}

/* The single roll card, from its system flags: the card, and for a Clash
   roll the side's boxes as the flag recorded them, the ones this roll
   filled marked new. */
export async function renderRollCard(flags) {
  const context = rollCardContext(flags.card, !!flags.clash);
  if (flags.clash) {
    const c = flags.clash;
    const marks = c.marks ?? 0;
    const fresh = c.boxes ?? (c.marked ? 1 : 0);
    const boxes = Array.fromRange(c.target ?? 0).map(i => ({ on: i < marks, fresh: i >= marks - fresh && i < marks }));
    context.clash = { name: c.name, boxes };
  }
  return renderTemplate(`${TEMPLATES}/roll-card.hbs`, context);
}

/* Post an Action Roll: two dice and one optional flat bonus. difficulty is
   a DIFFICULTY index or null, raised by limitBreak steps. extra flags ride
   the message beside the card: { clash: { side, name } } for a Clash roll,
   and alias names the speaker in place of the actor, for a lettered copy.
   The card's state rides the message as a flag so Luck spends can
   re-render it. */
export async function postActionRoll(actor, first, second, bonus = 0, difficulty = null, limitBreak = 0, extra = {}) {
  const { roll, card } = await rollDice(first, second, bonus);
  if (difficulty !== null) setDifficulty(card, difficulty, limitBreak, actor?.type === "npc");
  await applyRollEffects(actor, card);
  const splash = readSplash(card.faces);
  const { alias, ...rest } = extra;
  const flags = { card, ...rest };
  if (splash) flags.splash = splash;
  const content = await renderRollCard(flags);
  return ChatMessage.implementation.create({
    content,
    rolls: [roll],
    sound: CONFIG.sounds.dice,
    speaker: ChatMessage.implementation.getSpeaker(alias ? { actor, alias } : { actor }),
    flags: { "paradigm-engine": flags }
  });
}

/* ----- shared cards: Opposed and Group Actions -----
   One card collects every participant's roll. Its state is the multi flag:
   { kind, difficulty, shiftsUsed, rows: [{ uuid, name, img, leader, card }] }.
   An Opposed Action compares totals once everyone has rolled: the highest
   wins, the rest lose a Heart, a tie stands as a tie. A Group Action rolls
   the supporters against the Difficulty, and each Success is a Shift the
   leader may spend to raise one of their own dice by one. */

export function multiRow(actor, leader = false) {
  return { uuid: actor.uuid, name: actor.name, img: actor.img, leader, card: null };
}

export async function postMultiCard(actor, kind, rows, difficulty = null) {
  const multi = { kind, difficulty, shiftsUsed: 0, rows };
  const content = await renderMultiCard(multi);
  return ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flags: { "paradigm-engine": { multi } }
  });
}

/* Shifts a Group Action has earned and not yet spent. */
export function shiftsLeft(multi) {
  const earned = multi.rows.filter(r => !r.leader && r.card && isSuccess(r.card.difficulty?.band)).length;
  return Math.max(0, earned - multi.shiftsUsed);
}

function multiContext(multi) {
  const group = multi.kind === "group";
  const rows = multi.rows.map((row, index) => ({
    index,
    uuid: row.uuid,
    name: row.name,
    img: row.img,
    leader: row.leader,
    card: row.card ? rollCardContext(row.card) : null
  }));
  const context = {
    group,
    title: game.i18n.localize(group ? "PARADIGMENGINE.Check.Group" : "PARADIGMENGINE.Check.Opposed"),
    rollLabel: game.i18n.localize("PARADIGMENGINE.Roll.Roll"),
    rows
  };
  if (group) {
    const step = DIFFICULTY[multi.difficulty];
    const left = shiftsLeft(multi);
    const leader = rows.find(r => r.leader);
    context.difficulty = { rank: step.rank, number: step.number, cssVar: step.cssVar };
    context.supporters = rows.filter(r => !r.leader);
    context.leader = leader;
    context.shifts = game.i18n.format("PARADIGMENGINE.Check.Shifts", { n: left });
    context.canShift = !!leader?.card && left > 0;
    if (context.canShift) {
      const card = multi.rows.find(r => r.leader).card;
      leader.card.faces.forEach((f, i) => { f.shiftable = card.faces[i] < card.maxes[i]; });
    }
  } else {
    const rolled = rows.filter(r => r.card);
    const done = rolled.length === rows.length;
    if (done) {
      const max = Math.max(...rows.map(r => r.card.total));
      const winners = rows.filter(r => r.card.total === max);
      const tie = winners.length > 1;
      for (const r of rows) {
        r.won = !tie && r.card.total === max;
        r.result = tie ? "" : r.won ? "" : game.i18n.localize("PARADIGMENGINE.Check.HeartLoss");
      }
      context.chip = tie
        ? game.i18n.localize("PARADIGMENGINE.Check.Tie")
        : game.i18n.format("PARADIGMENGINE.Check.Wins", { name: winners[0].name });
      context.done = true;
    } else {
      context.chip = game.i18n.format("PARADIGMENGINE.Check.Rolled", { n: rolled.length, total: rows.length });
    }
  }
  return context;
}

export function renderMultiCard(multi) {
  return renderTemplate(`${TEMPLATES}/multi-card.hbs`, multiContext(multi));
}

async function writeMulti(message, multi) {
  for (const row of multi.rows) if (row.card) await applyRollEffects(actorOf(row.uuid), row.card);
  const content = await renderMultiCard(multi);
  await message.update({ content, flags: { "paradigm-engine": { multi } } });
}

/* A participant's roll lands in its row, once. */
export async function applyMultiRoll(message, row, card, npc = false) {
  const multi = foundry.utils.deepClone(message.getFlag("paradigm-engine", "multi"));
  if (!multi || !multi.rows[row] || multi.rows[row].card) return;
  if (multi.kind === "group") setDifficulty(card, multi.difficulty, 0, npc);
  multi.rows[row].card = card;
  await writeMulti(message, multi);
}

/* A character dropped on a Group Action card joins as a supporter, once,
   while the leader has not rolled. */
export async function applyAddRow(message, row) {
  const multi = foundry.utils.deepClone(message.getFlag("paradigm-engine", "multi"));
  if (!multi || multi.kind !== "group" || !row?.uuid) return;
  if (multi.rows.find(r => r.leader)?.card || multi.rows.some(r => r.uuid === row.uuid)) return;
  multi.rows.push({ ...multiRow({ uuid: row.uuid, name: row.name, img: row.img }), leader: false });
  await writeMulti(message, multi);
}

/* The leader spends one Shift: the chosen die shows one higher, up to its
   size, and the band is read again. */
export async function applyShift(message, dieIndex) {
  const multi = foundry.utils.deepClone(message.getFlag("paradigm-engine", "multi"));
  const leader = multi?.rows.find(r => r.leader);
  const card = leader?.card;
  if (!card || !(dieIndex in card.faces) || shiftsLeft(multi) < 1) return;
  if (card.faces[dieIndex] >= card.maxes[dieIndex]) return;
  card.faces[dieIndex]++;
  multi.shiftsUsed++;
  rebandCard(card);
  await writeMulti(message, multi);
}

/* A die flips while its card stands on neither a Combo nor a Fumble and
   the card knows its dice sizes. */
export function canFlip(card) {
  return !!card?.maxes && readSplash(card.faces) === null;
}

/* Anyone flips one die of any roll to its other side, the face the die's
   size plus one minus the face it shows: a 2 on a d6 becomes a 5. The
   die shows blue with a line naming who flipped it, and the band is read
   again. row names a shared card's row, or null for a single roll card.
   A card standing on a Combo or a Fumble is refused. */
export async function applyFlip(message, dieIndex, name, row = null) {
  const stored = message.flags["paradigm-engine"] ?? {};
  const flip = card => {
    if (!card || !(dieIndex in card.faces) || !canFlip(card)) return false;
    const from = card.faces[dieIndex];
    const to = card.maxes[dieIndex] + 1 - from;
    card.faces[dieIndex] = to;
    card.flipped = card.faces.map((_, i) => !!card.flipped?.[i] || i === dieIndex);
    (card.flips ??= []).push({ name, from, to });
    rebandCard(card);
    return true;
  };
  if (row !== null) {
    const multi = foundry.utils.deepClone(stored.multi);
    if (!flip(multi?.rows[row]?.card)) return;
    return writeMulti(message, multi);
  }
  const card = foundry.utils.deepClone(stored.card);
  if (!flip(card)) return;
  await writeRollCard(message, stored, card);
}

/* Replace one die of a roll card with a spent Luck Die's recorded number and
   re-render. row names a shared card's row, or null for a single roll card.
   Runs on a client allowed to update the message; a spend that lands on a
   card already standing on a Fumble is refused. The splash flag updates
   when the Combo or Fumble state changes, and every client plays the
   splash from the update. */
export async function applyLuckSwap(message, dieIndex, value, spenderName, row = null) {
  const stored = message.flags["paradigm-engine"] ?? {};
  if (row !== null) {
    const multi = foundry.utils.deepClone(stored.multi);
    const card = multi?.rows[row]?.card;
    if (!card || !(dieIndex in card.faces) || readSplash(card.faces) === "fumble") return;
    card.faces[dieIndex] = value;
    card.lucky[dieIndex] = true;
    card.luck.push(spenderName);
    rebandCard(card);
    return writeMulti(message, multi);
  }
  const card = foundry.utils.deepClone(stored.card);
  if (!card || !(dieIndex in card.faces)) return;
  if (readSplash(card.faces) === "fumble") return;
  card.faces[dieIndex] = value;
  card.lucky[dieIndex] = true;
  card.luck.push(spenderName);
  rebandCard(card);
  await writeRollCard(message, stored, card);
}

/* Write a single roll card back: the card re-rendered over its stored
   flags, and the splash flag moved when the Combo or Fumble state changed,
   so every client plays the splash from the update. */
async function writeRollCard(message, stored, card) {
  await applyRollEffects(ChatMessage.implementation.getSpeakerActor(message.speaker), card);
  const splash = readSplash(card.faces);
  const flags = { "paradigm-engine": { card } };
  if (splash !== (stored.splash ?? null)) {
    flags["paradigm-engine"].splash = splash ?? new foundry.data.operators.ForcedDeletion();
  }
  await message.update({ content: await renderRollCard({ ...stored, card }), flags });
}

/* A Clash trade: one die of this roll swaps with one die of another roll
   of the same Clash, any side. Both cards re-band and re-render; the
   Clash marks follow on the Storyteller's client through the update hook.
   A Combo or a Fumble on either card stands. */
export async function applyTrade(message, dieIndex, otherId, otherIndex) {
  const other = game.messages.get(otherId);
  if (!other || other.id === message.id) return;
  const mine = foundry.utils.deepClone(message.flags["paradigm-engine"]?.card);
  const theirs = foundry.utils.deepClone(other.flags["paradigm-engine"]?.card);
  if (!mine || !theirs || !(dieIndex in mine.faces) || !(otherIndex in theirs.faces)) return;
  if (readSplash(mine.faces) || readSplash(theirs.faces)) return;
  const myName = message.speaker?.alias || message.author?.name || "";
  const theirName = other.speaker?.alias || other.author?.name || "";
  const a = mine.faces[dieIndex];
  const b = theirs.faces[otherIndex];
  mine.faces[dieIndex] = b;
  theirs.faces[otherIndex] = a;
  mine.traded = mine.faces.map((_, i) => !!mine.traded?.[i] || i === dieIndex);
  theirs.traded = theirs.faces.map((_, i) => !!theirs.traded?.[i] || i === otherIndex);
  (mine.trades ??= []).push({ mine: a, theirs: b, name: theirName });
  (theirs.trades ??= []).push({ mine: b, theirs: a, name: myName });
  rebandCard(mine);
  rebandCard(theirs);
  for (const [msg, card] of [[message, mine], [other, theirs]]) {
    await writeRollCard(msg, msg.flags["paradigm-engine"] ?? {}, card);
  }
}

/* ----- the card relay -----
   A change to a shared card applies directly when this user may update the
   message, else through the active Storyteller over the system socket. */

export const SOCKET = "system.paradigm-engine";

export async function applyCardOp(message, op) {
  switch (op.type) {
    case "luckSwap": return applyLuckSwap(message, op.dieIndex, op.value, op.name, op.row ?? null);
    case "multiRoll": return applyMultiRoll(message, op.row, op.card, op.npc);
    case "shift": return applyShift(message, op.dieIndex);
    case "addRow": return applyAddRow(message, op.row);
    case "trade": return applyTrade(message, op.dieIndex, op.otherId, op.otherIndex);
    case "flip": return applyFlip(message, op.dieIndex, op.name, op.row ?? null);
  }
}

/* A trade touches two messages, and a row op another character's Energy,
   so those always go through the Storyteller. */
export async function cardOp(message, op) {
  const direct = game.user.isGM || (op.type !== "trade" && op.row == null && message.canUserModify(game.user, "update"));
  if (direct) return applyCardOp(message, op);
  if (!game.users.activeGM) {
    ui.notifications.warn("PARADIGMENGINE.Check.NoStoryteller", { localize: true });
    return;
  }
  game.socket.emit(SOCKET, { type: "cardOp", messageId: message.id, op });
}

/* ----- the message takeover -----
   A message holding one of our cards drops Foundry's header line and
   wears the card as the whole message: a dark band at the top carries the
   speaker's token art cut in at the left, the alias in Reggae One, the
   actor type under it, and Foundry's own time and delete control moved in
   from the header, with the card's kind tag hanging off the band's foot.
   The band inverts with the Theme setting through the card's variables. */

/* The band's picture: the actor's portrait in its frame, else the
   token's art. */
function speakerArt(speaker, actor) {
  const portrait = portraitOf(actor);
  if (portrait) return { src: portrait, style: frameStyle(frameOf(actor)) };
  const token = speaker?.scene && speaker?.token ? game.scenes.get(speaker.scene)?.tokens.get(speaker.token) : null;
  const src = token?.texture?.src ?? "";
  if (!src || /\.svg(\?.*)?$/i.test(src)) return null;
  return { src, style: "" };
}

export function dressMessage(message, html) {
  const card = html.querySelector(".pe-card");
  if (!card || card.querySelector(":scope > .band")) return;
  html.classList.add("pe-msg");
  const speaker = message.speaker;
  const actor = speaker?.actor ? game.actors.get(speaker.actor) : null;
  const picture = speakerArt(speaker, actor);
  const band = document.createElement("div");
  band.className = "band";
  if (picture) {
    const art = document.createElement("div");
    art.className = "art";
    const image = document.createElement("img");
    image.src = picture.src;
    image.alt = "";
    if (picture.style) image.style.cssText = picture.style;
    art.append(image);
    band.append(art);
  }
  const who = document.createElement("div");
  who.className = "who";
  const name = document.createElement("span");
  name.className = "bname";
  name.textContent = speaker?.alias || message.author?.name || "";
  who.append(name);
  if (actor) {
    const sub = document.createElement("span");
    sub.className = "bsub";
    sub.textContent = game.i18n.localize(CONFIG.Actor.typeLabels[actor.type] ?? "");
    who.append(sub);
  }
  band.append(who);
  const meta = html.querySelector(".message-header .message-metadata");
  if (meta) {
    meta.classList.add("bmeta");
    band.append(meta);
  }
  const tag = card.querySelector(":scope > .ctag");
  if (tag) band.append(tag);
  card.prepend(band);
}

export function registerChat() {
  Hooks.on("renderChatMessageHTML", (message, html) => dressMessage(message, html));
}
