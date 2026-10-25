/* Ranks are indices 0..5 into the Ladder, E..S. mod is the Rank's Technique
   Energy cost: E and D 1, C and B 2, A and S 3. difficulty is the number a
   roll against the Rank as a Difficulty must reach. */
export const LADDER = [
  { rank: "E", die: "d4", mod: 1, difficulty: 5, cssVar: "--rk-e" },
  { rank: "D", die: "d6", mod: 1, difficulty: 7, cssVar: "--rk-d" },
  { rank: "C", die: "d8", mod: 2, difficulty: 9, cssVar: "--rk-c" },
  { rank: "B", die: "d10", mod: 2, difficulty: 11, cssVar: "--rk-b" },
  { rank: "A", die: "d12", mod: 3, difficulty: 13, cssVar: "--rk-a" },
  { rank: "S", die: "d12+2", mod: 3, difficulty: 16, cssVar: "--rk-s" }
];

/* Difficulties: the Ladder plus the Difficulty-only SS. */
export const DIFFICULTY = [
  { rank: "E", number: 5, cssVar: "--rk-e" },
  { rank: "D", number: 7, cssVar: "--rk-d" },
  { rank: "C", number: 9, cssVar: "--rk-c" },
  { rank: "B", number: 11, cssVar: "--rk-b" },
  { rank: "A", number: 13, cssVar: "--rk-a" },
  { rank: "S", number: 16, cssVar: "--rk-s" },
  { rank: "SS", number: 19, cssVar: "--beni" }
];

export const ATTRIBUTES = [
  { key: "might", label: "PARADIGMENGINE.Attribute.Might", desc: "PARADIGMENGINE.Attribute.MightDesc" },
  { key: "agility", label: "PARADIGMENGINE.Attribute.Agility", desc: "PARADIGMENGINE.Attribute.AgilityDesc" },
  { key: "mind", label: "PARADIGMENGINE.Attribute.Mind", desc: "PARADIGMENGINE.Attribute.MindDesc" },
  { key: "spirit", label: "PARADIGMENGINE.Attribute.Spirit", desc: "PARADIGMENGINE.Attribute.SpiritDesc" },
  { key: "charm", label: "PARADIGMENGINE.Attribute.Charm", desc: "PARADIGMENGINE.Attribute.CharmDesc" }
];

/* Growth Points by milestone. A Timeskip's award is the Storyteller's. */
export const GROWTH_TIERS = { Episode: 1, Arc: 3, Season: 5 };

/* The advancement options, each 1 GP. group is the card it sits on and the
   access it needs; once locks it after one purchase in a milestone; pick
   names the window that chooses what it touches. */
export const GROWTH_OPTIONS = [
  { key: "modifySkill", group: "general", pick: "modifySkill" },
  { key: "newSkill", group: "general", pick: "newSkill" },
  { key: "skillRankUp1", group: "general", pick: "skillRank" },
  { key: "newBond", group: "general", pick: "newBond" },
  { key: "bondRankUp1", group: "general", pick: "bondRank" },
  { key: "heart", group: "arc", once: true },
  { key: "energy", group: "arc", once: true },
  { key: "stepLuck", group: "arc", once: true },
  { key: "skillRankUp2", group: "season", once: true, pick: "skillRank" },
  { key: "bondRankUp2", group: "season", once: true, pick: "bondRank" },
  { key: "unlockLuck", group: "season", once: true },
  { key: "charRank", group: "season", once: true },
  { key: "attrRankUp", group: "season", once: true, pick: "attribute" }
];

export const GROWTH_CAPS = { points: 12, luckDice: 5, luckDie: 12 };

/* Skill kinds. A Technique spends its Rank's Energy cost when used; a
   Talent is always on and costs nothing. */
export const SKILL_KINDS = ["Technique", "Talent"];

export function energyCost(system) {
  return system.kind === "Talent" ? 0 : LADDER[system.rank].mod;
}

/* The cost chip's text, empty for a Talent so the chip is left out. */
export function costLabel(system) {
  return system.kind === "Talent" ? "" : game.i18n.format("PARADIGMENGINE.Skill.Energy", { n: LADDER[system.rank].mod });
}
