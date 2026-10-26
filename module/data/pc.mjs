import { attributesField, luckField, pointsField, rankField, textField } from "./fields.mjs";

const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

/* One bought advancement: the option key, the name of what it touched
   when it touched one thing, and the Rank it left that thing at. */
function growthItemField() {
  return new SchemaField({
    key: textField(),
    name: textField(),
    rank: new NumberField({ required: true, nullable: true, integer: true, min: 0, max: 5, initial: null })
  });
}

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
      growth: new SchemaField({
        /* The open milestone: its tier, the Growth Points left, which
           option tiers it reaches, and what has been bought so far. An
           empty tier means no milestone is open. */
        milestone: new SchemaField({
          tier: new StringField({ required: true, blank: true, initial: "", choices: ["", "Episode", "Arc", "Season", "Timeskip"] }),
          gp: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
          access: new SchemaField({
            general: new BooleanField({ initial: true }),
            arc: new BooleanField({ initial: false }),
            season: new BooleanField({ initial: false })
          }),
          items: new ArrayField(growthItemField())
        }),
        log: new ArrayField(
          new SchemaField({
            tier: textField(),
            items: new ArrayField(growthItemField())
          })
        )
      }),
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
