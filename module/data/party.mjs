import { textField } from "./fields.mjs";

const { ArrayField, BooleanField, SchemaField, StringField } = foundry.data.fields;

/* Where an NPC stands with the party, as the GM marks it on its card. */
export const STANDINGS = ["ally", "neutral", "enemy", "unknown"];

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

/* A Party: the id of the Actors folder that holds it and its members,
   the Dossier of NPCs the party has met, and shared notes. Membership
   is the folder's contents, never stored. */
export default class PartyData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      folder: textField(),
      dossier: dossierField(),
      notes: textField()
    };
  }
}
