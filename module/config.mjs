/* Ranks are indices 0..5 into the Ladder, E..S. mod is the Rank's Skill
   Energy cost. difficulty is the number a roll against the Rank as a
   Difficulty must reach. */
export const LADDER = [
  { rank: "E", die: "d4", mod: 1, difficulty: 5, cssVar: "--rk-e" },
  { rank: "D", die: "d6", mod: 2, difficulty: 7, cssVar: "--rk-d" },
  { rank: "C", die: "d8", mod: 3, difficulty: 9, cssVar: "--rk-c" },
  { rank: "B", die: "d10", mod: 4, difficulty: 11, cssVar: "--rk-b" },
  { rank: "A", die: "d12", mod: 5, difficulty: 13, cssVar: "--rk-a" },
  { rank: "S", die: "d12+2", mod: 6, difficulty: 16, cssVar: "--rk-s" }
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

export const STANDARD_ADVANCEMENTS = [
  { key: "newSkill", label: "PARADIGMENGINE.Advancement.NewSkill" },
  { key: "rankSkill", label: "PARADIGMENGINE.Advancement.RankSkill" },
  { key: "newHeart", label: "PARADIGMENGINE.Advancement.NewHeart" },
  { key: "newEnergy", label: "PARADIGMENGINE.Advancement.NewEnergy" }
];

export const SPECIAL_ADVANCEMENTS = [
  { key: "luck", label: "PARADIGMENGINE.Advancement.Luck" },
  { key: "rank", label: "PARADIGMENGINE.Advancement.Rank" },
  { key: "attribute", label: "PARADIGMENGINE.Advancement.Attribute" }
];
