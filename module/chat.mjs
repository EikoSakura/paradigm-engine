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
   on double 1s, Combo on doubles of 6 or higher, then the Difficulty
   itself: reach its number and the roll succeeds, below it fails. NPC
   results read the same way. */
export function evaluateBand(faces, total, effective, npc = false) {
  const splash = readSplash(faces);
  if (splash === "fumble") return "Fumble";
  if (splash === "combo") return "Combo";
  return total >= DIFFICULTY[effective].number ? "Success" : "Failure";
}

export function isSuccess(band) {
  return band === "Success" || band === "Combo";
}

/* The one rider: a PC's Fumble cannot be altered by Luck Dice. */
function riders(band, npc) {
  if (npc || band !== "Fumble") return [];
  return [{ key: "Luck", text: game.i18n.localize("PARADIGMENGINE.Rider.Luck") }];
}

/* The die size behind a Ladder step: the d12 of d12+2. */
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

/* Roll two dice, backed by a real Roll. first and second are { name, rank }
   with any die steps already applied. The card keeps the faces, so Luck
   replacements and Shifts re-total; its bonus holds the flat part of the
   formula, the +2 of an S die, which counts in the total and shows no
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

/* Template context from a roll card's stored state. */
export function rollCardContext(card) {
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
      limitBreak: d.limitBreak > 0 ? game.i18n.format("PARADIGMENGINE.Roll.LimitBreakTag", { n: d.limitBreak }) : null,
      riders: riders(d.band, d.npc)
    };
  }
  return {
    band,
    title: card.title,
    faces: card.faces.map((value, i) => ({ value, lucky: card.lucky[i], index: i })),
    total: cardTotal(card),
    luck: card.luck.map(name => game.i18n.format("PARADIGMENGINE.Roll.Luck", { name }))
  };
}

/* The single roll card, from its system flags: the card, and for a Clash
   roll the side's boxes as the flag recorded them, the one this roll
   filled marked new. */
export async function renderRollCard(flags) {
  const context = rollCardContext(flags.card);
  if (flags.clash) {
    const c = flags.clash;
    const marks = c.marks ?? 0;
    const boxes = Array.fromRange(c.target ?? 0).map(i => ({ on: i < marks, fresh: c.marked && i === marks - 1 }));
    context.clash = { name: c.name, boxes };
  }
  return renderTemplate(`${TEMPLATES}/roll-card.hbs`, context);
}

/* Post an Action Roll: two dice and one optional flat bonus. difficulty is
   a DIFFICULTY index or null, raised by limitBreak steps. extra flags ride
   the message beside the card: { clash: { side, name } } for a Clash roll.
   The card's state rides the message as a flag so Luck spends can
   re-render it. */
export async function postActionRoll(actor, first, second, bonus = 0, difficulty = null, limitBreak = 0, extra = {}) {
  const { roll, card } = await rollDice(first, second, bonus);
  if (difficulty !== null) setDifficulty(card, difficulty, limitBreak, actor?.type === "npc");
  const splash = readSplash(card.faces);
  const flags = { card, ...extra };
  if (splash) flags.splash = splash;
  const content = await renderRollCard(flags);
  return ChatMessage.implementation.create({
    content,
    rolls: [roll],
    sound: CONFIG.sounds.dice,
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
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
  const splash = readSplash(card.faces);
  const prior = stored.splash ?? null;
  const flags = { "paradigm-engine": { card } };
  if (splash !== prior) {
    if (splash) flags["paradigm-engine"].splash = splash;
    else flags["paradigm-engine"].splash = new foundry.data.operators.ForcedDeletion();
  }
  const content = await renderRollCard({ ...stored, card });
  await message.update({ content, flags });
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
  }
}

export async function cardOp(message, op) {
  if (message.canUserModify(game.user, "update")) return applyCardOp(message, op);
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
