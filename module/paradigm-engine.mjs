import CharacterData from "./data/character.mjs";
import AdversaryData from "./data/adversary.mjs";
import TraitData from "./data/trait.mjs";
import TechniqueData from "./data/technique.mjs";
import CharacterSheet from "./sheets/character-sheet.mjs";
import AdversarySheet from "./sheets/adversary-sheet.mjs";
import ParadigmEngineItemSheet from "./sheets/item-sheet.mjs";
import { registerSplash } from "./apps/splash.mjs";
import { registerLuck } from "./apps/luck-picker.mjs";
import { registerTension } from "./apps/tension.mjs";
import { registerTracks } from "./apps/tracks.mjs";
import { registerPartyHud } from "./apps/party-hud.mjs";
import { registerAdversaryFrame } from "./apps/adversary-frame.mjs";
import { registerTechniqueBar } from "./apps/technique-bar.mjs";
import { registerSidebarToggle } from "./apps/sidebar-toggle.mjs";
import { registerCombat } from "./combat.mjs";
import { registerTokenDefaults } from "./tokens.mjs";
import { registerEncounterTracker } from "./apps/encounter-tracker.mjs";
import { registerDistance } from "./apps/distance.mjs";
import { registerAreas } from "./apps/area.mjs";
import { registerMigrations } from "./migrations.mjs";

Hooks.once("init", () => {
  registerSplash();
  registerLuck();
  registerTension();
  registerTracks();
  registerPartyHud();
  registerAdversaryFrame();
  registerTechniqueBar();
  registerSidebarToggle();
  registerCombat();
  registerTokenDefaults();
  registerEncounterTracker();
  registerDistance();
  registerAreas();
  registerMigrations();

  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Actor.dataModels.adversary = AdversaryData;
  CONFIG.Item.dataModels.trait = TraitData;
  CONFIG.Item.dataModels.technique = TechniqueData;

  foundry.documents.collections.Actors.registerSheet("paradigm-engine", CharacterSheet, {
    types: ["character"],
    makeDefault: true,
    label: "PARADIGMENGINE.Sheet.Character"
  });
  foundry.documents.collections.Actors.registerSheet("paradigm-engine", AdversarySheet, {
    types: ["adversary"],
    makeDefault: true,
    label: "PARADIGMENGINE.Sheet.Adversary"
  });
  foundry.documents.collections.Items.registerSheet("paradigm-engine", ParadigmEngineItemSheet, {
    types: ["trait", "technique"],
    makeDefault: true,
    label: "PARADIGMENGINE.Sheet.Item"
  });

  foundry.applications.handlebars.loadTemplates([
    "systems/paradigm-engine/templates/actor/badge.hbs",
    "systems/paradigm-engine/templates/actor/vitals.hbs",
    "systems/paradigm-engine/templates/actor/rail.hbs",
    "systems/paradigm-engine/templates/actor/traits-panel.hbs",
    "systems/paradigm-engine/templates/actor/techniques-panel.hbs",
    "systems/paradigm-engine/templates/apps/encounter-row.hbs"
  ]);
});
