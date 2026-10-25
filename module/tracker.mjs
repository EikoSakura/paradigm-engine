/* The Encounter tracker: Foundry's own combat tracker, picked freely.
   There is no initiative. The Storyteller clicks a name to make that
   character the acting one; Previous and Next pass the turn along the
   list in the order the combatants joined, and a player whose turn it is
   can end it. A player raises a hand on their own row to ask for the
   turn; the hand clears when the turn reaches them. The hand is a flag
   on the combatant, which the actor's owner may write. */

const HAND = "hand";

export class ParadigmCombat extends foundry.documents.Combat {
  /* The order combatants joined, never initiative. */
  _sortCombatants(a, b) {
    const ta = a._stats?.createdTime ?? 0;
    const tb = b._stats?.createdTime ?? 0;
    return (ta - tb) || (a.id > b.id ? 1 : -1);
  }

  /* Begin with no one acting: the Storyteller picks. */
  async startCombat() {
    this._playCombatSound("startEncounter");
    const updateData = { round: 1, turn: null };
    Hooks.callAll("combatStart", this, updateData);
    await this.update(updateData);
    await ActiveEffect.registry.refresh("combatStart", { combat: this });
    return this;
  }

  /* Make one combatant the acting one, beginning the encounter if it
     has not begun. */
  async pickTurn(combatantId) {
    const turn = this.turns.findIndex(c => c.id === combatantId);
    if (turn < 0) return this;
    if (turn === this.turn && this.started) return this;
    const updateData = { round: Math.max(this.round, 1), turn };
    const updateOptions = { direction: 1 };
    Hooks.callAll("combatTurn", this, updateData, updateOptions);
    await this.update(updateData, updateOptions);
    return this;
  }

  /* The acting combatant's hand comes down, through the Storyteller's client. */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if (!("turn" in changed) && !("round" in changed)) return;
    if (!game.user.isActiveGM) return;
    const combatant = this.combatant;
    if (combatant?.getFlag("paradigm-engine", HAND)) combatant.unsetFlag("paradigm-engine", HAND);
  }
}

export class ParadigmTracker extends foundry.applications.sidebar.tabs.CombatTracker {
  static DEFAULT_OPTIONS = {
    actions: {
      raiseHand: ParadigmTracker.#onRaiseHand
    }
  };

  static PARTS = {
    header: { template: "systems/paradigm-engine/templates/tracker/header.hbs" },
    tracker: { template: "systems/paradigm-engine/templates/tracker/tracker.hbs", scrollable: [""] },
    footer: { template: "systems/paradigm-engine/templates/tracker/footer.hbs" }
  };

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === "tracker") {
      await this._prepareCombatContext(context, options);
      const combat = this.viewed;
      context.roundLabel = !combat
        ? game.i18n.localize("PARADIGMENGINE.Tracker.None")
        : combat.round
          ? game.i18n.format("PARADIGMENGINE.Tracker.Round", { n: combat.round })
          : game.i18n.localize("PARADIGMENGINE.Tracker.NotStarted");
    }
    return context;
  }

  async _prepareTurnContext(combat, combatant, index) {
    const turn = await super._prepareTurnContext(combat, combatant, index);
    turn.kind = game.i18n.localize(CONFIG.Actor.typeLabels[combatant.actor?.type] ?? "");
    turn.hand = !!combatant.getFlag("paradigm-engine", HAND);
    turn.canRaise = !game.user.isGM && combatant.isOwner && !turn.active;
    turn.css = [turn.css, turn.hand ? "hand" : null].filterJoin(" ");
    return turn;
  }

  /* The Storyteller's click on a row makes it the acting one; the token
     control and pan of the core tracker follow. */
  _onCombatantMouseDown(event, target) {
    const isControl = foundry.utils.isElementInstanceOf(event.target, "input")
      || foundry.utils.isElementInstanceOf(event.target, "button");
    if (event.type !== "dblclick" && game.user.isGM && !isControl) {
      const { combatantId } = target?.dataset ?? {};
      if (combatantId) this.viewed?.pickTurn(combatantId);
    }
    return super._onCombatantMouseDown(event, target);
  }

  static async #onRaiseHand(event, target) {
    const { combatantId } = target.closest("[data-combatant-id]")?.dataset ?? {};
    const combatant = this.viewed?.combatants.get(combatantId);
    if (!combatant?.isOwner) return;
    if (combatant.getFlag("paradigm-engine", HAND)) await combatant.unsetFlag("paradigm-engine", HAND);
    else await combatant.setFlag("paradigm-engine", HAND, Date.now());
  }

  /* No initiative entries; the Storyteller may lower a hand. */
  _getEntryContextOptions() {
    const getCombatant = li => this.viewed.combatants.get(li.dataset.combatantId);
    const options = super._getEntryContextOptions()
      .filter(o => !["COMBATANT.ACTIONS.Clear", "COMBATANT.ACTIONS.Reroll"].includes(o.label));
    options.unshift({
      label: "PARADIGMENGINE.Tracker.LowerHand",
      icon: "fa-solid fa-hand",
      visible: li => game.user.isGM && !!getCombatant(li)?.getFlag("paradigm-engine", HAND),
      onClick: (event, li) => getCombatant(li)?.unsetFlag("paradigm-engine", HAND)
    });
    return options;
  }

  _getCombatContextOptions() {
    return super._getCombatContextOptions().filter(o => o.label !== "COMBAT.InitiativeReset");
  }
}

export function registerTracker() {
  CONFIG.Combat.documentClass = ParadigmCombat;
  CONFIG.ui.combat = ParadigmTracker;
}
