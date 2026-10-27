/* Full-screen Combo and Fumble cut-in. Display only: the result rides the
   roll card as a system flag and every client plays the splash when the
   message is created. Waits for Dice So Nice when it is active.

   The cut-in is built of light: a flash into a glow, god rays or falling
   shafts, a lens flare and a bloom, a gradient ribbon on a diagonal with
   the roller's portrait as a lit medallion on it, the word in a glow, the
   two dice, sparkles, petals, and motes. Combo is gold and sweeps in from
   the left; Fumble is pink to violet and settles down from above. */

import { frameOf, frameStyle, portraitOf } from "../portrait.mjs";

const HOLD = { combo: 2300, fumble: 2500 };
const EXIT = 420;

/* x%, y%, size vw, gold, delay s */
const SPARKS = [
  [18, 16, 3.4, 1, 0], [30, 10, 2, 0, .4], [66, 12, 2.6, 1, .8], [84, 20, 3.8, 0, .2],
  [90, 48, 2.2, 1, 1.1], [78, 78, 3, 0, .6], [58, 84, 2, 1, .3], [40, 90, 2.8, 0, .9],
  [10, 60, 2.4, 1, .5], [47, 24, 1.8, 0, 1.3], [72, 40, 1.6, 1, .7], [25, 42, 2, 0, 1]
];
/* x%, y%, size vw, offset s */
const MOTES = [
  [8, 70, 1.2, 0], [20, 86, 2, 1.2], [36, 78, .9, 2.4], [52, 92, 1.6, .6],
  [64, 70, 1.1, 3.1], [80, 88, 2.2, 1.8], [92, 64, 1.3, 2.7], [44, 60, .8, 3.8]
];
/* x%, y%, offset s */
const PETALS = [[70, 0, 0], [88, 8, 1.1], [96, 30, 2.3], [55, 2, 3.2], [100, 50, 1.7], [80, 0, 2.8]];
const STAR = "M50 0 C 52 36, 64 48, 100 50 C 64 52, 52 64, 50 100 C 48 64, 36 52, 0 50 C 36 48, 48 36, 50 0 Z";

export function registerSplash() {
  Hooks.on("createChatMessage", message => {
    const kind = message.getFlag("paradigm-engine", "splash");
    if (!kind) return;
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      showSplash(kind, message);
    };
    if (game.modules.get("dice-so-nice")?.active) {
      const hookId = Hooks.on("diceSoNiceRollComplete", id => {
        if (id !== message.id) return;
        Hooks.off("diceSoNiceRollComplete", hookId);
        show();
      });
      setTimeout(() => {
        Hooks.off("diceSoNiceRollComplete", hookId);
        show();
      }, 8000);
    } else show();
  });
  /* A Luck replacement re-reads Combos and Fumbles; the changed splash flag
     arrives with the message update on every client. */
  Hooks.on("updateChatMessage", (message, changes) => {
    const kind = foundry.utils.getProperty(changes, "flags.paradigm-engine.splash");
    if (kind !== "combo" && kind !== "fumble") return;
    showSplash(kind, message);
  });
}

/* The roller's picture: the actor's portrait in its frame, else the
   token's art, else none. */
function speakerArt(message) {
  const speaker = message.speaker;
  const actor = speaker?.actor ? game.actors.get(speaker.actor) : null;
  const portrait = portraitOf(actor);
  if (portrait) return { src: portrait, style: frameStyle(frameOf(actor)) };
  const token = speaker?.scene && speaker?.token ? game.scenes.get(speaker.scene)?.tokens.get(speaker.token) : null;
  const src = token?.texture?.src ?? "";
  if (!src || /\.svg(\?.*)?$/i.test(src)) return null;
  return { src, style: "" };
}

function svgStar() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", STAR);
  svg.appendChild(path);
  return svg;
}

export function showSplash(kind, message) {
  document.querySelector(".pe-splash")?.remove();
  const card = message.getFlag("paradigm-engine", "card");
  const faces = card?.faces ?? message.rolls[0]?.dice.map(d => d.total) ?? [];
  const word = game.i18n.localize(`PARADIGMENGINE.Splash.${kind === "combo" ? "Combo" : "Fumble"}`);
  const art = speakerArt(message);
  const el = document.createElement("div");
  el.className = `pe-splash ${kind}`;
  el.innerHTML = `
    <div class="flash"></div>
    <div class="dim"></div>
    <div class="rays"></div>
    <div class="shafts"></div>
    <div class="motes"></div>
    <div class="ribbon2"></div>
    <div class="ribbon"><div class="sheen"></div></div>
    <div class="bloom"></div>
    <div class="flare"></div>
    <div class="art"></div>
    <div class="mid">
      <div class="wordbox">
        <div class="ring"></div>
        <div class="echo"></div>
        <div class="word"></div>
      </div>
      <div class="row">
        ${faces.map(f => `<span class="die">${f}</span>`).join("")}
        ${kind === "combo" && card?.energy > 0 ? `<span class="chip">${game.i18n.localize("PARADIGMENGINE.Splash.Energy")}</span>` : ""}
        ${kind === "fumble" && card?.hearts > 0 ? `<span class="chip">${card.hearts === 1 ? game.i18n.localize("PARADIGMENGINE.Splash.Heart") : game.i18n.format("PARADIGMENGINE.Splash.Hearts", { n: card.hearts })}</span>` : ""}
      </div>
    </div>
    <div class="who"><span class="nm"></span><span class="kind"></span></div>
    <div class="sparks"></div>`;
  el.querySelector(".word").textContent = word;
  el.querySelector(".echo").textContent = word;
  el.querySelector(".nm").textContent = message.alias;
  el.querySelector(".kind").textContent = game.i18n.localize("PARADIGMENGINE.Roll.Title");

  const artBox = el.querySelector(".art");
  if (art) {
    const img = document.createElement("img");
    img.src = art.src;
    img.style.cssText = art.style;
    artBox.appendChild(img);
  } else artBox.remove();

  const sparks = el.querySelector(".sparks");
  for (const [x, y, size, gold, delay] of SPARKS) {
    const star = svgStar();
    star.style.cssText = `left:${x}%;top:${y}%;width:${size}vw;height:${size}vw;animation-delay:${delay}s`;
    if (gold) star.classList.add("g");
    sparks.appendChild(star);
  }
  const motes = el.querySelector(".motes");
  for (const [x, y, size, offset] of MOTES) {
    const mote = document.createElement("span");
    mote.className = "mote";
    mote.style.cssText = `left:${x}%;top:${y}%;width:${size}vw;height:${size}vw;animation-delay:${-offset}s`;
    motes.appendChild(mote);
  }
  for (const [x, y, offset] of PETALS) {
    const petal = document.createElement("span");
    petal.className = "petal";
    petal.style.cssText = `left:${x}%;top:${y}%;animation-delay:${-offset}s`;
    motes.appendChild(petal);
  }

  const close = () => {
    if (el.classList.contains("closing")) return;
    el.classList.add("closing");
    setTimeout(() => el.remove(), EXIT);
  };
  el.addEventListener("click", close, { once: true });
  setTimeout(close, HOLD[kind]);
  document.body.appendChild(el);
}
