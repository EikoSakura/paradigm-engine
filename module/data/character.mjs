import { attributesField, hotbarField, luckField, moveField, pointsField, rankField, textField } from "./fields.mjs";

const { ArrayField, BooleanField, NumberField, SchemaField } = foundry.data.fields;

function boxesField(n) {
  return new ArrayField(new BooleanField(), { required: true, initial: () => Array(n).fill(false) });
}

export default class CharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      player: textField(),
      age: textField(),
      gender: textField(),
      pronouns: textField(),
      rank: rankField(1),
      attributes: attributesField(),
      hearts: pointsField(),
      energy: pointsField(),
      move: moveField(),
      luck: luckField(),
      hotbar: hotbarField(),
      bonds: new ArrayField(
        new SchemaField({
          name: textField(),
          rank: rankField(0)
        })
      ),
      advancements: new SchemaField({
        unspent: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        standard: new SchemaField({
          newSkill: boxesField(3),
          rankSkill: boxesField(2),
          newHeart: boxesField(1),
          newEnergy: boxesField(1),
          move: boxesField(1)
        }),
        special: new SchemaField({
          luck: boxesField(3),
          rank: boxesField(4),
          attribute: boxesField(6)
        })
      }),
      personality: textField(),
      history: textField(),
      notes: textField()
    };
  }

  /* 0.4.0 renamed the Technique advancement boxes to Skill; the Trait
     boxes are gone and drop with the keys the schema no longer holds. */
  static migrateData(source, options) {
    const standard = source.advancements?.standard;
    if (standard) {
      for (const [from, to] of [["newTech", "newSkill"], ["rankTech", "rankSkill"]]) {
        if ((from in standard) && !(to in standard)) standard[to] = standard[from];
        delete standard[from];
      }
    }
    return super.migrateData(source, options);
  }
}
