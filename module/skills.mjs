/* Prerequisite links. A Skill's prerequisite is the UUID of its foundation
   at the world level. A copy on an actor carries the world UUID it was
   taken from as its source, so the chain resolves on the actor by source
   first and by name second. */

const lookup = uuid => (uuid ? fromUuidSync(uuid, { strict: false }) : null);

/* The world UUID a Skill stands for: its source if it is a copy, else itself. */
export function worldUuid(item) {
  return item.system.source || item.uuid;
}

/* The foundation Skill this one builds on, resolved beside it on the actor
   when it has one, else at the world level. Null when it is not there. */
export function foundationOf(item) {
  const uuid = item.system.prerequisite;
  if (!uuid) return null;
  const actor = item.parent;
  if (!actor) {
    const doc = lookup(uuid);
    return doc instanceof Item && doc.type === "skill" ? doc : null;
  }
  const name = lookup(uuid)?.name;
  return actor.items.find(i => i.type === "skill" && i !== item
    && (i.system.source === uuid || i.uuid === uuid || (name !== undefined && i.name === name))) ?? null;
}

/* The name of the foundation, from the actor's copy or the world entry. */
export function foundationName(item) {
  return foundationOf(item)?.name ?? lookup(item.system.prerequisite)?.name ?? "";
}

/* A specialized Skill has no Rank of its own: walk the chain to the root's
   stored Rank. A broken or circular chain falls back to the stored value. */
export function resolveRank(item, seen = new Set()) {
  if (!item.system.prerequisite || seen.has(item.uuid)) return item._source.system.rank;
  seen.add(item.uuid);
  const foundation = foundationOf(item);
  return foundation ? resolveRank(foundation, seen) : item._source.system.rank;
}

/* Copy a world Skill onto an actor, stamped with where it came from. */
export async function takeSkill(actor, item) {
  const data = item.inCompendium ? game.items.fromCompendium(item, { clearFolder: true }) : item.toObject();
  data.system.source = item.system.source || item.uuid;
  return Item.implementation.create(data, { parent: actor });
}
