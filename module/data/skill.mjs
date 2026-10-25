import { SKILL_KINDS } from "../config.mjs";
import { rankField } from "./fields.mjs";
import { resolveRank } from "../skills.mjs";

const { BooleanField, HTMLField, StringField } = foundry.data.fields;

export default class SkillData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      rank: rankField(),
      kind: new StringField({ required: true, initial: "Technique", choices: SKILL_KINDS }),
      text: new HTMLField({ required: true, initial: "" }),
      prerequisite: new StringField({ required: true, initial: "" }),
      source: new StringField({ required: true, initial: "" }),
      inTree: new BooleanField()
    };
  }

  /* On an actor a specialized Skill reads its foundation's Rank. World
     Skills resolve at render time instead, since the world collection may
     still be loading when they prepare. */
  prepareDerivedData() {
    if (this.prerequisite && this.parent.parent) this.rank = resolveRank(this.parent);
  }

  /* 0.4.0 renamed the kinds: Activated is Technique, Triggered is Talent. */
  static migrateData(source, options) {
    if (source.kind === "Activated") source.kind = "Technique";
    else if (source.kind === "Triggered") source.kind = "Talent";
    return super.migrateData(source, options);
  }
}
