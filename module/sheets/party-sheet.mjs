import ParadigmEngineSheet from "./mixin.mjs";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, frameOf, frameStyle, portraitOf, wireFrameDrag } from "../portrait.mjs";
import { LADDER } from "../config.mjs";
import { STANDINGS } from "../data/party.mjs";
import { startGroup } from "../checks.mjs";
import { ensurePartyFolder, joinParty, leaveParty, partyMembers } from "../party.mjs";
import ClashWindow from "../apps/clash.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;

/* The standing stamp colors. */
const STANDING_COLORS = { ally: "--green", neutral: "--yellow", enemy: "--pink", unknown: "--muted" };

/* The Party File: a menu of pages on the left, the party name over the
   page, and the Members page as a row of cards read live from each PC in
   the party's folder. A PC dropped on the sheet moves into the folder;
   the cross on its card in Edit moves it out. Lead on a card starts a
   Group Action with that PC as leader.

   The Dossier page is a deck of NPC cards: an NPC dropped on the sheet by
   the GM becomes a card reading its portrait and name live, with a
   standing stamp and a title on the front and the GM's notes on the
   back; a click flips it. In Edit the GM frames the portrait as on the
   NPC File, writes the back, sets the standing, and hides the card,
   which players then see face down. */
export default class PartySheet extends ParadigmEngineSheet(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["actor", "party"],
    position: { width: 880, height: 640 },
    actions: {
      openMember: this.#onOpenMember,
      lead: this.#onLead,
      removeMember: this.#onRemoveMember,
      flipCard: this.#onFlipCard,
      removeCard: this.#onRemoveCard,
      setStanding: this.#onSetStanding,
      toggleHidden: this.#onToggleHidden,
      stepCardZoom: this.#onStepCardZoom,
      openClash: this.#onOpenClash,
      newScene: this.#onNewScene
    }
  };

  static PARTS = {
    menu: { template: "systems/paradigm-engine/templates/actor/party-menu.hbs" },
    page: { template: "systems/paradigm-engine/templates/actor/party-page.hbs" }
  };

  static TABS = {
    primary: {
      tabs: [{ id: "members" }, { id: "dossier" }, { id: "notes" }],
      initial: "members",
      labelPrefix: "PARADIGMENGINE.Party.Tab"
    }
  };

  /* The Dossier cards showing their back. Display state only. */
  #flipped = new Set();

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    await ensurePartyFolder(this.document);
    const system = this.document.system;
    context.system = system;
    context.editMode = this.isEditMode;
    context.name = this.document.name;
    context.img = this.document.img;
    context.emblem = this.document.img === foundry.documents.BaseActor.DEFAULT_ICON ? "" : this.document.img;
    context.initial = (this.document.name || "?").trim().charAt(0).toUpperCase() || "?";
    context.members = partyMembers(this.document).map(PartySheet.#card);
    context.canAdd = this.isEditable;
    context.isGM = game.user.isGM;
    context.count = String(context.members.length);
    context.dossierEdit = context.editMode && context.isGM;
    context.dossier = this.#dossierCards(context.dossierEdit);
    context.dossierCount = String(context.dossier.length);
    return context;
  }

  /* The Dossier cards. Players see a hidden card face down and no card
     for an NPC that is gone; the GM sees every card, a gone NPC's as a
     blank to remove. */
  #dossierCards(edit) {
    const isGM = game.user.isGM;
    const cards = [];
    this.document.system.dossier.forEach((entry, index) => {
      const actor = fromUuidSync(entry.uuid);
      if (!isGM && (entry.hidden || !actor)) {
        if (entry.hidden) cards.push({ index, veiled: true });
        return;
      }
      const name = actor?.name ?? "";
      cards.push({
        index,
        uuid: entry.uuid,
        name,
        portrait: portraitOf(actor),
        frameStyle: frameStyle(frameOf(actor)),
        initial: (name || "?").trim().charAt(0).toUpperCase() || "?",
        standing: entry.standing,
        standingLabel: game.i18n.localize(`PARADIGMENGINE.Party.Standing.${entry.standing}`),
        cssVar: STANDING_COLORS[entry.standing] ?? "--muted",
        standings: edit ? STANDINGS.map(key => ({
          key,
          label: game.i18n.localize(`PARADIGMENGINE.Party.Standing.${key}`),
          on: key === entry.standing
        })) : [],
        title: entry.title,
        affiliation: entry.affiliation,
        lastSeen: entry.lastSeen,
        known: entry.known,
        hidden: entry.hidden,
        flipped: this.#flipped.has(entry.uuid),
        edit
      });
    });
    return cards;
  }

  /* The Dossier inputs cover only some columns of each row; keep the
     rest from the stored row. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const rows = data.system?.dossier;
    if (rows && foundry.utils.getType(rows) === "Object") {
      const source = this.document.system.toObject().dossier;
      data.system.dossier = Object.entries(rows).map(([i, row]) => ({ ...source[Number(i)], ...row }));
    }
    return data;
  }

  /* In Edit the GM drags a card's portrait inside its frame, as on the
     NPC File: the frame is the NPC's own. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!context.dossierEdit) return;
    for (const img of this.element.querySelectorAll(".dc img.framing")) {
      const actor = fromUuidSync(img.closest(".dc")?.dataset.uuid ?? "");
      if (actor) wireFrameDrag(img, frameOf(actor), frame => actor.setFlag("paradigm-engine", "frame", frame));
    }
  }

  /* One member card: the PC as it stands now. */
  static #card(actor) {
    const system = actor.system;
    const step = LADDER[system.rank];
    const pips = ({ value, max }) => Array.from({ length: max }, (_, i) => i < value);
    return {
      uuid: actor.uuid,
      name: actor.name,
      portrait: portraitOf(actor),
      frameStyle: frameStyle(frameOf(actor)),
      initial: (actor.name || "?").trim().charAt(0).toUpperCase() || "?",
      player: system.player,
      rank: step.rank,
      cssVar: step.cssVar,
      hearts: pips(system.hearts),
      energy: pips(system.energy),
      luck: system.luck,
      luckDie: system.luckDie,
      owner: actor.isOwner
    };
  }

  /* A PC dropped anywhere on the sheet moves into the party's folder; an
     NPC dropped by the GM joins the Dossier. */
  async _onDropActor(event, actor) {
    if (!this.isEditable) return;
    if (actor.type === "pc" && actor.isOwner) return joinParty(this.document, actor);
    if (actor.type === "npc" && game.user.isGM && !actor.isToken) {
      const dossier = this.document.system.toObject().dossier;
      if (dossier.some(e => e.uuid === actor.uuid)) return;
      dossier.push({ uuid: actor.uuid });
      await this.document.update({ "system.dossier": dossier });
    }
  }

  /* ----- the Dossier ----- */

  /* A flip turns the card in place and is remembered across renders. */
  static #onFlipCard(event, target) {
    const card = target.closest(".dc");
    const uuid = card?.dataset.uuid;
    if (!uuid) return;
    const flipped = card.classList.toggle("flip");
    if (flipped) this.#flipped.add(uuid);
    else this.#flipped.delete(uuid);
  }

  async #updateCard(index, changes) {
    if (!this.isEditable || !game.user.isGM) return;
    const dossier = this.document.system.toObject().dossier;
    if (!dossier[index]) return;
    Object.assign(dossier[index], changes);
    await this.document.update({ "system.dossier": dossier });
  }

  static async #onRemoveCard(event, target) {
    if (!this.isEditable || !game.user.isGM) return;
    const index = Number(target.dataset.i);
    const dossier = this.document.system.toObject().dossier.filter((_, i) => i !== index);
    await this.document.update({ "system.dossier": dossier });
  }

  static async #onSetStanding(event, target) {
    const standing = target.dataset.standing;
    if (STANDINGS.includes(standing)) await this.#updateCard(Number(target.dataset.i), { standing });
  }

  static async #onToggleHidden(event, target) {
    const entry = this.document.system.dossier[Number(target.dataset.i)];
    if (entry) await this.#updateCard(Number(target.dataset.i), { hidden: !entry.hidden });
  }

  /* The card portrait's zoom, written to the NPC's own frame. */
  static async #onStepCardZoom(event, target) {
    if (!this.isEditable || !game.user.isGM) return;
    const actor = fromUuidSync(target.closest(".dc")?.dataset.uuid ?? "");
    if (!actor) return;
    const frame = frameOf(actor);
    const zoom = Math.clamp(Math.round((frame.zoom + Number(target.dataset.dir) * ZOOM_STEP) * 10) / 10, ZOOM_MIN, ZOOM_MAX);
    if (zoom === frame.zoom) return;
    await actor.setFlag("paradigm-engine", "frame", { ...frame, zoom });
  }

  static #onOpenMember(event, target) {
    fromUuidSync(target.dataset.uuid)?.sheet.render(true);
  }

  static #onLead(event, target) {
    const actor = fromUuidSync(target.dataset.uuid);
    if (actor) startGroup(actor, target);
  }

  static async #onRemoveMember(event, target) {
    if (!this.isEditable) return;
    const actor = fromUuidSync(target.dataset.uuid);
    if (actor?.isOwner) await leaveParty(this.document, actor);
  }

  static #onOpenClash() {
    ClashWindow.open();
  }

  /* A new scene: every member's Bonds may be invoked again. */
  static async #onNewScene() {
    if (!game.user.isGM) return;
    for (const actor of partyMembers(this.document)) {
      const bonds = actor.system.toObject().bonds;
      if (!bonds.some(b => b.invoked)) continue;
      await actor.update({ "system.bonds": bonds.map(b => ({ ...b, invoked: false })) });
    }
  }
}
