const { ArrayField, BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;

/* Ranks are indices 0..5 into the Ladder, E..S. */
export function rankField(initial = 0) {
  return new NumberField({ required: true, nullable: false, integer: true, min: 0, max: 5, initial });
}

export function textField() {
  return new StringField({ required: true, initial: "" });
}

export function pointsField() {
  return new SchemaField({
    value: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 6 }),
    max: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 6 })
  });
}

export function attributesField() {
  return new SchemaField({
    might: rankField(),
    agility: rankField(),
    mind: rankField(),
    spirit: rankField(),
    charm: rankField()
  });
}

export function luckField() {
  return new ArrayField(
    new SchemaField({
      value: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      spent: new BooleanField()
    }),
    { required: true, initial: () => Array.from({ length: 3 }, () => ({ value: 0, spent: false })) }
  );
}

/* One bought advancement: the option key, the name of what it touched
   when it touched one thing, and the Rank it left that thing at. */
function growthItemField() {
  return new SchemaField({
    key: textField(),
    name: textField(),
    rank: new NumberField({ required: true, nullable: true, integer: true, min: 0, max: 5, initial: null })
  });
}

/* Growth Points, on PCs and NPCs alike: the open milestone and the log. */
export function growthField() {
  return new SchemaField({
    /* The open milestone: its tier, the Growth Points left, which option
       tiers it reaches, and what has been bought so far. An empty tier
       means no milestone is open. */
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
  });
}
