/* Per-user theme for the PC, NPC, and Skill Files, the Skill Tree, and the
   Action Roll: light, dark, or following Foundry's own Applications color
   scheme. Applied as a class on the body; the stylesheet does the rest. */

const SETTING = "theme";
const THEMES = ["light", "dark", "foundry"];

export function registerTheme() {
  game.settings.register("paradigm-engine", SETTING, {
    name: "PARADIGMENGINE.Settings.Theme.Name",
    scope: "client",
    config: true,
    type: String,
    choices: {
      light: "PARADIGMENGINE.Settings.Theme.Light",
      dark: "PARADIGMENGINE.Settings.Theme.Dark",
      foundry: "PARADIGMENGINE.Settings.Theme.Foundry"
    },
    default: "light",
    onChange: applyTheme
  });
  applyTheme(game.settings.get("paradigm-engine", SETTING));
}

function applyTheme(theme) {
  const classes = document.body.classList;
  for (const t of THEMES) classes.remove(`pe-theme-${t}`);
  classes.add(`pe-theme-${THEMES.includes(theme) ? theme : "light"}`);
}
