import { rankField, rulingsField } from "./fields.mjs";

const { BooleanField, HTMLField, StringField } = foundry.data.fields;

export default class SkillData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      rank: rankField(),
      kind: new StringField({ required: true, initial: "Activated", choices: ["Activated", "Triggered"] }),
      area: new BooleanField(),
      text: new HTMLField({ required: true, initial: "" }),
      rulings: rulingsField()
    };
  }
}
