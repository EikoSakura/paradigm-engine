import { rankField, rulingsField } from "./fields.mjs";

const { BooleanField, HTMLField } = foundry.data.fields;

export default class TraitData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      rank: rankField(1),
      area: new BooleanField(),
      text: new HTMLField({ required: true, initial: "" }),
      rulings: rulingsField()
    };
  }
}
