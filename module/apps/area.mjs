import { LADDER } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* Areas: the Area chip on a Technique or Trait opens the Size dialog —
   1 to the item's Die Value, defaulting to the Die Value, counted in
   tiles — and Place previews the burst on the canvas. A left click
   commits it as a polygon Drawing (V14 has no persistent Measured
   Templates); Escape or a right click cancels. A user without drawing
   rights still flashes the committed shape for the table. */

export function registerAreas() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    for (const chip of html.querySelectorAll("[data-area-cap]")) {
      chip.addEventListener("click", () => AreaDialog.open(Number(chip.dataset.areaCap)));
    }
  });
}

/* The Size cap of an item's area: its Rank's Die Value. */
export function areaCap(item) {
  return LADDER[item.system.rank].dieValue;
}

export function openItemArea(item) {
  if (item?.system.area) AreaDialog.open(areaCap(item));
}

export class AreaDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ cap, ...options } = {}) {
    super(options);
    this.#cap = cap;
    this.#size = cap;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "area-dialog"],
    position: { width: 250, height: "auto" },
    actions: {
      step: this.#onStep,
      place: this.#onPlace
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/area-dialog.hbs" }
  };

  static #instance = null;

  #cap;

  #size;

  static open(cap) {
    if (!Number.isFinite(cap) || cap < 1) return;
    this.#instance?.close();
    this.#instance = new this({ cap });
    this.#instance.render(true);
  }

  get title() {
    return game.i18n.localize("PROJECTANIME.Item.Area");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.size = this.#size;
    context.downDisabled = this.#size <= 1;
    context.upDisabled = this.#size >= this.#cap;
    return context;
  }

  _onClose(options) {
    super._onClose(options);
    if (AreaDialog.#instance === this) AreaDialog.#instance = null;
  }

  static #onStep(event, target) {
    this.#size = Math.clamp(this.#size + Number(target.dataset.dir), 1, this.#cap);
    this.render();
  }

  static async #onPlace() {
    const size = this.#size;
    await this.close();
    await placeBurst(size);
  }
}

/* The burst outline: the tiles no wider than size from the origin,
   counted cardinal — a staircase diamond in origin-local pixels. Even
   widths anchor a tile corner, odd widths a tile center. */
function burstPoints(size) {
  const g = canvas.dimensions.size;
  const r = size / 2;
  const even = size % 2 === 0;
  const half = [];
  for (let k = 0; k < size; k++) {
    const m = r - Math.abs(k + 0.5 - r);
    half.push(even ? m + 0.5 : Math.floor(m) + 0.5);
  }
  const points = [-half[0] * g, -r * g];
  for (let k = 0; k < size; k++) {
    points.push(half[k] * g, (k - r) * g, half[k] * g, (k + 1 - r) * g);
  }
  for (let k = size - 1; k > 0; k--) {
    points.push(-half[k] * g, (k + 1 - r) * g, -half[k] * g, (k - r) * g);
  }
  points.push(-half[0] * g, (1 - r) * g);
  return points;
}

function drawBurst(g, points) {
  const color = Number(game.user.color);
  g.clear();
  g.lineStyle(3, color, 0.9);
  g.beginFill(color, 0.18);
  g.drawPolygon(points);
  g.endFill();
}

/* Transient flash of a committed burst nothing could persist, faded out
   over 1.5 seconds so the table still sees where it landed. */
function flashBurst(points, origin) {
  const g = new PIXI.Graphics();
  drawBurst(g, points);
  g.position.set(origin.x, origin.y);
  canvas.controls.addChild(g);
  const started = Date.now();
  const life = 1500;
  const tick = () => {
    const t = (Date.now() - started) / life;
    if (t >= 1 || g.destroyed) {
      canvas.app?.ticker?.remove(tick);
      if (!g.destroyed) g.destroy({ children: true });
      return;
    }
    g.alpha = 1 - t;
  };
  canvas.app?.ticker?.add(tick);
}

async function commitBurst(size, points, origin) {
  const r = (size / 2) * canvas.dimensions.size;
  try {
    await canvas.scene.createEmbeddedDocuments("Drawing", [{
      x: origin.x - r,
      y: origin.y - r,
      shape: {
        type: "p",
        width: Math.round(2 * r),
        height: Math.round(2 * r),
        points: points.map(v => v + r)
      },
      fillType: CONST.DRAWING_FILL_TYPES.SOLID,
      fillColor: game.user.color.css,
      fillAlpha: 0.18,
      strokeColor: game.user.color.css,
      strokeWidth: 3,
      strokeAlpha: 0.9
    }]);
  } catch (error) {
    flashBurst(points, origin);
  }
}

/* Interactive placement: a preview on the controls layer follows the
   snapped cursor; a left click commits, Escape or a right click cancels. */
export async function placeBurst(size) {
  if (!canvas?.ready || !canvas.scene) return;
  const points = burstPoints(size);
  const g = new PIXI.Graphics();
  drawBurst(g, points);
  canvas.controls.addChild(g);

  const M = CONST.GRID_SNAPPING_MODES;
  const mode = size % 2 === 0 ? M.VERTEX : M.CENTER;
  const snap = p => canvas.grid.getSnappedPoint(p, { mode });
  let point = snap(canvas.mousePosition ?? { x: canvas.dimensions.width / 2, y: canvas.dimensions.height / 2 });
  g.position.set(point.x, point.y);

  return new Promise(resolve => {
    const stage = canvas.stage;
    const view = canvas.app?.view;
    const prevContext = view ? view.oncontextmenu : null;
    let done = false;
    let moveTime = 0;

    const onMove = event => {
      event.stopPropagation?.();
      const now = Date.now();
      if (now - moveTime <= 20) return;
      moveTime = now;
      point = snap(event.getLocalPosition(stage));
      g.position.set(point.x, point.y);
    };

    const finish = async commit => {
      if (done) return;
      done = true;
      stage.off("pointermove", onMove);
      stage.off("pointerdown", onDown);
      if (view) view.oncontextmenu = prevContext;
      window.removeEventListener("keydown", onKey, true);
      if (commit) await commitBurst(size, points, point);
      if (!g.destroyed) g.destroy({ children: true });
      resolve();
    };

    const onDown = event => {
      if (event.button != null && event.button !== 0) return;
      event.stopPropagation?.();
      finish(true);
    };
    const onKey = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    };

    if (view) view.oncontextmenu = event => {
      event.preventDefault();
      finish(false);
    };
    stage.on("pointermove", onMove);
    stage.on("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
  });
}
