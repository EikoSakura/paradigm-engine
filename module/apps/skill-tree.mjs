import { LADDER, costLabel } from "../config.mjs";
import { resolveRank, takeSkill } from "../skills.mjs";
import { frameOf, frameStyle, portraitOf } from "../portrait.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const COL = 248;
const ROW = 76;
const CARD_W = 204;
const CARD_H = 58;
const PAD_X = 26;
const PAD_Y = 34;
const LANE_GAP = 22;
const SCALE_MIN = 0.4;
const SCALE_MAX = 1.4;
const SCALE_STEP = 0.1;

/* The Skill Tree: the world Skills the Storyteller has placed in it, laid
   out by their prerequisite chains. Each root Skill heads a Line, a lane
   tinted in its Rank's colour, with its specializations centred on their
   foundation to the right. The Storyteller builds it here: a Skill
   dragged in from the Items sidebar joins as a root, dropped onto a node
   it becomes that node's specialization, and a node's mark takes it out
   again. Opened for a PC it marks each node Known, Available when its
   foundation is Known, or Locked, and the take button on an Available
   node copies that Skill onto the PC. A Line or any branch folds down to
   its head, the Lines list jumps the board to a Line, and a search or a
   state filter dims everything else. */
export default class SkillTree extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["paradigm-engine", "skill-tree"],
    window: { resizable: true },
    position: { width: 1000, height: 680 },
    actions: {
      selectNode: this.#onSelectNode,
      openNode: this.#onOpenNode,
      takeNode: this.#onTakeNode,
      removeNode: this.#onRemoveNode,
      foldNode: this.#onFoldNode,
      foldAll: this.#onFoldAll,
      jumpLine: this.#onJumpLine,
      setFilter: this.#onSetFilter,
      zoomIn: this.#onZoomIn,
      zoomOut: this.#onZoomOut,
      zoomFit: this.#onZoomFit
    }
  };

  static PARTS = {
    strip: { template: "systems/paradigm-engine/templates/apps/skill-tree-strip.hbs" },
    bar: { template: "systems/paradigm-engine/templates/apps/skill-tree-bar.hbs" },
    board: { template: "systems/paradigm-engine/templates/apps/skill-tree.hbs", scrollable: [""] },
    panel: { template: "systems/paradigm-engine/templates/apps/skill-tree-panel.hbs", scrollable: [""] },
    foot: { template: "systems/paradigm-engine/templates/apps/skill-tree-foot.hbs" }
  };

  static #instances = new Map();

  #actor;

  #hooks = [];

  /* The world UUID of the selected node, shown in the panel. */
  #selected = "";

  /* World UUIDs whose branches are folded down to the node. */
  #folded = new Set();

  /* The state filter, empty for all, and the search text. */
  #filter = "";

  #query = "";

  #scale = 1;

  /* A lane or node to scroll to once the board has rendered. */
  #jump = "";

  #dragListeners = false;

  constructor({ actor = null, ...options } = {}) {
    super(options);
    this.#actor = actor;
  }

  static open(actor = null) {
    const key = actor?.uuid ?? "world";
    let app = SkillTree.#instances.get(key);
    if (!app) {
      app = new SkillTree({ actor, id: `skill-tree-${key.replaceAll(".", "-")}` });
      SkillTree.#instances.set(key, app);
    }
    app.render({ force: true });
    return app;
  }

  /* The world tree is the Storyteller's to build. */
  get canEdit() {
    return !this.#actor && game.user.isGM;
  }

  get title() {
    const title = game.i18n.localize("PARADIGMENGINE.Tree.Title");
    return this.#actor ? `${title} · ${this.#actor.name}` : title;
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const refresh = foundry.utils.debounce(() => this.render(), 50);
    for (const hook of ["createItem", "updateItem", "deleteItem"]) {
      this.#hooks.push([hook, Hooks.on(hook, refresh)]);
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const board = this.element.querySelector(".board");
    if (board && !board.dataset.wired) {
      board.dataset.wired = "1";
      board.addEventListener("scroll", () => this.#stickLabels());
      board.addEventListener("mouseover", event => this.#trace(event.target.closest(".node")));
      board.addEventListener("mouseleave", () => this.#trace(null));
    }
    const search = this.element.querySelector("input[name=query]");
    if (search && !search.dataset.wired) {
      search.dataset.wired = "1";
      search.addEventListener("input", () => {
        this.#query = search.value.trim();
        this.#jump = "first";
        this.render({ parts: ["bar", "board", "panel"] });
      });
    }
    this.#stickLabels();
    this.#land();
    if (!this.canEdit) return;
    new foundry.applications.ux.DragDrop.implementation({
      dragSelector: ".node",
      dropSelector: ".board",
      permissions: { dragstart: () => this.canEdit, drop: () => this.canEdit },
      callbacks: {
        dragstart: this.#onDragStart.bind(this),
        dragover: this.#onDragOver.bind(this),
        drop: this.#onDrop.bind(this)
      }
    }).bind(this.element);
    if (!this.#dragListeners) {
      this.#dragListeners = true;
      const clear = () => this.#clearDragover();
      this.element.addEventListener("dragend", clear);
      this.element.addEventListener("drop", clear);
      this.element.addEventListener("dragleave", event => {
        if (!this.element.contains(event.relatedTarget)) clear();
      });
    }
  }

  /* Outline the node the drag is over, or the whole board for a root drop. */
  #onDragOver(event) {
    const node = event.target.closest(".node");
    const board = this.element.querySelector(".board");
    for (const el of this.element.querySelectorAll(".node.dragover")) if (el !== node) el.classList.remove("dragover");
    node?.classList.add("dragover");
    board?.classList.toggle("dragover", !node);
  }

  #clearDragover() {
    for (const el of this.element.querySelectorAll(".dragover")) el.classList.remove("dragover");
  }

  _onClose(options) {
    super._onClose(options);
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
    const key = this.#actor?.uuid ?? "world";
    if (SkillTree.#instances.get(key) === this) SkillTree.#instances.delete(key);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const tree = this.#build();
    Object.assign(context, tree);
    context.canEdit = this.canEdit;
    context.pc = !!this.#actor;
    context.empty = tree.nodes.length === 0;
    context.ghost = { x: PAD_X, y: tree.height - PAD_Y - CARD_H + 12 };
    context.scale = this.#scale;
    context.scalePercent = Math.round(this.#scale * 100);
    context.query = this.#query;
    context.active = !!(this.#query || this.#filter);
    context.anyFolded = this.#folded.size > 0;
    context.filters = ["", "known", "available", "locked"].map(f => ({
      filter: f,
      on: f === this.#filter,
      label: game.i18n.localize(f ? `PARADIGMENGINE.Tree.${f.capitalize()}` : "PARADIGMENGINE.Tree.All")
    }));
    if (this.#actor) {
      const step = LADDER[this.#actor.system.rank] ?? LADDER[0];
      context.who = {
        name: this.#actor.name,
        portrait: portraitOf(this.#actor),
        frameStyle: frameStyle(frameOf(this.#actor)),
        initial: (this.#actor.name || "?").trim().charAt(0).toUpperCase() || "?",
        rank: step.rank,
        cssVar: step.cssVar
      };
    }
    context.detail = await this.#detail(tree);
    return context;
  }

  /* Every world Skill in the tree with its state for this PC, before any
     folding: the counts, the filters, and the Lines list read from here. */
  #info() {
    const world = game.items
      .filter(i => i.type === "skill" && i.system.inTree)
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    const byUuid = new Map(world.map(i => [i.uuid, i]));
    const owned = this.#actor ? this.#actor.items.filter(i => i.type === "skill") : [];
    const ownedBy = item => owned.find(o => o.system.source === item.uuid) ?? owned.find(o => o.name === item.name);
    const info = new Map();
    const kids = new Map();
    for (const item of world) {
      const parent = byUuid.has(item.system.prerequisite) ? item.system.prerequisite : "";
      const mine = this.#actor ? ownedBy(item) : null;
      info.set(item.uuid, { item, uuid: item.uuid, name: item.name, parent, mine, kids: [], state: "" });
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent).push(item.uuid);
    }
    for (const n of info.values()) n.kids = kids.get(n.uuid) ?? [];
    const rootOf = n => { let cur = n; while (cur.parent) cur = info.get(cur.parent); return cur; };
    for (const n of info.values()) {
      n.root = rootOf(n);
      if (this.#actor) {
        const parentKnown = !n.parent || info.get(n.parent).mine;
        n.state = n.mine ? "known" : parentKnown ? "available" : "locked";
      }
    }
    /* The PC's own Skills that are not in the tree stand as Lines of their own. */
    const placed = new Set([...info.values()].map(n => n.mine?.id).filter(Boolean));
    for (const item of owned) {
      if (placed.has(item.id)) continue;
      const n = { item, uuid: item.uuid, name: item.name, parent: "", mine: item, kids: [], state: "known", extra: true };
      n.root = n;
      info.set(item.uuid, n);
    }
    return info;
  }

  #matches(n) {
    const q = this.#query.toLowerCase();
    return (!q || n.name.toLowerCase().includes(q)) && (!this.#filter || n.state === this.#filter);
  }

  /* Nodes placed Line by Line: a node sits centred on the rows its visible
     descendants take, a folded node takes one row, and each root's Line
     is a lane behind its rows. */
  #build() {
    const info = this.#info();
    const active = !!(this.#query || this.#filter);
    const labels = {
      known: game.i18n.localize("PARADIGMENGINE.Tree.Known"),
      available: game.i18n.localize("PARADIGMENGINE.Tree.Available"),
      locked: game.i18n.localize("PARADIGMENGINE.Tree.Locked")
    };
    const count = n => n.kids.reduce((s, k) => s + 1 + count(info.get(k)), 0);
    const leaves = n => (n.kids.length && !this.#folded.has(n.uuid)) ? n.kids.reduce((s, k) => s + leaves(info.get(k)), 0) : 1;
    const nodes = [];
    const edges = [];
    const lanes = [];
    let row = 0;
    let firstMatch = "";
    const place = (n, depth, parent) => {
      const span = leaves(n);
      const rankIndex = n.mine ? n.mine.system.rank : resolveRank(n.item);
      const step = LADDER[rankIndex] ?? LADDER[0];
      const hit = this.#matches(n);
      if (hit && active && !firstMatch) firstMatch = n.uuid;
      const folded = this.#folded.has(n.uuid);
      const node = {
        uuid: n.uuid,
        id: n.mine?.id ?? "",
        parentUuid: n.parent,
        name: n.name,
        rank: step.rank,
        rankIndex,
        cssVar: step.cssVar,
        state: n.state,
        stateLabel: labels[n.state] ?? "",
        known: n.state === "known",
        locked: n.state === "locked",
        takeable: n.state === "available",
        technique: n.item.system.kind === "Technique",
        kindLabel: game.i18n.localize(`PARADIGMENGINE.Skill.${n.item.system.kind}`),
        costLabel: costLabel({ kind: n.item.system.kind, rank: rankIndex, mastery: n.mine?.system.mastery ?? 0 }),
        spec: !!n.parent,
        hasKids: n.kids.length > 0,
        folded,
        desc: count(n),
        selected: n.uuid === this.#selected,
        dim: active && !hit,
        x: PAD_X + depth * COL,
        y: PAD_Y + (row + (span - 1) / 2) * ROW
      };
      nodes.push(node);
      if (parent) {
        edges.push({
          to: n.uuid,
          cssVar: node.cssVar,
          cls: !this.#actor ? "open" : node.known ? "lit" : node.takeable ? "open" : "",
          x1: parent.x + CARD_W, y1: parent.y + CARD_H / 2,
          x2: node.x, y2: node.y + CARD_H / 2,
          cx: parent.x + CARD_W + (COL - CARD_W) / 2
        });
      }
      if (!n.kids.length || folded) { row++; return; }
      for (const k of n.kids) place(info.get(k), depth + 1, node);
    };
    const roots = [...info.values()].filter(n => !n.parent);
    for (const root of roots) {
      const start = row;
      place(root, 0, null);
      const all = [...info.values()].filter(n => n.root === root);
      const known = all.filter(n => n.state === "known").length;
      const available = all.filter(n => n.state === "available").length;
      const hits = all.filter(n => this.#matches(n)).length;
      const step = LADDER[root.mine ? root.mine.system.rank : resolveRank(root.item)] ?? LADDER[0];
      lanes.push({
        uuid: root.uuid,
        name: root.name,
        cssVar: step.cssVar,
        open: !this.#folded.has(root.uuid),
        quiet: active && !hits,
        off: active && !hits,
        y: Math.round(PAD_Y + start * ROW - (ROW - CARD_H) / 2 - 12),
        h: (row - start) * ROW + 8,
        all: all.length,
        known,
        available,
        hits,
        percent: all.length ? Math.round((known / all.length) * 100) : 0,
        count: this.#actor ? `${known}/${all.length}` : `${all.length}`
      });
      row += LANE_GAP / ROW;
    }
    const all = [...info.values()];
    const total = all.length;
    const known = all.filter(n => n.state === "known").length;
    const available = all.filter(n => n.state === "available").length;
    const depthMax = Math.max(0, ...nodes.map(n => (n.x - PAD_X) / COL));
    if (this.#jump === "first") this.#jump = firstMatch;
    return {
      nodes,
      edges,
      lanes,
      width: PAD_X * 2 + depthMax * COL + CARD_W,
      height: PAD_Y * 2 + Math.max(row, 1) * ROW + (this.canEdit ? CARD_H + 20 : 0),
      counts: { total, known, available, locked: total - known - available, lines: lanes.length },
      found: all.filter(n => this.#matches(n)).length,
      pips: all.map((n, i) => (i < known ? "on" : i < known + available ? "av" : ""))
    };
  }

  /* The chain above a world Skill, by UUID, for the cycle check. */
  static #ancestors(item) {
    const chain = new Set();
    let current = item;
    while (current?.system.prerequisite && !chain.has(current.system.prerequisite)) {
      chain.add(current.system.prerequisite);
      current = fromUuidSync(current.system.prerequisite, { strict: false });
    }
    return chain;
  }

  #onDragStart(event) {
    const uuid = event.currentTarget.dataset.uuid;
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
  }

  /* A world Skill dropped on a node becomes that node's specialization; on
     open ground it joins the tree as a root. A copy from an actor stands
     for the world Skill it was taken from. */
  async #onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data.type !== "Item") return;
    const dropped = await Item.implementation.fromDropData(data);
    if (dropped?.type !== "skill") return;
    const item = dropped.parent ? await fromUuid(dropped.system.source) : dropped;
    if (!(item instanceof Item) || item.parent || item.inCompendium) return;
    const target = event.target.closest(".node");
    const parentUuid = target?.dataset.uuid ?? "";
    if (parentUuid === item.uuid) return;
    if (parentUuid) {
      const parent = fromUuidSync(parentUuid, { strict: false });
      if (!parent || SkillTree.#ancestors(parent).has(item.uuid)) return;
    }
    await item.update({ "system.inTree": true, "system.prerequisite": parentUuid });
  }

  /* The selected node for the panel, read from the PC's own copy when it
     has one, with the Line it hangs from. */
  async #detail(tree) {
    const node = tree.nodes.find(n => n.uuid === this.#selected);
    if (!node) return null;
    const own = node.id ? this.#actor?.items.get(node.id) : null;
    const item = own ?? await fromUuid(node.uuid);
    if (!item) return null;
    const byUuid = new Map(tree.nodes.map(n => [n.uuid, n]));
    const chain = [];
    let cur = node;
    while (cur) {
      chain.unshift({ uuid: cur.uuid, name: cur.name, state: cur.state, me: cur.uuid === node.uuid });
      cur = cur.parentUuid ? byUuid.get(cur.parentUuid) : null;
    }
    return {
      uuid: node.uuid,
      id: node.id,
      name: item.name,
      rank: node.rank,
      cssVar: node.cssVar,
      spec: node.spec,
      state: node.state,
      stateLabel: node.stateLabel,
      takeable: node.takeable && this.#actor?.isOwner,
      kindLabel: game.i18n.localize(`PARADIGMENGINE.Skill.${item.system.kind}`),
      technique: item.system.kind === "Technique",
      costLabel: costLabel({ kind: item.system.kind, rank: node.rankIndex, mastery: own?.system.mastery ?? 0 }),
      chain,
      rankLabel: node.spec
        ? game.i18n.format("PARADIGMENGINE.Tree.RankFrom", { name: chain[0]?.name ?? "" })
        : game.i18n.localize("PARADIGMENGINE.Tree.Rank"),
      text: await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.text, { relativeTo: item, secrets: false })
    };
  }

  /* Lane labels stay at the top of the board while their Line scrolls by. */
  #stickLabels() {
    const board = this.element?.querySelector(".board");
    if (!board) return;
    const top = board.scrollTop / this.#scale;
    for (const lane of board.querySelectorAll(".lane")) {
      const y = parseFloat(lane.style.top);
      const h = parseFloat(lane.style.height);
      const label = lane.querySelector(".lt");
      const off = top - y + 6;
      label.style.top = `${off > 6 && off < h - 24 ? off : 6}px`;
    }
  }

  /* Light the chain under the pointer up to its root. */
  #trace(node) {
    const board = this.element?.querySelector(".board");
    if (!board) return;
    for (const g of board.querySelectorAll(".edges g.trace")) g.classList.remove("trace");
    let cur = node;
    while (cur) {
      if (!cur.classList.contains("known")) board.querySelector(`.edges g[data-to="${CSS.escape(cur.dataset.uuid)}"]`)?.classList.add("trace");
      cur = cur.dataset.parent ? board.querySelector(`.node[data-uuid="${CSS.escape(cur.dataset.parent)}"]`) : null;
    }
  }

  /* Scroll the board to the lane or node waiting for a jump and flash it. */
  #land() {
    const uuid = this.#jump;
    this.#jump = "";
    if (!uuid) return;
    const board = this.element.querySelector(".board");
    const lane = board?.querySelector(`.lane[data-uuid="${CSS.escape(uuid)}"]`);
    const node = board?.querySelector(`.node[data-uuid="${CSS.escape(uuid)}"]`);
    const el = lane ?? node;
    if (!el) return;
    board.scrollTop = (parseFloat(el.style.top) - (lane ? 0 : 40)) * this.#scale;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    this.#stickLabels();
  }

  #unfoldTo(uuid) {
    let cur = fromUuidSync(uuid, { strict: false });
    while (cur) {
      this.#folded.delete(cur.uuid);
      cur = cur.system?.prerequisite ? fromUuidSync(cur.system.prerequisite, { strict: false }) : null;
    }
  }

  #setScale(scale) {
    this.#scale = Math.clamp(Math.round(scale * 10) / 10, SCALE_MIN, SCALE_MAX);
    this.render({ parts: ["board", "foot"] });
  }

  static #onSelectNode(event, target) {
    const uuid = target.dataset.uuid;
    this.#selected = this.#selected === uuid ? "" : uuid;
    this.render({ parts: ["board", "panel"] });
  }

  static async #onOpenNode(event, target) {
    const own = target.dataset.itemId && this.#actor?.items.get(target.dataset.itemId);
    const item = own || await fromUuid(target.dataset.uuid);
    item?.sheet?.render(true);
  }

  static async #onTakeNode(event, target) {
    event.stopPropagation();
    if (!this.#actor?.isOwner) return;
    const item = await fromUuid(target.dataset.uuid);
    if (item?.type !== "skill") return;
    this.#selected = item.uuid;
    this.#jump = item.uuid;
    await takeSkill(this.#actor, item);
  }

  /* Out of the tree: the Skill keeps its data, its specializations become
     roots so nothing hangs from a node that is no longer there. */
  static async #onRemoveNode(event, target) {
    event.stopPropagation();
    if (!this.canEdit) return;
    const item = await fromUuid(target.dataset.uuid);
    if (item?.type !== "skill") return;
    const orphans = game.items
      .filter(i => i.type === "skill" && i.system.prerequisite === item.uuid)
      .map(i => ({ _id: i.id, "system.prerequisite": "" }));
    if (this.#selected === item.uuid) this.#selected = "";
    await item.update({ "system.inTree": false, "system.prerequisite": "" });
    if (orphans.length) await Item.implementation.updateDocuments(orphans);
  }

  static #onFoldNode(event, target) {
    event.stopPropagation();
    const uuid = target.dataset.uuid;
    if (this.#folded.has(uuid)) this.#folded.delete(uuid);
    else this.#folded.add(uuid);
    this.render({ parts: ["bar", "board", "panel"] });
  }

  static #onFoldAll() {
    if (this.#folded.size) this.#folded.clear();
    else for (const item of game.items) if (item.type === "skill" && item.system.inTree && !item.system.prerequisite) this.#folded.add(item.uuid);
    this.render({ parts: ["bar", "board", "panel"] });
  }

  static #onJumpLine(event, target) {
    const uuid = target.dataset.uuid;
    this.#unfoldTo(uuid);
    this.#jump = uuid;
    this.render({ parts: ["bar", "board", "panel"] });
  }

  static #onSetFilter(event, target) {
    this.#filter = target.dataset.filter ?? "";
    this.#jump = "first";
    this.render({ parts: ["bar", "board", "panel"] });
  }

  static #onZoomIn() {
    this.#setScale(this.#scale + SCALE_STEP);
  }

  static #onZoomOut() {
    this.#setScale(this.#scale - SCALE_STEP);
  }

  static #onZoomFit() {
    const board = this.element.querySelector(".board");
    const tree = board?.querySelector(".tree");
    if (!board || !tree) return;
    const w = parseFloat(tree.style.width);
    const h = parseFloat(tree.style.height);
    this.#setScale(Math.min((board.clientWidth - 8) / w, (board.clientHeight - 8) / h));
  }
}

/* The Skill Tree button in the Items directory header. */
export function registerSkillTree() {
  Hooks.on("renderItemDirectory", (app, element) => {
    const actions = element.querySelector(".header-actions");
    if (!actions || actions.querySelector(".skill-tree")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skill-tree";
    button.innerHTML = `<i class="fa-solid fa-sitemap" inert></i><span>${game.i18n.localize("PARADIGMENGINE.Tree.Title")}</span>`;
    button.addEventListener("click", () => SkillTree.open());
    actions.append(button);
  });
}
