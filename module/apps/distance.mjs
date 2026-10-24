const INK = 0x221a36;
const PAPER = 0xf7f2e7;
const EPS = 1e-6;
const ENGAGED_COLOR = "#8a8fa0";
const RANGE_COLOR = "#d9a13b";

/* ============================================================
   Measurement. Every scene measures 1 tile per grid space (the
   hooks below hold created and imported maps to it), so gridless
   scenes measure the same as gridded ones. Token distance is edge
   to edge, the gap between the two footprints, counted in tiles
   the cardinal way: the axis gaps add, so a diagonal costs both
   its legs. Engaged is a gap of at most one tile. Display only.
   ============================================================ */

/* A tile count as text, rounded to tenths. */
function countLabel(tiles) {
  const n = tiles.toNearest(0.1);
  return game.i18n.format(n === 1 ? "PARADIGMENGINE.Distance.Tile" : "PARADIGMENGINE.Distance.Tiles", {
    n: n.toLocaleString(game.i18n.lang)
  });
}

/* Engaged within one tile, else the tile count. */
function distanceLabel(tiles) {
  if (tiles <= 1 + EPS) return game.i18n.localize("PARADIGMENGINE.Distance.Engaged");
  return countLabel(tiles);
}

/* The pixel rectangle of a token's footprint. */
function footprint(document) {
  const { width, height } = document.getSize();
  return { x: document.x, y: document.y, w: width, h: height };
}

/* The gap between two rectangles, in pixels, counted the cardinal
   way: the horizontal and vertical gaps add. */
function rectGap(a, b) {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  return dx + dy;
}

/* Edge-to-edge distance between two tokens: scene distance units, the
   count in tiles, whether the pair is Engaged, and the label. Takes
   Tokens or TokenDocuments. */
export function getDistance(tokenA, tokenB) {
  const a = footprint(tokenA.document ?? tokenA);
  const b = footprint(tokenB.document ?? tokenB);
  const units = rectGap(a, b) / canvas.dimensions.distancePixels;
  const tiles = units / canvas.scene.grid.distance;
  return { units, tiles, engaged: tiles <= 1 + EPS, label: distanceLabel(tiles) };
}

/* ============================================================
   Token drag ruler: the label of the dragged position counts the
   tiles of displacement from the drag origin.
   ============================================================ */

export class DistanceTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {
  static WAYPOINT_LABEL_TEMPLATE = "systems/paradigm-engine/templates/hud/waypoint-label.hbs";

  refresh(rulerData) {
    super.refresh(rulerData);
    if (this.token.isDragged) clearRangeLine();
  }

  /* Dragged labels: displacement from the start of the planned path,
     however the path bends, counted the cardinal way — the fewest
     tiles that walk there, diagonals costing two. The tile count
     replaces the numeric measurement in the template. */
  _getWaypointLabelContext(waypoint, state) {
    const context = super._getWaypointLabelContext(waypoint, state);
    if (!context || (waypoint.stage !== "planned")) return context;
    let origin = waypoint;
    while (origin.previous && (origin.previous.stage === "planned")) origin = origin.previous;
    const pixels = Math.abs(waypoint.center.x - origin.center.x) + Math.abs(waypoint.center.y - origin.center.y);
    const units = pixels / canvas.dimensions.distancePixels;
    context.tiles = { label: countLabel(units / canvas.scene.grid.distance), color: RANGE_COLOR };
    return context;
  }
}

/* ============================================================
   Hover range line: with one token controlled, hovering another
   visible token draws an edge-to-edge line labeled with the
   distance between them. Gone when the hover ends or a drag starts.
   ============================================================ */

let line = null;
let tag = null;
let tagPlace = null;
let pair = null;

export function clearRangeLine() {
  if (line && !line.destroyed) line.destroy({ children: true });
  line = null;
  tag = null;
  tagPlace = null;
  pair = null;
}

/* The plate holds a constant screen size, centered on the line when
   the line is long enough to carry it; too short — close tokens,
   Engaged, overlap — and it lifts above the pair instead. Re-placed
   on every pan and zoom. */
function placeTag() {
  if (!tag || tag.destroyed) return;
  const zoom = canvas.stage.scale.x;
  tag.scale.set(1 / zoom);
  if ((tagPlace.segment * zoom) < (tagPlace.w + 16)) {
    tag.position.set(tagPlace.x, tagPlace.top - (((tagPlace.h / 2) + 8) / zoom));
  }
  else tag.position.set(tagPlace.x, tagPlace.y);
}

/* Where the segment from c1 to c2 enters and leaves the rectangle, as
   parameters along the segment, or null when it misses. */
