/* Ranks are indices 0..5 into the Ladder, E..S. mod is the Rank's Technique
   Energy cost: E and D 1, C and B 2, A and S 3. difficulty is the number a
   roll against the Rank as a Difficulty must reach. */
export const LADDER = [
  { rank: "E", die: "d4", mod: 1, difficulty: 5, cssVar: "--rk-e" },
  { rank: "D", die: "d6", mod: 1, difficulty: 7, cssVar: "--rk-d" },
  { rank: "C", die: "d8", mod: 2, difficulty: 9, cssVar: "--rk-c" },
  { rank: "B", die: "d10", mod: 2, difficulty: 11, cssVar: "--rk-b" },
  { rank: "A", die: "d12", mod: 3, difficulty: 13, cssVar: "--rk-a" },
  { rank: "S", die: "d12+1", mod: 3, difficulty: 15, cssVar: "--rk-s" }
];

/* Difficulties: the Ladder plus the Difficulty-only SS. */
export const DIFFICULTY = [
  { rank: "E", number: 5, cssVar: "--rk-e" },
  { rank: "D", number: 7, cssVar: "--rk-d" },
  { rank: "C", number: 9, cssVar: "--rk-c" },
  { rank: "B", number: 11, cssVar: "--rk-b" },
  { rank: "A", number: 13, cssVar: "--rk-a" },
  { rank: "S", number: 15, cssVar: "--rk-s" },
  { rank: "SS", number: 17, cssVar: "--beni" }
];

/* Copies of one character told apart by letter: items sharing a uuid read
   their base name with A, B, C after it; a lone one keeps its plain name.
   Returns new items with `name` set; `base` is the plain name and is kept
   on the item so a later pass starts from it. */
export function letterCopies(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.uuid, (counts.get(item.uuid) ?? 0) + 1);
  const seen = new Map();
  return items.map(item => {
    const base = item.base ?? item.name;
    if ((counts.get(item.uuid) ?? 0) < 2) return { ...item, base, name: base };
    const n = seen.get(item.uuid) ?? 0;
    seen.set(item.uuid, n + 1);
    const letter = n < 26 ? String.fromCharCode(65 + n) : String(n + 1);
    return { ...item, base, name: `${base} ${letter}` };
  });
}

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
  { key: "newSkill", group: "general", pick: "newSkill" },
  { key: "skillRankUp", group: "general", pick: "skillRank" },
  { key: "modifySkill", group: "general", pick: "modifySkill" },
  { key: "retrainSkill", group: "general", pick: "retrain" },
  { key: "newBond", group: "general", pick: "newBond" },
  { key: "bondRankUp", group: "general", pick: "bondRank" },
  { key: "heart", group: "arc", once: true },
  { key: "energy", group: "arc", once: true },
  { key: "attrRankUp", group: "arc", once: true, pick: "attribute" },
  { key: "stepLuck", group: "arc", once: true },
  { key: "unlockLuck", group: "season", once: true },
  { key: "comboMastery", group: "season", once: true },
  { key: "techMastery", group: "season", once: true, pick: "technique" }
];

/* Hearts and Energy stop at 12, the Luck Dice at five d12s, and Combo
   Mastery lowers the doubles a Combo needs from 6 to no less than 3. */
export const GROWTH_CAPS = { points: 12, luckDice: 5, luckDie: 12, comboMin: 3 };

export const COMBO_MIN = 6;

/* Skill kinds. A Technique spends its Rank's Energy cost when used; a
   Talent is always on and costs nothing. */
export const SKILL_KINDS = ["Technique", "Talent"];

/* A Technique's Energy cost: its Rank's, less its Technique Mastery, never
   under 1. */
export function energyCost(system) {
  if (system.kind === "Talent") return 0;
  return Math.max(1, LADDER[system.rank].mod - (system.mastery ?? 0));
}

export function costLabel(system) {
  return system.kind === "Talent" ? "" : game.i18n.format("PARADIGMENGINE.Skill.Energy", { n: energyCost(system) });
}
