/* One-shot data migrations, run once per world by the active
   Storyteller's client when the recorded system version is older than
   the running one. */

const SETTING = "migrationVersion";

export function registerMigrations() {
  game.settings.register("project-anime", SETTING, {
    scope: "world",
    config: false,
    type: String,
    default: "0.0.0"
  });
  Hooks.once("ready", async () => {
    if (game.users.activeGM?.isSelf !== true) return;
    const stored = game.settings.get("project-anime", SETTING);
    if (!foundry.utils.isNewerVersion(game.system.version, stored)) return;
    if (foundry.utils.isNewerVersion("0.2.0", stored)) await removeZones();
    if (foundry.utils.isNewerVersion("0.3.0", stored)) {
      await renameRanks();
      await bondRanks();
      await sceneTiles();
    }
    await game.settings.set("project-anime", SETTING, game.system.version);
  });
}

/* 0.3.0 put the board on tiles: every existing scene measures 1 tile
   per grid space, units "tiles", whatever it was imported with, and
   square grids count diagonals as 2 — the cardinal rule. */
async function sceneTiles() {
  const updates = game.scenes
    .filter(s => (s._source.grid.distance !== 1) || (s._source.grid.units !== "tiles"))
    .map(s => ({ _id: s.id, "grid.distance": 1, "grid.units": "tiles" }));
  if (updates.length) await Scene.implementation.updateDocuments(updates);
  await game.settings.set("core", "gridDiagonals", CONST.GRID_DIAGONALS.RECTILINEAR);
}

/* 0.3.0 renamed Grade to Rank: move each actor's grade to rank, and the
   Rank Up Rank advancement boxes with it. Unlinked token deltas carry
   the same rename. Values are read from source data because the old
   field is no longer part of the models. */
async function renameRanks() {
  const move = system => {
    if (system?.grade === undefined) return null;
    const update = { "system.rank": system.grade, "system.-=grade": null };
    if (system.advancements?.special?.grade !== undefined) {
      update["system.advancements.special.rank"] = system.advancements.special.grade;
      update["system.advancements.special.-=grade"] = null;
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
        .filter(b => b.type === "project-anime.zone")
        .map(b => b._id);
      if (ids.length) await region.deleteEmbeddedDocuments("RegionBehavior", ids);
    }
    const updates = scene.tokens
      .filter(t => t._source.flags?.["project-anime"]?.zone !== undefined)
      .map(t => ({ _id: t.id, "flags.project-anime.-=zone": null }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
}
