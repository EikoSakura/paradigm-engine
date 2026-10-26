import { attributesField, growthField, luckField, pointsField, rankField, textField } from "./fields.mjs";

const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField } = foundry.data.fields;

export default class PcData extends foundry.abstract.TypeDataModel {
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
      luckDie: new NumberField({ required: true, nullable: false, integer: true, initial: 6, choices: [6, 8, 10, 12] }),
      luck: luckField(),
      bonds: new ArrayField(
        new SchemaField({
          name: textField(),
          relation: textField(),
          rank: rankField(0),
          invoked: new BooleanField({ initial: false })
        })
      ),
      growth: growthField(),
      personality: new HTMLField({ required: true, initial: "" }),
      history: new HTMLField({ required: true, initial: "" }),
      notes: new HTMLField({ required: true, initial: "" })
    };
  }

  /* The Luck Die size moved off the slots onto the PC: the largest stored
     slot die becomes luckDie. The 0.4.0 advancement boxes are gone with
     the key the schema no longer holds. */
  static migrateData(source, options) {
    /* The Profile text fields hold HTML now; plain text written before
       that becomes one paragraph per line. */
    for (const key of ["personality", "history", "notes"]) {
      const text = source[key];
      if (typeof text !== "string" || !text || text.trimStart().startsWith("<")) continue;
      source[key] = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
        .map(line => `<p>${foundry.utils.escapeHTML(line)}</p>`).join("");
    }
    if (source.luckDie === undefined && Array.isArray(source.luck)) {
      const dice = source.luck.map(s => s?.die).filter(d => [6, 8, 10, 12].includes(d));
      if (dice.length) source.luckDie = Math.max(...dice);
    }
    return super.migrateData(source, options);
  }
}
