/* A Party is a folder as much as a sheet. Each Party actor owns one Actors
   folder, named after it and holding it; every PC inside that folder, or a
   folder under it, is a member. A PC dropped on the Party File moves into
   the folder, one dragged into the folder in the directory joins the same
   way, and leaving the folder leaves the party. The folder and the party
   keep each other's name. */

/* The Party's folder, or null when it is gone. */
export function partyFolder(party) {
  const id = party?.system?.folder;
  return id ? game.folders.get(id) ?? null : null;
}

/* A folder and every folder under it, by id. */
function folderTree(folder) {
  const ids = new Set([folder.id]);
  for (const sub of folder.getSubfolders(true)) ids.add(sub.id);
  return ids;
}

/* The member PCs, in directory order. */
export function partyMembers(party) {
  const folder = partyFolder(party);
  if (!folder) return [];
  const ids = folderTree(folder);
  return game.actors
    .filter(a => a.type === "pc" && a.folder && ids.has(a.folder.id))
    .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, game.i18n.lang));
}

/* The Party this actor belongs to, or null. A synthetic token actor
   answers for its base actor. */
export function partyOf(actor) {
  const base = actor?.isToken ? game.actors.get(actor.id) : actor;
  const folderId = base?.folder?.id;
  if (!folderId || base.type !== "pc") return null;
  return game.actors.find(a => a.type === "party" && partyFolder(a) && folderTree(partyFolder(a)).has(folderId)) ?? null;
}

/* Give a Party its folder when it has none: created beside the actor,
   named after it, and the actor moves inside. Runs once, on the client
   that may write. */
const creating = new Set();

export async function ensurePartyFolder(party) {
  if (!party.isOwner || partyFolder(party) || creating.has(party.id)) return partyFolder(party);
  creating.add(party.id);
  try {
    const folder = await Folder.implementation.create({ name: party.name, type: "Actor", folder: party.folder?.id ?? null });
    await party.update({ folder: folder.id, "system.folder": folder.id });
    return folder;
  } finally {
    creating.delete(party.id);
  }
}

/* Move a PC into the Party's folder, or out of it. */
export async function joinParty(party, actor) {
  const folder = partyFolder(party) ?? await ensurePartyFolder(party);
  if (!folder || actor.type !== "pc") return;
  await actor.update({ folder: folder.id });
}

export async function leaveParty(party, actor) {
  const folder = partyFolder(party);
  if (!folder || !actor.folder || !folderTree(folder).has(actor.folder.id)) return;
  await actor.update({ folder: folder.folder?.id ?? null });
}

function refreshPartySheets() {
  for (const app of foundry.applications.instances.values()) {
    if (app.document?.type === "party" && app.options.classes.includes("paradigm-engine")) app.render();
  }
}

export function registerParty() {
  /* A new Party gets its folder from the client that made it. */
  Hooks.on("createActor", (actor, options, userId) => {
    if (actor.type === "party" && userId === game.user.id) ensurePartyFolder(actor);
  });

  /* A renamed Party renames its folder; a deleted Party leaves its folder
     and members behind, out in the folder above. */
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (actor.type === "party" && userId === game.user.id && "name" in changes) {
      const folder = partyFolder(actor);
      if (folder && folder.name !== actor.name) folder.update({ name: actor.name });
    }
    refreshPartySheets();
  });
  Hooks.on("deleteActor", (actor, options, userId) => {
    if (actor.type === "party" && userId === game.user.id) {
      partyFolder(actor)?.delete({ deleteSubfolders: false, deleteContents: false });
    }
    refreshPartySheets();
  });
  Hooks.on("createActor", refreshPartySheets);

  /* A renamed folder renames its Party; moves in and out of folders
     redraw the cards. */
  Hooks.on("updateFolder", (folder, changes, options, userId) => {
    if (folder.type === "Actor" && userId === game.user.id && "name" in changes) {
      const party = game.actors.find(a => a.type === "party" && a.system.folder === folder.id);
      if (party && party.name !== folder.name && party.isOwner) party.update({ name: folder.name });
    }
    refreshPartySheets();
  });
  Hooks.on("deleteFolder", refreshPartySheets);

  /* The Party stands out in the Actors directory. */
  Hooks.on("renderActorDirectory", (app, element) => {
    for (const li of element.querySelectorAll("li.directory-item.entry[data-entry-id]")) {
      const actor = game.actors.get(li.dataset.entryId);
      if (actor?.type !== "party") continue;
      li.classList.add("pe-party");
      const name = li.querySelector(".entry-name");
      if (!name || name.querySelector(".pe-party-icon")) continue;
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-users pe-party-icon";
      icon.inert = true;
      name.prepend(icon);
    }
  });
}
