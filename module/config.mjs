/* Ranks are indices 0..5 into the Ladder, E..S. dieValue is the Rank's
   Die Value, the highest number its Die rolls: Technique range, Technique
   area maximum, and Sync range through Bonds read it. difficulty is the
   number a roll against the Rank as a Difficulty must reach. */
export const LADDER = [
  { rank: "E", die: "d4", dieValue: 4, mod: 1, difficulty: 4, cssVar: "--rk-e" },
  { rank: "D", die: "d6", dieValue: 6, mod: 2, difficulty: 7, cssVar: "--rk-d" },
  { rank: "C", die: "d8", dieValue: 8, mod: 3, difficulty: 10, cssVar: "--rk-c" },
  { rank: "B", die: "d10", dieValue: 10, mod: 4, difficulty: 13, cssVar: "--rk-b" },
  { rank: "A", die: "d12", dieValue: 12, mod: 5, difficulty: 16, cssVar: "--rk-a" },
  { rank: "S", die: "d12+1", dieValue: 14, mod: 6, difficulty: 19, cssVar: "--rk-s" }
];

/* Difficulties: the Ladder plus the Difficulty-only SS. */
export const DIFFICULTY = [
  { rank: "E", number: 4, cssVar: "--rk-e" },
  { rank: "D", number: 7, cssVar: "--rk-d" },
  { rank: "C", number: 10, cssVar: "--rk-c" },
  { rank: "B", number: 13, cssVar: "--rk-b" },
  { rank: "A", number: 16, cssVar: "--rk-a" },
  { rank: "S", number: 19, cssVar: "--rk-s" },
  { rank: "SS", number: 22, cssVar: "--beni" }
];

export const ATTRIBUTES = [
  { key: "might", label: "PROJECTANIME.Attribute.Might", desc: "PROJECTANIME.Attribute.MightDesc" },
  { key: "agility", label: "PROJECTANIME.Attribute.Agility", desc: "PROJECTANIME.Attribute.AgilityDesc" },
  { key: "mind", label: "PROJECTANIME.Attribute.Mind", desc: "PROJECTANIME.Attribute.MindDesc" },
  { key: "spirit", label: "PROJECTANIME.Attribute.Spirit", desc: "PROJECTANIME.Attribute.SpiritDesc" },
  { key: "charm", label: "PROJECTANIME.Attribute.Charm", desc: "PROJECTANIME.Attribute.CharmDesc" }
];

export const STANDARD_ADVANCEMENTS = [
  { key: "newTrait", label: "PROJECTANIME.Advancement.NewTrait" },
  { key: "rankTrait", label: "PROJECTANIME.Advancement.RankTrait" },
  { key: "newTech", label: "PROJECTANIME.Advancement.NewTech" },
  { key: "rankTech", label: "PROJECTANIME.Advancement.RankTech" },
  { key: "newHeart", label: "PROJECTANIME.Advancement.NewHeart" },
  { key: "newEnergy", label: "PROJECTANIME.Advancement.NewEnergy" },
  { key: "move", label: "PROJECTANIME.Advancement.Move" }
];

export const SPECIAL_ADVANCEMENTS = [
  { key: "luck", label: "PROJECTANIME.Advancement.Luck" },
  { key: "rank", label: "PROJECTANIME.Advancement.Rank" },
  { key: "attribute", label: "PROJECTANIME.Advancement.Attribute" }
];
