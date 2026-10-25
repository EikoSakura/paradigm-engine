import { LADDER, costLabel } from "../config.mjs";
import { resolveRank, takeSkill } from "../skills.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const COL = 220;
const ROW = 82;
const CARD_W = 180;
const CARD_H = 50;
const PAD_X = 30;
const PAD_Y = 30;

/* The Skill Tree: the world Skills the Storyteller has placed in it, laid
   out by their prerequisite chains with roots on the left. The Storyteller
   builds it here: a Skill dragged in from the Items sidebar joins as a
   root, dropped onto a node it becomes that node's specialization, and a
   node's mark takes it out again. Opened for a PC it marks each node
   Known, Available when its foundation is Known, or Locked, and a click
   on an Available node copies that Skill onto the PC. */
export default class SkillTree extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["paradigm-engine", "skill-tree"],
    window: { resizable: true },
    position: { width: 720, height: 520 },
    actions: {
      selectNode: this.#onSelectNode,
      openNode: this.#onOpenNode,
      takeNode: this.#onTakeNode,
      removeNode: this.#onRemoveNode
    }
  };

  static PARTS = {
    tree: { template: "systems/paradigm-engine/templates/apps/skill-tree.hbs", scrollable: [".treewrap"] },
    detail: { template: "systems/paradigm-engine/templates/apps/skill-tree-detail.hbs" }
  };

  static #instances = new Map();

  #actor;

  #hooks = [];

  /* The world UUID of the selected node, shown in the strip below the tree. */
  #selected = "";

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
    if (!this.canEdit) return;
    new foundry.applications.ux.DragDrop.implementation({
      dragSelector: ".node",
      dropSelector: ".tree",
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

  #dragListeners = false;

  /* Outline the node the drag is over, or the whole tree for a root drop. */
  #onDragOver(event) {
    const node = event.target.closest(".node");
    const tree = this.element.querySelector(".tree");
    for (const el of this.element.querySelectorAll(".node.dragover")) if (el !== node) el.classList.remove("dragover");
    node?.classList.add("dragover");
    tree?.classList.toggle("dragover", !node);
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
    Object.assign(context, this.#layout());
    context.canEdit = this.canEdit;
    context.empty = context.nodes.length === 0;
    context.ghost = { x: PAD_X, y: PAD_Y };
    context.detail = await this.#detail(context.nodes);
    return context;
  }

  /* Nodes by depth-first walk from each root, so children follow their
     parent down the rows; edges from a parent's right edge to its child. */
  #layout() {
    const world = game.items
      .filter(i => i.type === "skill" && i.system.inTree)
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    const byUuid = new Map(world.map(i => [i.uuid, i]));
    const children = new Map();
    for (const item of world) {
      const parent = byUuid.has(item.system.prerequisite) ? item.system.prerequisite : "";
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(item);
    }
    const owned = this.#actor ? this.#actor.items.filter(i => i.type === "skill") : [];
    const ownedBy = item => owned.find(o => o.system.source === item.uuid) ?? owned.find(o => o.name === item.name);
    const labels = {
      known: game.i18n.localize("PARADIGMENGINE.Tree.Known"),
      available: game.i18n.localize("PARADIGMENGINE.Tree.Available"),
      locked: game.i18n.localize("PARADIGMENGINE.Tree.Locked")
    };
    const nodes = [];
    const edges = [];
    const seen = new Set();
    let row = 0;
    const node = (item, depth, state, mine) => {
      const step = LADDER[mine ? mine.system.rank : resolveRank(item)];
      return {
        uuid: item.uuid,
        id: mine?.id ?? "",
        name: item.name,
        rank: step.rank,
        cssVar: step.cssVar,
        state,
        stateLabel: labels[state] ?? "",
        takeable: state === "available",
        selected: item.uuid === this.#selected,
        depth,
        x: PAD_X + depth * COL,
        y: PAD_Y + row * ROW
      };
    };
    const visit = (item, depth, parent) => {
      if (seen.has(item.uuid)) return;
      seen.add(item.uuid);
      const mine = this.#actor ? ownedBy(item) : null;
      const state = !this.#actor ? "" : mine ? "known" : (depth === 0 || parent?.state === "known") ? "available" : "locked";
      const n = node(item, depth, state, mine);
      nodes.push(n);
      row++;
      if (parent) {
        edges.push({
          x1: parent.x + CARD_W, y1: parent.y + CARD_H / 2,
          x2: n.x, y2: n.y + CARD_H / 2,
          cx: parent.x + CARD_W + (COL - CARD_W) / 2,
          solid: !this.#actor || parent.state === "known"
        });
      }
      for (const child of children.get(item.uuid) ?? []) visit(child, depth + 1, n);
    };
    for (const root of children.get("") ?? []) visit(root, 0, null);
    if (this.#actor) {
      const placed = new Set(nodes.map(n => n.id).filter(Boolean));
      for (const item of owned) {
        if (placed.has(item.id)) continue;
        nodes.push(node(item, 0, "known", item));
        row++;
      }
    }
    const depthMax = Math.max(0, ...nodes.map(n => n.depth));
    return {
      nodes,
      edges,
      width: PAD_X * 2 + depthMax * COL + CARD_W,
      height: PAD_Y * 2 + Math.max(row, 1) * ROW - (ROW - CARD_H)
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

  /* The selected node, read from the PC's own copy when it has one. */
  async #detail(nodes) {
    const node = nodes.find(n => n.uuid === this.#selected);
    if (!node) return null;
    const own = node.id ? this.#actor?.items.get(node.id) : null;
    const item = own ?? await fromUuid(node.uuid);
    if (!item) return null;
    return {
      uuid: node.uuid,
      id: node.id,
      name: item.name,
      rank: node.rank,
      cssVar: node.cssVar,
      stateLabel: node.stateLabel,
      kindLabel: game.i18n.localize(`PARADIGMENGINE.Skill.${item.system.kind}`),
      technique: item.system.kind === "Technique",
      costLabel: costLabel({ kind: item.system.kind, rank: LADDER.findIndex(s => s.rank === node.rank) }),
      text: await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.text, { relativeTo: item, secrets: false })
    };
  }

  static #onSelectNode(event, target) {
    const uuid = target.dataset.uuid;
    this.#selected = this.#selected === uuid ? "" : uuid;
    this.render();
  }

  static async #onOpenNode(event, target) {
    const own = target.dataset.itemId && this.#actor?.items.get(target.dataset.itemId);
    const item = own || await fromUuid(target.dataset.uuid);
    item?.sheet?.render(true);
  }

  static async #onTakeNode(event, target) {
    if (!this.#actor?.isOwner) return;
    const item = await fromUuid(target.dataset.uuid);
    if (item?.type === "skill") await takeSkill(this.#actor, item);
  }

  /* Out of the tree: the Skill keeps its data, its specializations become
     roots so nothing hangs from a node that is no longer there. */
  static async #onRemoveNode(event, target) {
    event.stopPropagation();
    if (!this.canEdit) return;
    const item = await fromUuid(target.closest(".node").dataset.uuid);
    if (item?.type !== "skill") return;
    const orphans = game.items
      .filter(i => i.type === "skill" && i.system.prerequisite === item.uuid)
      .map(i => ({ _id: i.id, "system.prerequisite": "" }));
    await item.update({ "system.inTree": false, "system.prerequisite": "" });
    if (orphans.length) await Item.implementation.updateDocuments(orphans);
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