function clipToRect(c1, c2, r) {
  let t0 = 0;
  let t1 = 1;
  const p = [c1.x - c2.x, c2.x - c1.x, c1.y - c2.y, c2.y - c1.y];
  const q = [c1.x - r.x, r.x + r.w - c1.x, c1.y - r.y, r.y + r.h - c1.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  return t0 <= t1 ? [t0, t1] : null;
}

function drawRangeLine(target) {
  clearRangeLine();
  if (!canvas.ready || (canvas.tokens.controlled.length !== 1)) return;
  const source = canvas.tokens.controlled[0];
  if ((source === target) || !target.visible) return;
  if (source.isDragged || target.isDragged) return;

  const a = footprint(source.document);
  const b = footprint(target.document);
  const units = rectGap(a, b) / canvas.dimensions.distancePixels;
  const tiles = units / canvas.scene.grid.distance;
  const engaged = tiles <= 1 + EPS;
  const tint = engaged ? ENGAGED_COLOR : RANGE_COLOR;
  const color = foundry.utils.Color.from(tint);
  const s = canvas.dimensions.uiScale;

  line = canvas.interface.addChild(new PIXI.Container());
  line.eventMode = "none";
  line.interactiveChildren = false;
  pair = { from: source.document.id, to: target.document.id };

  /* The line runs between the footprint edges, along the segment
     joining the centers; overlapping footprints draw only the label. */
  const c1 = { x: a.x + (a.w / 2), y: a.y + (a.h / 2) };
  const c2 = { x: b.x + (b.w / 2), y: b.y + (b.h / 2) };
  const inA = clipToRect(c1, c2, a);
  const inB = clipToRect(c1, c2, b);
  let anchor = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
  let segment = 0;
  if (inA && inB && (inA[1] < inB[0])) {
    const at = t => ({ x: c1.x + ((c2.x - c1.x) * t), y: c1.y + ((c2.y - c1.y) * t) });
    const p1 = at(inA[1]);
    const p2 = at(inB[0]);
    segment = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const g = line.addChild(new PIXI.Graphics());
    g.lineStyle({ width: 5.5 * s, color: INK, alpha: 0.55, cap: PIXI.LINE_CAP.ROUND });
    g.moveTo(p1.x, p1.y);
    g.lineTo(p2.x, p2.y);
    g.lineStyle({
      width: 3 * s,
      color,
      shader: new foundry.canvas.rendering.shaders.DashLineShader({ dash: 9 * s, gap: 6 * s }),
      cap: PIXI.LINE_CAP.ROUND
    });
    g.moveTo(p1.x, p1.y);
    g.lineTo(p2.x, p2.y);
    g.lineStyle({ width: 1.5 * s, color: PAPER });
    g.beginFill(color, 1);
    g.drawCircle(p1.x, p1.y, 4 * s);
    g.drawCircle(p2.x, p2.y, 4 * s);
    g.endFill();
    anchor = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  }

  /* The label rides a dark plate; placeTag decides where it sits. */
  const text = distanceLabel(tiles).toUpperCase();
  tag = line.addChild(new PIXI.Container());
  const label = new foundry.canvas.containers.PreciseText(text, new PIXI.TextStyle({
    fontFamily: ["Zen Kaku Gothic New", "sans-serif"],
    fontSize: 13,
    fontWeight: "700",
    fill: tint,
    letterSpacing: 1.5
  }));
  label.resolution = 4;
  label.anchor.set(0.5, 0.5);
  const w = Math.ceil(label.width) + 20;
  const h = Math.ceil(label.height) + 10;
  const plate = tag.addChild(new PIXI.Graphics());
  plate.beginFill(INK, 0.92).drawRoundedRect(-w / 2, -h / 2, w, h, 4).endFill();
  plate.lineStyle({ width: 1, color, alpha: 0.9 });
  plate.drawRoundedRect(-w / 2, -h / 2, w, h, 4);
  tag.addChild(label);
  tagPlace = { x: anchor.x, y: anchor.y, top: Math.min(a.y, b.y), w, h, segment };
  placeTag();
}

/* A shown pair follows its tokens: redraw when either refreshes. */
function refreshPair(token) {
  if (!pair) return;
  if ((token.document.id !== pair.from) && (token.document.id !== pair.to)) return;
  const target = canvas.tokens.get(pair.to);
  if (target) drawRangeLine(target);
  else clearRangeLine();
}

/* ============================================================ */

export function registerDistance() {
  CONFIG.Token.rulerClass = DistanceTokenRuler;
  game.system.api = Object.assign(game.system.api ?? {}, { getDistance });

  /* The board speaks tiles: every scene measures 1 tile per grid
     space, whatever a creation or import carries — most maps arrive
     in feet. Grid edits keep the same footing. */
  Hooks.on("preCreateScene", scene => {
    scene.updateSource({ "grid.distance": 1, "grid.units": "tiles" });
  });
  Hooks.on("preUpdateScene", (scene, changes) => {
    if (changes.grid === undefined) return;
    if (!("distance" in changes.grid) && !("units" in changes.grid)) return;
    changes.grid.distance = 1;
    changes.grid.units = "tiles";
  });

  /* The range line label's font, loaded for canvas text. */
  CONFIG.fontDefinitions["Zen Kaku Gothic New"] ??= {
    editor: false,
    fonts: [
      { urls: ["systems/paradigm-engine/fonts/ZenKakuGothicNew-Bold.woff2"], weight: "700" }
    ]
  };

  Hooks.on("hoverToken", (token, hovered) => {
    if (hovered) drawRangeLine(token);
    else if (pair?.to === token.document.id) clearRangeLine();
  });
  Hooks.on("controlToken", () => clearRangeLine());
  Hooks.on("refreshToken", refreshPair);
  Hooks.on("deleteToken", document => {
    if (pair && ((document.id === pair.from) || (document.id === pair.to))) clearRangeLine();
  });
  Hooks.on("canvasPan", placeTag);
  Hooks.on("canvasTearDown", clearRangeLine);
}
