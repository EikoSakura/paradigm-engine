import PcData from "./data/pc.mjs";
import NpcData from "./data/npc.mjs";
import SkillData from "./data/skill.mjs";
import PartyData from "./data/party.mjs";
import PcSheet from "./sheets/pc-sheet.mjs";
import NpcSheet from "./sheets/npc-sheet.mjs";
import PartySheet from "./sheets/party-sheet.mjs";
import { registerParty } from "./party.mjs";
import ParadigmEngineItemSheet from "./sheets/item-sheet.mjs";
import { registerSplash } from "./apps/splash.mjs";
import { registerLuck } from "./apps/luck-picker.mjs";
import { registerSidebarToggle } from "./apps/sidebar-toggle.mjs";
import { registerTokenDefaults } from "./tokens.mjs";
import { registerMigrations } from "./migrations.mjs";
import { registerSkillTree } from "./apps/skill-tree.mjs";
import { registerTheme } from "./theme.mjs";
import { registerClash } from "./apps/clash.mjs";
import { registerChecks } from "./checks.mjs";
import { registerChain, registerChat } from "./chat.mjs";
import { registerTracker } from "./tracker.mjs";
import { registerStartingSkills } from "./starting-skills.mjs";
import { registerStage } from "./apps/stage.mjs";
import { registerTitleScreen } from "./apps/title-screen.mjs";

Hooks.once("init", () => {
  registerStartingSkills();
  registerSplash();
  registerChain();
  registerLuck();
  registerSidebarToggle();
  registerTokenDefaults();
  registerMigrations();
  registerSkillTree();
  registerTheme();
  registerClash();
  registerChecks();
  registerChat();
  registerParty();
  registerTracker();
  registerStage();
  registerTitleScreen();

  CONFIG.Actor.dataModels.pc = PcData;
  CONFIG.Actor.dataModels.npc = NpcData;
  CONFIG.Actor.dataModels.party = PartyData;
  CONFIG.Item.dataModels.skill = SkillData;

  foundry.documents.collections.Actors.registerSheet("paradigm-engine", PcSheet, {
    types: ["pc"],
    makeDefault: true,
    label: "PARADIGMENGINE.Sheet.PC"
  });
  foundry.documents.collections.Actors.registerSheet("paradigm-engine", NpcSheet, {
    types: ["npc"],
    makeDefault: true,
    label: "PARADIGMENGINE.Sheet.NPC"
  });
  foundry.documents.collections.Actors.registerSheet("paradigm-engine", PartySheet, {
    types: ["party"],
    makeDefault: true,
    label: "PARADIGMENGINE.Sheet.Party"
  });
  foundry.documents.collections.Items.registerSheet("paradigm-engine", ParadigmEngineItemSheet, {
    types: ["skill"],
    makeDefault: true,
    label: "PARADIGMENGINE.Sheet.Item"
  });

  foundry.applications.handlebars.loadTemplates([
    "systems/paradigm-engine/templates/actor/badge.hbs",
    "systems/paradigm-engine/templates/actor/attributes-card.hbs",
    "systems/paradigm-engine/templates/actor/skills-card.hbs",
    "systems/paradigm-engine/templates/actor/checks-card.hbs",
    "systems/paradigm-engine/templates/chat/multi-row.hbs",
    "systems/paradigm-engine/templates/apps/skill-step.hbs"
  ]);
  foundry.applications.handlebars.loadTemplates({
    growthBondRow: "systems/paradigm-engine/templates/apps/growth-bond-row.hbs"
  });
});
