import ParadigmEngineSheet from "./mixin.mjs";
import { frameOf, frameStyle, portraitOf } from "../portrait.mjs";
import { LADDER } from "../config.mjs";
import { startGroup } from "../checks.mjs";
import { ensurePartyFolder, joinParty, leaveParty, partyMembers } from "../party.mjs";
import ClashWindow from "../apps/clash.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;

/* The Party File: a menu of pages on the left, the party name over the
   page, and the Members page as a row of cards read live from each PC in
   the party's folder. A PC dropped on the sheet moves into the folder;
   the cross on its card in Edit moves it out. Lead on a card starts a
   Group Action with that PC as leader. */
export default class PartySheet extends ParadigmEngineSheet(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["actor", "party"],
    position: { width: 880, height: 640 },
    actions: {
      openMember: this.#onOpenMember,
      lead: this.#onLead,
      removeMember: this.#onRemoveMember,
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
      tabs: [{ id: "members" }, { id: "notes" }],
      initial: "members",
      labelPrefix: "PARADIGMENGINE.Party.Tab"
    }
  };

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
    return context;
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

  /* A PC dropped anywhere on the sheet moves into the party's folder. */
  async _onDropActor(event, actor) {
    if (!this.isEditable || actor.type !== "pc" || !actor.isOwner) return;
    await joinParty(this.document, actor);
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
