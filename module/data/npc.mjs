import { attributesField, growthField, pointsField, rankField } from "./fields.mjs";

export default class NpcData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      rank: rankField(1),
      attributes: attributesField(),
      hearts: pointsField(),
      energy: pointsField(),
      growth: growthField()
    };
  }
}
