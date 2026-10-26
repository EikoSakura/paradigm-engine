/* The Checks: Opposed Actions, Group Actions, and Clash rolls. The sheet's
   Checks card starts them, the chat cards collect the rolls, and the
   buttons on those cards open the Action Roll popup for the character
   they belong to. The Storyteller may press any of them; a player only the
   ones for characters they own. */

import RollDialog from "./apps/roll-dialog.mjs";
import ClashWindow, { clashRolls, clashRunning, clashSideOf } from "./apps/clash.mjs";
import TradePicker from "./apps/trade-picker.mjs";
import ActionSetup from "./apps/action-setup.mjs";
import { SOCKET, applyCardOp, cardOp, multiRow, readSplash, rollDice, showRoll } from "./chat.mjs";

const { TextEditor } = foundry.applications.ux;

/* The Actor behind a UUID: an Actor's own, or a Token's. */
export function actorFromUuid(uuid) {
  const doc = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  if (doc instanceof Actor) return doc;
  return doc?.actor ?? null;
}

/* An Opposed Action: the setup window, this actor first and the user's
   targets after, more dragged in; Begin posts the card. */
export function startOpposed(actor) {
  ActionSetup.open(actor, "opposed");
}

/* A Group Action: the setup window, this actor leading and the rest of
   its Party supporting, more dragged in, the Difficulty picked there;
   Begin posts the card. The Storyteller can still drop supporters onto
   the posted card. */
export function startGroup(actor) {
  ActionSetup.open(actor, "group");
}

/* A Clash roll for the side this actor stands on. */
export function startClashRoll(actor, anchor) {
  const side = clashSideOf(actor);
  if (!side) return ui.notifications.warn("PARADIGMENGINE.Check.NotInClash", { localize: true });
  RollDialog.open(actor, null, anchor, {
    tag: side.name,
    extra: { clash: { side: side.index, name: side.name, marks: side.marks, target: side.target, clashId: side.clashId } }
  });
}

/* The Trade button on a Clash roll card: for the roller while the Clash
   runs, the card is no Combo or Fumble, and another roll of the Clash is
   there to trade with. */
function wireTrade(message, flags, html) {
  const button = html.querySelector(".tradebtn");
  if (!button) return;
  const actor = ChatMessage.implementation.getSpeakerActor(message.speaker);
  const open = actor?.isOwner && clashRunning(flags.clash.clashId) && readSplash(flags.card.faces) === null
    && clashRolls(flags.clash.clashId).some(m => m.id !== message.id);
  if (!open) return button.remove();
  button.addEventListener("click", () => TradePicker.open(message));
}

/* Who a flip is recorded under: this user's character, else the user. */
function flipperName() {
  return game.user.character?.name || game.user.name;
}

/* The Flip button on a single roll card, for anyone: pressed, the dice
   wait for a click and the one clicked flips to its other side; pressed
   again, they stand down. The face click is caught ahead of the Luck
   spend the same face offers. */
function wireFlip(message, html) {
  const button = html.querySelector(".flipbtn");
  if (!button) return;
  const card = button.closest(".pe-card");
  button.addEventListener("click", () => {
    const on = card.classList.toggle("flipping");
    button.classList.toggle("on", on);
  });
  for (const face of card.querySelectorAll(".dicerow .face")) {
    face.addEventListener("click", event => {
      if (!card.classList.contains("flipping")) return;
      event.stopImmediatePropagation();
      card.classList.remove("flipping");
      button.classList.remove("on");
      cardOp(message, { type: "flip", dieIndex: Number(face.dataset.index), name: flipperName() });
    }, true);
  }
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
    for (const button of html.querySelectorAll(".flipglyph")) {
      const row = Number(button.closest("[data-row]").dataset.row);
      button.addEventListener("click", () => cardOp(message, { type: "flip", dieIndex: Number(button.dataset.index), name: flipperName(), row }));
    }
  }
  if (flags.card) wireFlip(message, html);
  if (flags.clash && flags.card) wireTrade(message, flags, html);
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
