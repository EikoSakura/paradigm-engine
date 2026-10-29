import ParadigmEngineSheet from "./mixin.mjs";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, frameOf, frameStyle, portraitOf, wireFrameDrag } from "../portrait.mjs";
import { LADDER, energyCost } from "../config.mjs";
import { LORE_KINDS, STANDINGS } from "../data/party.mjs";
import { resolveRank, worldUuid } from "../skills.mjs";
import { startGroup } from "../checks.mjs";
import { ensurePartyFolder, joinParty, leaveParty, partyMembers } from "../party.mjs";
import ClashWindow from "../apps/clash.mjs";
import { clearChain } from "../chat.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;

/* The standing stamp colors. */
const STANDING_COLORS = { ally: "--green", neutral: "--yellow", enemy: "--pink", unknown: "--muted" };

/* The Lore kinds' colors, on the tab and the deck under it. */
const KIND_COLORS = { species: "--green", faction: "--pink", place: "--violet", item: "--gold" };

/* The lines a Lore card's back carries after its text, by kind: the
   names line and the place line. An item's names line is who holds it
   and it has no place line. */
const KIND_LINES = {
  species: { names: "Members", place: "Homeworld" },
  faction: { names: "Members", place: "Base" },
  place: { names: "Notable", place: "Scene" },
  item: { names: "HeldBy", place: "" }
};

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
   which players then see face down.

   The Lore page is a tab per kind, Species, Factions, Places, Items, over
   a deck of the same cards, each written by the GM from nothing: a
   picture, name and subtitle on the front, the text and the kind's lines
   on the back. A species' back lists the Skills dropped on it, each
   reading its Rank and cost from the world Skill and opening it. A name
   on a card that is a party member's or a Dossier NPC's opens them. */
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
      setLoreKind: this.#onSetLoreKind,
      addLore: this.#onAddLore,
      removeLore: this.#onRemoveLore,
      setLoreStanding: this.#onSetLoreStanding,
      toggleLoreHidden: this.#onToggleLoreHidden,
      pickLoreImage: this.#onPickLoreImage,
      unlinkSkill: this.#onUnlinkSkill,
      openSkill: this.#onOpenSkill,
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
      tabs: [{ id: "members" }, { id: "dossier" }, { id: "lore" }, { id: "notes" }],
      initial: "members",
      labelPrefix: "PARADIGMENGINE.Party.Tab"
    }
  };

  /* The cards showing their back: a Dossier card by its NPC's uuid, a
     Lore card by its index. Display state only. */
  #flipped = new Set();

  /* The Lore tab open. */
  #loreKind = "species";

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
    context.loreEdit = context.dossierEdit;
    context.loreKind = this.#loreKind;
    context.loreKindVar = KIND_COLORS[this.#loreKind];
    context.addLabel = game.i18n.localize(`PARADIGMENGINE.Party.Lore.One.${this.#loreKind}`);
    context.lore = this.#loreCards(context.loreEdit);
    const counts = this.#loreCounts();
    context.loreKinds = LORE_KINDS.map(key => ({
      key,
      label: game.i18n.localize(`PARADIGMENGINE.Party.Lore.Kind.${key}`),
      cssVar: KIND_COLORS[key],
      count: String(counts[key]),
      on: key === this.#loreKind
    }));
    context.loreCount = String(LORE_KINDS.reduce((n, key) => n + counts[key], 0));
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
        standings: edit ? this.#standings(entry.standing) : [],
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

  #standings(current) {
    return STANDINGS.map(key => ({
      key,
      label: game.i18n.localize(`PARADIGMENGINE.Party.Standing.${key}`),
      on: key === current
    }));
  }

  /* ----- the Lore ----- */

  /* How many cards each tab holds, as the user sees them. */
  #loreCounts() {
    const counts = Object.fromEntries(LORE_KINDS.map(key => [key, 0]));
    for (const entry of this.document.system.lore) counts[entry.kind] += 1;
    return counts;
  }

  /* The cards of the open tab. Players see a hidden card face down. */
  #loreCards(edit) {
    const isGM = game.user.isGM;
    const cards = [];
    this.document.system.lore.forEach((entry, index) => {
      if (entry.kind !== this.#loreKind) return;
      if (!isGM && entry.hidden) {
        cards.push({ index, veiled: true });
        return;
      }
      const lines = KIND_LINES[entry.kind];
      cards.push({
        index,
        kind: entry.kind,
        kindLabel: game.i18n.localize(`PARADIGMENGINE.Party.Lore.One.${entry.kind}`),
        isSpecies: entry.kind === "species",
        isFaction: entry.kind === "faction",
        name: entry.name,
        sub: entry.sub,
        img: entry.img,
        initial: (entry.name || "?").trim().charAt(0).toUpperCase() || "?",
        text: entry.text,
        standing: entry.standing,
        standingLabel: game.i18n.localize(`PARADIGMENGINE.Party.Standing.${entry.standing}`),
        standingVar: STANDING_COLORS[entry.standing] ?? "--muted",
        standings: edit ? this.#standings(entry.standing) : [],
        skills: entry.skills.map(PartySheet.#skillRow),
        members: entry.members,
        names: PartySheet.#names(entry.members),
        membersLabel: game.i18n.localize(`PARADIGMENGINE.Party.Lore.${lines.names}`),
        place: entry.place,
        placeLabel: lines.place ? game.i18n.localize(`PARADIGMENGINE.Party.Lore.${lines.place}`) : "",
        hidden: entry.hidden,
        flipped: this.#flipped.has(`lore:${index}`),
        edit
      });
    });
    return cards;
  }

  /* One linked Skill: its Rank and Technique cost read from the world
     Skill when it is there, the kept name otherwise. Opens for a user
     with leave to see it. */
  static #skillRow({ uuid, name }) {
    const item = uuid ? fromUuidSync(uuid, { strict: false }) : null;
    const skill = item instanceof Item && item.type === "skill" ? item : null;
    const step = skill ? LADDER[resolveRank(skill)] : null;
    const cost = skill ? energyCost(skill.system) : 0;
    return {
      uuid,
      name: skill?.name ?? name,
      rank: step?.rank ?? "·",
      cssVar: step?.cssVar ?? "--muted",
      cost: cost ? String(cost) : "",
      open: skill?.testUserPermission(game.user, "LIMITED") ?? false
    };
  }

  /* The names on a card's names line, one per comma or line; a name the
     user can open as an actor carries its uuid. */
  static #names(text) {
    return (text || "").split(/[,\n]/).map(s => s.trim()).filter(Boolean).map(name => {
      const actor = game.actors.getName(name);
      return { name, uuid: actor?.testUserPermission(game.user, "LIMITED") ? actor.uuid : "" };
    });
  }

  /* The Dossier and Lore inputs cover only some columns of each row;
     keep the rest from the stored row. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    for (const key of ["dossier", "lore"]) {
      const rows = data.system?.[key];
      if (!rows || foundry.utils.getType(rows) !== "Object") continue;
      const source = this.document.system.toObject()[key];
      data.system[key] = source.map((row, i) => ({ ...row, ...(rows[i] ?? {}) }));
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
     NPC dropped by the GM joins the Dossier. Either dropped on a Lore
     card in Edit goes on its names line instead. */
  async _onDropActor(event, actor) {
    if (!this.isEditable) return;
    const loreIndex = this.#loreTarget(event);
    if (loreIndex !== null) return this.#addName(loreIndex, actor.name);
    if (actor.type === "pc" && actor.isOwner) return joinParty(this.document, actor);
    if (actor.type === "npc" && game.user.isGM && !actor.isToken) {
      const dossier = this.document.system.toObject().dossier;
      if (dossier.some(e => e.uuid === actor.uuid)) return;
      dossier.push({ uuid: actor.uuid });
      await this.document.update({ "system.dossier": dossier });
    }
  }

  /* A Skill dropped on a species card in Edit links it, by its world
     Skill. Nothing else dropped lands on the Party. */
  async _onDropItem(event, item) {
    if (item.type !== "skill") return;
    const index = this.#loreTarget(event);
    if (index === null) return;
    const lore = this.document.system.toObject().lore;
    const entry = lore[index];
    if (entry?.kind !== "species") return;
    const uuid = worldUuid(item);
    if (entry.skills.some(s => s.uuid === uuid)) return;
    entry.skills.push({ uuid, name: item.name });
    await this.document.update({ "system.lore": lore });
  }

  /* The index of the Lore card a drop landed on in Edit, else null. */
  #loreTarget(event) {
    if (!this.isEditable || !game.user.isGM || !this.isEditMode) return null;
    const card = event.target.closest?.(".dc[data-lore]");
    return card ? Number(card.dataset.lore) : null;
  }

  async #addName(index, name) {
    const entry = this.document.system.lore[index];
    if (!entry) return;
    const names = PartySheet.#names(entry.members).map(n => n.name);
    if (names.includes(name)) return;
    names.push(name);
    await this.#updateLore(index, { members: names.join(", ") });
  }

  async #updateLore(index, changes) {
    if (!this.isEditable || !game.user.isGM) return;
    const lore = this.document.system.toObject().lore;
    if (!lore[index]) return;
    Object.assign(lore[index], changes);
    await this.document.update({ "system.lore": lore });
  }

  static #onSetLoreKind(event, target) {
    const kind = target.dataset.kind;
    if (!LORE_KINDS.includes(kind) || kind === this.#loreKind) return;
    this.#loreKind = kind;
    this.render();
  }

  /* A new card of the open tab, opened on its back to write. */
  static async #onAddLore() {
    if (!this.isEditable || !game.user.isGM) return;
    const lore = this.document.system.toObject().lore;
    lore.push({ kind: this.#loreKind });
    this.#flipped.add(`lore:${lore.length - 1}`);
    await this.document.update({ "system.lore": lore });
  }

  static async #onRemoveLore(event, target) {
    if (!this.isEditable || !game.user.isGM) return;
    const index = Number(target.dataset.i);
    const lore = this.document.system.toObject().lore.filter((_, i) => i !== index);
    for (const key of [...this.#flipped]) if (key.startsWith("lore:")) this.#flipped.delete(key);
    await this.document.update({ "system.lore": lore });
  }

  static async #onSetLoreStanding(event, target) {
    const standing = target.dataset.standing;
    if (STANDINGS.includes(standing)) await this.#updateLore(Number(target.dataset.i), { standing });
  }

  static async #onToggleLoreHidden(event, target) {
    const entry = this.document.system.lore[Number(target.dataset.i)];
    if (entry) await this.#updateLore(Number(target.dataset.i), { hidden: !entry.hidden });
  }

  static async #onPickLoreImage(event, target) {
    const index = Number(target.dataset.i);
    const entry = this.document.system.lore[index];
    if (!entry || !this.isEditable || !game.user.isGM) return;
    new foundry.applications.apps.FilePicker.implementation({
      type: "image",
      current: entry.img,
      callback: path => this.#updateLore(index, { img: path }),
      position: { top: this.position.top + 40, left: this.position.left + 10 }
    }).browse();
  }

  static async #onUnlinkSkill(event, target) {
    const index = Number(target.dataset.i);
    const entry = this.document.system.lore[index];
    if (!entry) return;
    await this.#updateLore(index, { skills: entry.skills.filter(s => s.uuid !== target.dataset.uuid).map(s => ({ ...s })) });
  }

  static #onOpenSkill(event, target) {
    fromUuidSync(target.dataset.uuid, { strict: false })?.sheet?.render(true);
  }

  /* ----- the Dossier ----- */

  /* A flip turns the card in place and is remembered across renders. */
  static #onFlipCard(event, target) {
    const card = target.closest(".dc");
    const key = card?.dataset.uuid ?? (card?.dataset.lore !== undefined ? `lore:${card.dataset.lore}` : "");
    if (!key) return;
    const flipped = card.classList.toggle("flip");
    if (flipped) this.#flipped.add(key);
    else this.#flipped.delete(key);
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
    if (actor) startGroup(actor);
  }

  static async #onRemoveMember(event, target) {
    if (!this.isEditable) return;
    const actor = fromUuidSync(target.dataset.uuid);
    if (actor?.isOwner) await leaveParty(this.document, actor);
  }

  static #onOpenClash() {
    ClashWindow.open();
  }

  /* A new scene: every member's Bonds may be invoked again, and every
     Combo chain ends. */
  static async #onNewScene() {
    if (!game.user.isGM) return;
    for (const actor of partyMembers(this.document)) {
      await clearChain(actor);
      const bonds = actor.system.toObject().bonds;
      if (!bonds.some(b => b.invoked)) continue;
      await actor.update({ "system.bonds": bonds.map(b => ({ ...b, invoked: false })) });
    }
  }
}
