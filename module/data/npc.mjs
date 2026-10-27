import { attributesField, comboField, growthField, migrateGrowthKeys, pointsField, rankField } from "./fields.mjs";

export default class NpcData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      rank: rankField(1),
      attributes: attributesField(),
      hearts: pointsField(),
      energy: pointsField(),
      comboMin: comboField(),
      growth: growthField()
    };
  }

  static migrateData(source, options) {
    migrateGrowthKeys(source);
    return super.migrateData(source, options);
  }
}
