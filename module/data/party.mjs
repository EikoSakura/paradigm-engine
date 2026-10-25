import { textField } from "./fields.mjs";

/* A Party: the id of the Actors folder that holds it and its members,
   and shared notes. Membership is the folder's contents, never stored. */
export default class PartyData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      folder: textField(),
      notes: textField()
    };
  }
}
