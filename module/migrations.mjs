/* One-shot data migrations, run once per world by the active
   Storyteller's client when the recorded system version is older than
   the running one. */

const SETTING = "migrationVersion";
const OLD_ID = "project-anime";

const del = () => new foundry.data.operators.ForcedDeletion();

export function registerMigrations() {
  game.settings.register("paradigm-engine", SETTING, {
    scope: "world",
    config: false,
    type: String,
    default: "0.0.0"
  });
  Hooks.once("ready", async () => {
    carryClientSettings();
    if (game.users.activeGM?.isSelf !== true) return;
    await renameSystem();
    const stored = game.settings.get("paradigm-engine", SETTING);
    if (!foundry.utils.isNewerVersion(game.system.version, stored)) return;
    if (foundry.utils.isNewerVersion("0.2.0", stored)) await removeZones();
    if (foundry.utils.isNewerVersion("0.3.0", stored)) {
      await renameRanks();
      await bondRanks();
    }
    if (foundry.utils.isNewerVersion("0.4.0", stored)) {
      await removeTension();
      await removeTracks();
      await skillsReplaceTraits();
      await removeHuds();
      await removeMove();
      await removeAreas();
      await renameActorTypes();
      await removeEncounters();
      await removeSkillBar();
    }
    await game.settings.set("paradigm-engine", SETTING, game.system.version);
  });
}

/* 0.4.0 renamed the system from project-anime to paradigm-engine: world
   settings and document flags stored under the old id move to the new
   one, old copies deleted. Runs once, keyed on the old migration record,
   and carries that record so earlier migrations do not run again. */
