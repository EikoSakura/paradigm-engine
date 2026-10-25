/* The Checks: Opposed Actions, Group Actions, and Clash rolls. The sheet's
   Checks card starts them, the chat cards collect the rolls, and the
   buttons on those cards open the Action Roll popup for the character
   they belong to. The Storyteller may press any of them; a player only the
   ones for characters they own. */

import RollDialog from "./apps/roll-dialog.mjs";
import ClashWindow, { clashSideOf } from "./apps/clash.mjs";
import { SOCKET, applyCardOp, cardOp, multiRow, postMultiCard, rollDice, showRoll } from "./chat.mjs";
import { partyMembers, partyOf } from "./party.mjs";

const { TextEditor } = foundry.applications.ux;

/* The Actor behind a UUID: an Actor's own, or a Token's. */
export function actorFromUuid(uuid) {
  const doc = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  if (doc instanceof Actor) return doc;
  return doc?.actor ?? null;
}

/* The user's targets as actors, in target order, without the given one. */
function targetActors(except) {
  const seen = new Set([except?.uuid]);
  const out = [];
  for (const token of game.user.targets) {
    const actor = token.actor;
    if (!actor || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    out.push(actor);
  }
  return out;
}

/* An Opposed Action: this actor and every targeted character, each a row. */
export async function startOpposed(actor) {
  const others = targetActors(actor);
  if (!others.length) return ui.notifications.warn("PARADIGMENGINE.Check.NeedTargets", { localize: true });
  const rows = [multiRow(actor), ...others.map(a => multiRow(a))];
  await postMultiCard(actor, "opposed", rows);
}

/* A Group Action: this actor leads, the rest of its Party supports. The
   Difficulty is picked first, in the popup under the button. A leader
   with no party, or alone in one, still posts the card, so the
   Storyteller can drop supporters onto it. */
export function startGroup(actor, anchor) {
  const party = partyOf(actor);
  const others = party ? partyMembers(party).filter(a => a.id !== actor.id) : [];
  RollDialog.open(actor, null, anchor, {
    title: game.i18n.localize("PARADIGMENGINE.Check.Group"),
    difficulty: "only",
    submit: async ({ difficulty }) => {
      const rows = [multiRow(actor, true), ...others.map(a => multiRow(a))];
      await postMultiCard(actor, "group", rows, difficulty);
    }
  });
}

/* A Clash roll for the side this actor stands on. */
export function startClashRoll(actor, anchor) {
  const side = clashSideOf(actor);
  if (!side) return ui.notifications.warn("PARADIGMENGINE.Check.NotInClash", { localize: true });
  RollDialog.open(actor, null, anchor, {
    tag: side.name,
    extra: { clash: { side: side.index, name: side.name, marks: side.marks, target: side.target } }
  });
}

/* A row's roll from a shared card: the popup under the button, the dice
   shown, the result relayed onto the card. */
function rollRow(message, multi, row, actor, anchor) {
  const group = multi.kind === "group";
  RollDialog.open(actor, null, anchor, {
    title: game.i18n.localize(group ? "PARADIGMENGINE.Check.Group" : "PARADIGMENGINE.Check.Opposed"),
    difficulty: group ? { locked: multi.difficulty } : "none",
    submit: async ({ first, second }) => {
      const { roll, card } = await rollDice(first, second);
      await showRoll(roll);
      await cardOp(message, { type: "multiRoll", row, card, npc: actor.type === "npc" });
    }
  });
}

/* The Storyteller drops a character from the Actors directory onto a
   Group Action card to add it as a supporter, until the leader rolls. */
function wireDrop(message, multi, html) {
  if (!game.user.isGM || multi.kind !== "group") return;
  if (multi.rows.find(r => r.leader)?.card) return;
  html.addEventListener("dragover", event => {
    event.preventDefault();
    html.classList.add("dragover");
  });
  html.addEventListener("dragleave", event => {
    if (!html.contains(event.relatedTarget)) html.classList.remove("dragover");
  });
  html.addEventListener("drop", async event => {
    event.preventDefault();
    html.classList.remove("dragover");
    const data = TextEditor.implementation.getDragEventData(event);
    if (data.type !== "Actor") return;
    const actor = await Actor.implementation.fromDropData(data);
    if (!actor) return;
    await cardOp(message, { type: "addRow", row: multiRow(actor) });
  });
}

/* Keep on a card only the buttons this user may press, and wire them. */
function wireCard(message, html) {
  const flags = message.flags["paradigm-engine"] ?? {};
  const multi = flags.multi;
  if (multi) {
    wireDrop(message, multi, html);
    for (const button of html.querySelectorAll(".mroll")) {
      const row = Number(button.dataset.row);
      const actor = actorFromUuid(multi.rows[row]?.uuid);
      if (!actor?.isOwner || multi.rows[row].card) {
        button.remove();
        continue;
      }
      button.addEventListener("click", () => rollRow(message, multi, row, actor, button));
    }
    const leader = multi.rows.find(r => r.leader);
    const leaderActor = leader ? actorFromUuid(leader.uuid) : null;
    for (const button of html.querySelectorAll(".shiftbtn")) {
      if (!leaderActor?.isOwner) {
        button.remove();
        continue;
      }
      button.addEventListener("click", () => cardOp(message, { type: "shift", dieIndex: Number(button.dataset.index) }));
    }
  }
  if (flags.clashLive) {
    for (const button of html.querySelectorAll(".clroll")) {
      const actor = actorFromUuid(button.dataset.uuid);
      if (!actor?.isOwner) {
        button.remove();
        continue;
      }
      button.addEventListener("click", () => startClashRoll(actor, button));
    }
    html.querySelector(".openclash")?.addEventListener("click", () => ClashWindow.open());
  }
}

export function registerChecks() {
  Hooks.on("renderChatMessageHTML", (message, html) => wireCard(message, html));

  /* The Storyteller's side of the card relay. */
  game.socket.on(SOCKET, async data => {
    if (data?.type !== "cardOp") return;
    if (game.users.activeGM?.isSelf !== true) return;
    const message = game.messages.get(data.messageId);
    if (message) await applyCardOp(message, data.op);
  });
}
