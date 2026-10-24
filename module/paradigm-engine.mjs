import CharacterData from "./data/character.mjs";
import AdversaryData from "./data/adversary.mjs";
import SkillData from "./data/skill.mjs";
import CharacterSheet from "./sheets/character-sheet.mjs";
import AdversarySheet from "./sheets/adversary-sheet.mjs";
import ParadigmEngineItemSheet from "./sheets/item-sheet.mjs";
import { registerSplash } from "./apps/splash.mjs";
import { registerLuck } from "./apps/luck-picker.mjs";
import { registerPartyHud } from "./apps/party-hud.mjs";
import { registerAdversaryFrame } from "./apps/adversary-frame.mjs";
import { registerSkillBar } from "./apps/skill-bar.mjs";
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
  registerPartyHud();
  registerAdversaryFrame();
  registerSkillBar();
  registerSidebarToggle();
  registerCombat();
  registerTokenDefaults();
  registerEncounterTracker();
  registerDistance();
  registerAreas();
  registerMigrations();

  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Actor.dataModels.adversary = AdversaryData;
  CONFIG.Item.dataModels.skill = SkillData;

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
    types: ["skill"],
    makeDefault: true,
    label: "PARADIGMENGINE.Sheet.Item"
  });

  foundry.applications.handlebars.loadTemplates([
    "systems/paradigm-engine/templates/actor/badge.hbs",
    "systems/paradigm-engine/templates/actor/vitals.hbs",
    "systems/paradigm-engine/templates/actor/rail.hbs",
    "systems/paradigm-engine/templates/actor/skills-panel.hbs",
    "systems/paradigm-engine/templates/apps/encounter-row.hbs"
  ]);
});