async function renameSystem() {
  const world = game.settings.storage.get("world");
  if (!world.getSetting(`${OLD_ID}.${SETTING}`)) return;
  for (const key of [SETTING]) {
    const setting = world.getSetting(`${OLD_ID}.${key}`);
    if (!setting) continue;
    await game.settings.set(game.system.id, key, setting.value);
    await setting.delete();
  }
  const carry = doc => {
    const flags = doc._source.flags?.[OLD_ID];
    if (flags === undefined) return null;
    return { _id: doc.id, [`flags.${game.system.id}`]: foundry.utils.deepClone(flags), [`flags.${OLD_ID}`]: del() };
  };
  for (const collection of [game.actors, game.items, game.folders, game.messages, game.scenes, game.users]) {
    const updates = collection.map(carry).filter(Boolean);
    if (updates.length) await collection.documentClass.updateDocuments(updates);
  }
  for (const actor of game.actors) {
    const updates = actor.items.map(carry).filter(Boolean);
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }
  for (const scene of game.scenes) {
    const updates = scene.tokens.map(carry).filter(Boolean);
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
}

/* Client settings live in this browser's local storage: move each key
   stored under the old id to the new one, on every client. */
function carryClientSettings() {
  const storage = game.settings.storage.get("client");
  for (const key of Object.keys(storage)) {
    if (!key.startsWith(`${OLD_ID}.`)) continue;
    const moved = `${game.system.id}.${key.slice(OLD_ID.length + 1)}`;
    if (storage.getItem(moved) === null) storage.setItem(moved, storage.getItem(key));
    storage.removeItem(key);
  }
}

/* 0.4.0 removed Tension: its world settings go, under both ids, and
   the applied mark on old roll cards with them. */
async function removeTension() {
  const world = game.settings.storage.get("world");
  for (const id of [OLD_ID, game.system.id]) {
    for (const key of ["tension", "tensionAnnounce", "tensionAuto"]) {
      await world.getSetting(`${id}.${key}`)?.delete();
    }
  }
  const updates = game.messages
    .filter(m => m._source.flags?.[game.system.id]?.tensionApplied !== undefined)
    .map(m => ({ _id: m.id, [`flags.${game.system.id}.tensionApplied`]: del() }));
  if (updates.length) await ChatMessage.implementation.updateDocuments(updates);
}

/* 0.4.0 removed Tracks: the world list goes, under both ids, and the
   applied mark on old roll cards with it. */
async function removeTracks() {
  const world = game.settings.storage.get("world");
  for (const id of [OLD_ID, game.system.id]) {
    await world.getSetting(`${id}.tracks`)?.delete();
  }
  const updates = game.messages
    .filter(m => m._source.flags?.[game.system.id]?.trackApplied !== undefined)
    .map(m => ({ _id: m.id, [`flags.${game.system.id}.trackApplied`]: del() }));
  if (updates.length) await ChatMessage.implementation.updateDocuments(updates);
}

/* 0.4.0 removed Traits and renamed Techniques to Skills. Both old types
   fail to load, so their Items sit in the invalid set with their source
   intact: Trait Items are deleted, Technique Items change type to skill
   with their data carried whole. The Trait advancement boxes go and the Technique ones
   move to the Skill keys, by writing the migrated model back whole.
   World Items, actor Items, and unlinked token actors alike. */
async function skillsReplaceTraits() {
  const { ForcedReplacement } = foundry.data.operators;
  const sort = collection => {
    const docs = [...collection.invalidDocumentIds].map(id => collection.getInvalid(id, { strict: false })).filter(Boolean);
    return {
      traits: docs.filter(d => d._source.type === "trait").map(d => d.id),
      techniques: docs.filter(d => d._source.type === "technique").map(d => ({
        _id: d.id,
        type: "skill",
        system: ForcedReplacement.create(foundry.utils.deepClone(d._source.system ?? {}))
      }))
    };
  };
  const world = sort(game.items);
  if (world.techniques.length) await Item.implementation.updateDocuments(world.techniques);
  if (world.traits.length) await Item.implementation.deleteDocuments(world.traits);

  const unlinked = game.scenes.contents.flatMap(scene =>
    scene.tokens.filter(token => !token.actorLink && token.actor).map(token => token.actor));
  for (const actor of [...game.actors, ...unlinked]) {
    const { traits, techniques } = sort(actor.items);
    if (techniques.length) await actor.updateEmbeddedDocuments("Item", techniques);
    if (traits.length) await actor.deleteEmbeddedDocuments("Item", traits);
  }
}

/* 0.4.0 removed the Skill bar. The stored slots on world actors go with
   the whole-system write-back above; unlinked token deltas drop theirs
   here. */
async function removeSkillBar() {
  for (const scene of game.scenes) {
    const updates = scene.tokens
      .filter(token => token.delta?._source?.system?.hotbar !== undefined)
      .map(token => ({ _id: token.id, "delta.system.hotbar": del() }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
}

/* 0.4.0 removed the Party HUD and the Adversary frame. The Party folder
   stays as an ordinary Actors folder; only its system flag goes. */
async function removeHuds() {
  const updates = game.folders
    .filter(f => f._source.flags?.[game.system.id]?.party !== undefined)
    .map(f => ({ _id: f.id, [`flags.${game.system.id}.party`]: del() }));
  if (updates.length) await Folder.implementation.updateDocuments(updates);
}

/* 0.4.0 removed Move, and Desire and Fear from adversaries, and moved the
   Luck Die size off the slots onto the PC. The models no longer hold the
   old fields, so a loaded actor's source has already dropped them and
   carries luckDie: the system is written back whole to clear the stored
   values, and the +1 Move advancement box with them; the whole
   advancements block followed when Growth Points replaced the boxes.
   Unlinked token deltas and saved creator drafts keep raw source, so
   their Move keys delete directly. */
async function removeMove() {
  const { ForcedReplacement } = foundry.data.operators;
  for (const actor of game.actors) {
    const update = { system: ForcedReplacement.create(actor.system.toObject()) };
    const pools = actor._source.flags?.[game.system.id]?.creator?.pools;
    if (pools?.move !== undefined) update[`flags.${game.system.id}.creator.pools.move`] = del();
    await actor.update(update);
  }
  for (const scene of game.scenes) {
    const updates = scene.tokens
      .filter(token => token.delta?._source?.system?.move !== undefined
        || token.delta?._source?.system?.advancements?.standard?.move !== undefined)
      .map(token => {
        const system = token.delta._source.system;
        const update = { _id: token.id };
        if (system.move !== undefined) update["delta.system.move"] = del();
        if (system.advancements?.standard?.move !== undefined) update["delta.system.advancements.standard.move"] = del();
        return update;
      });
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
}

/* 0.4.0 removed Areas and Rulings and renamed the Skill kinds. The Skill
   model no longer holds the area flag or the rulings list and reads
   Activated as Technique and Triggered as Talent, so each Skill's system is written back whole to
   store the current shape: world Items, actor Items, and unlinked token
   actors alike. Placed bursts were ordinary Drawings and stay with their
   scenes. */
async function removeAreas() {
  const { ForcedReplacement } = foundry.data.operators;
  const rewrite = items => items
    .filter(item => item.type === "skill")
    .map(item => ({ _id: item.id, system: ForcedReplacement.create(item.system.toObject()) }));
  const world = rewrite(game.items.contents);
  if (world.length) await Item.implementation.updateDocuments(world);
  const unlinked = game.scenes.contents.flatMap(scene =>
    scene.tokens.filter(token => !token.actorLink && token.actor).map(token => token.actor));
  for (const actor of [...game.actors, ...unlinked]) {
    const updates = rewrite(actor.items.contents);
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }
}

/* 0.3.0 renamed Grade to Rank: move each actor's grade to rank, and the
   Rank Up Rank advancement boxes with it. Unlinked token deltas carry
   the same rename. Values are read from source data because the old
   field is no longer part of the models. */
async function renameRanks() {
  const move = system => {
    if (system?.grade === undefined) return null;
    const update = { "system.rank": system.grade, "system.grade": del() };
    if (system.advancements?.special?.grade !== undefined) {
      update["system.advancements.special.rank"] = system.advancements.special.grade;
      update["system.advancements.special.grade"] = del();
    }
    return update;
  };
  for (const actor of game.actors) {
    const update = move(actor._source.system);
    if (update) await actor.update(update);
  }
  for (const scene of game.scenes) {
    const updates = scene.tokens
      .map(token => ({ token, update: move(token.delta?._source?.system) }))
      .filter(u => u.update)
      .map(u => ({
        _id: u.token.id,
        ...Object.fromEntries(Object.entries(u.update).map(([key, value]) => [`delta.${key}`, value]))
      }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
}

/* 0.3.0 gave Bonds Ranks: stored numbers 1 to 6 become rank indices 0 to
   5, and the number and sentence fields go. Rows are rebuilt whole, so the
   old keys drop with the write. Values are read from source data because
   the old fields are no longer part of the model. */
async function bondRanks() {
  const rebuild = system => {
    const bonds = system?.bonds;
    if (!Array.isArray(bonds)) return null;
    if (!bonds.some(b => b?.number !== undefined || b?.text !== undefined)) return null;
    return {
      "system.bonds": bonds.map(b => ({
        name: b?.name ?? "",
        rank: Math.min(5, Math.max(0, (b?.number ?? 1) - 1))
      }))
    };
  };
  for (const actor of game.actors) {
    const update = rebuild(actor._source.system);
    if (update) await actor.update(update);
  }
  for (const scene of game.scenes) {
    const updates = scene.tokens
      .map(token => ({ token, update: rebuild(token.delta?._source?.system) }))
      .filter(u => u.update)
      .map(u => ({
        _id: u.token.id,
        ...Object.fromEntries(Object.entries(u.update).map(([key, value]) => [`delta.${key}`, value]))
      }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
}

/* 0.2.0 replaced Zones with Distance: delete the Zone behaviors from
   every scene's Regions and strip the membership flags from tokens.
   The Regions themselves stay; they belong to the world. Behaviors are
   read from source data because the type no longer validates. */
async function removeZones() {
  for (const scene of game.scenes) {
    for (const region of scene.regions) {
      const ids = region._source.behaviors
        .filter(b => [`${OLD_ID}.zone`, `${game.system.id}.zone`].includes(b.type))
        .map(b => b._id);
      if (ids.length) await region.deleteEmbeddedDocuments("RegionBehavior", ids);
    }
    const updates = scene.tokens
      .filter(t => t._source.flags?.["paradigm-engine"]?.zone !== undefined)
      .map(t => ({ _id: t.id, [`flags.${game.system.id}.zone`]: del() }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
}

/* 0.4.0 renamed the actor types: character is pc, adversary is npc, and
   Rivals are gone, so an NPC's stored rival flag and Luck Dice drop with
   the whole-system write-back. Unlinked token deltas that pinned a type
   take the new name; roll cards carry their NPC flag under the new key. */
async function renameActorTypes() {
  const { ForcedReplacement } = foundry.data.operators;
  const TYPES = { character: "pc", adversary: "npc" };
  const updates = game.actors
    .filter(actor => actor._source.type in TYPES)
    .map(actor => ({
      _id: actor.id,
      type: TYPES[actor._source.type],
      system: ForcedReplacement.create(actor.system.toObject())
    }));
  if (updates.length) await Actor.implementation.updateDocuments(updates);
  for (const scene of game.scenes) {
    const tokens = scene.tokens
      .filter(token => token.delta?._source?.type in TYPES)
      .map(token => ({ _id: token.id, "delta.type": TYPES[token.delta._source.type] }));
    if (tokens.length) await scene.updateEmbeddedDocuments("Token", tokens);
  }
  const messages = game.messages
    .filter(m => m._source.flags?.[game.system.id]?.card?.difficulty?.adversary !== undefined)
    .map(m => {
      const difficulty = foundry.utils.deepClone(m._source.flags[game.system.id].card.difficulty);
      difficulty.npc = difficulty.adversary;
      delete difficulty.adversary;
      return { _id: m.id, [`flags.${game.system.id}.card.difficulty`]: ForcedReplacement.create(difficulty) };
    });
  if (messages.length) await ChatMessage.implementation.updateDocuments(messages);
}

/* 0.4.0 removed the Encounter Tracker and its participant combatant type.
   A combatant stored with that type no longer validates, so encounters
   holding one are deleted; the native tracker starts fresh. */
async function removeEncounters() {
  const ids = game.combats
    .filter(c => (c._source.combatants ?? []).some(x => x.type === "participant"))
    .map(c => c.id);
  if (ids.length) await Combat.implementation.deleteDocuments(ids);
}
