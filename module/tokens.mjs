/* Token artwork always stays upright: new actors' prototype tokens default
   Lock Rotation on, and every placed token is forced to it (covers actors
   created before this default). Unchecking Lock Rotation on an individual
   placed token afterwards still works. A new PC's prototype token also
   links its actor data, so every token of a PC is the PC. */

export function registerTokenDefaults() {
  Hooks.on("preCreateActor", (actor, data) => {
    if (foundry.utils.getProperty(data, "prototypeToken.lockRotation") === undefined) {
      actor.updateSource({ "prototypeToken.lockRotation": true });
    }
    if (actor.type === "pc" && foundry.utils.getProperty(data, "prototypeToken.actorLink") === undefined) {
      actor.updateSource({ "prototypeToken.actorLink": true });
    }
  });
  Hooks.on("preCreateToken", (token) => {
    token.updateSource({ lockRotation: true });
  });
}
