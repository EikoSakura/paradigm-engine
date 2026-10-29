import { textField } from "./fields.mjs";

const { ArrayField, BooleanField, SchemaField, StringField } = foundry.data.fields;

/* Where an NPC stands with the party, as the GM marks it on its card. */
export const STANDINGS = ["ally", "neutral", "enemy", "unknown"];

/* The kinds of Lore card, each its own tab on the Lore page. */
export const LORE_KINDS = ["species", "faction", "place", "item"];

/* One Dossier card: the NPC it reads, and what the GM wrote on it. The
   portrait, its framing, and the name come from the NPC itself. A hidden
   card lies face down for players. */
function dossierField() {
  return new ArrayField(
    new SchemaField({
      uuid: textField(),
      standing: new StringField({ required: true, initial: "unknown", choices: STANDINGS }),
      title: textField(),
      affiliation: textField(),
      lastSeen: textField(),
      known: textField(),
      hidden: new BooleanField({ initial: false })
    })
  );
}

/* One Lore card: a species, faction, place, or item the GM writes up,
   wholly its own. The back carries its text and the lines its kind
   reads: a species its Skills, Members and Homeworld; a faction its
   Standing, Members and Base; a place its Notable and Scene; an item
   who holds it. The Skills are world Skills by uuid, with the name kept
   so a player reads the row even without leave to open the Skill. */
function loreField() {
  return new ArrayField(
    new SchemaField({
      kind: new StringField({ required: true, initial: "species", choices: LORE_KINDS }),
      name: textField(),
      sub: textField(),
      img: textField(),
      text: textField(),
      standing: new StringField({ required: true, initial: "unknown", choices: STANDINGS }),
      skills: new ArrayField(new SchemaField({ uuid: textField(), name: textField() })),
      members: textField(),
      place: textField(),
      hidden: new BooleanField({ initial: false })
    })
  );
}

/* A Party: the id of the Actors folder that holds it and its members,
   the Dossier of NPCs the party has met, the Lore the GM has written up,
   and shared notes. Membership is the folder's contents, never stored. */
export default class PartyData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      folder: textField(),
      dossier: dossierField(),
      lore: loreField(),
      notes: textField()
    };
  }
}
