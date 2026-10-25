const { HandlebarsApplicationMixin } = foundry.applications.api;

/* Shared sheet chrome: the Edit switch in the window title bar.
   Mode is per-user display state, never stored on the document.
   The always-open prose editor only fires "change" on an explicit save,
   so leaving edit mode or closing the window submits the form itself. */
export default function ParadigmEngineSheet(Base) {
  return class extends HandlebarsApplicationMixin(Base) {
    static DEFAULT_OPTIONS = {
      classes: ["paradigm-engine", "sheet"],
      window: { resizable: true },
      form: { submitOnChange: true, closeOnSubmit: false },
      actions: {
        setMode: this.#onSetMode,
        editImage: this.#onEditImage
      }
    };

    static USES_MODE_TOGGLE = true;

    #mode = "view";

    get isEditMode() {
      return this.#mode === "edit" && this.isEditable;
    }

    async _renderFrame(options) {
      const frame = await super._renderFrame(options);
      if (this.isEditable && this.constructor.USES_MODE_TOGGLE) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "modeswitch";
        toggle.dataset.action = "setMode";
        toggle.setAttribute("role", "switch");
        const knob = document.createElement("span");
        knob.className = "knob";
        const label = document.createElement("span");
        label.className = "lbl";
        label.textContent = game.i18n.localize("PARADIGMENGINE.Mode.Edit");
        toggle.append(knob, label);
        this.window.title.after(toggle);
      }
      return frame;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this.#syncModeToggle();
    }

    async _preClose(options) {
      await super._preClose(options);
      if (options.submit !== false && this.isEditMode && this.form) await this.submit();
    }

    /* A re-render mid-edit would tear an open prose editor down and
       rebuild it from stored data; carry the live element into the
       incoming part BEFORE insertion instead; a closed toggled editor is
       left to the fresh element, which carries the newly enriched text.
       The swapped-out fresh element never joins the document, so it never activates detached —
       an editor activating outside the document throws from its menu
       plugin and comes up dead. */
    _preSyncPartState(partId, newElement, priorElement, state) {
      super._preSyncPartState(partId, newElement, priorElement, state);
      for (const prior of priorElement.querySelectorAll("prose-mirror")) {
        const next = newElement.querySelector(`prose-mirror[name="${prior.name}"]`);
        if (next && prior.open) next.replaceWith(prior);
      }
    }

    #syncModeToggle() {
      for (const toggle of this.element.querySelectorAll(".modeswitch")) {
        const on = this.#mode === "edit";
        toggle.classList.toggle("on", on);
        toggle.setAttribute("aria-checked", String(on));
      }
    }

    /* The portrait picker, from the art or its placeholder alike: core's
       editImage takes only an img element, and the placeholder is a
       button. The pick writes img straight to the document. */
    static #onEditImage() {
      if (!this.isEditable) return;
      const current = this.document._source.img;
      const defaultImage = this.document.constructor.getDefaultArtwork?.(this.document._source)?.img;
      new foundry.applications.apps.FilePicker.implementation({
        current,
        type: "image",
        redirectToRoot: defaultImage ? [defaultImage] : [],
        callback: path => this.document.update({ img: path }),
        position: { top: this.position.top + 40, left: this.position.left + 10 }
      }).browse();
    }

    /* Put the sheet in a mode from outside, as Modify Skill opens a Skill
       File in Edit. */
    setMode(mode) {
      if (mode !== "edit" && mode !== "view") return;
      if (this.#mode === mode) return;
      this.#mode = mode;
      this.#syncModeToggle();
      this.render();
    }

    static async #onSetMode() {
      const mode = this.#mode === "edit" ? "view" : "edit";
      const leavingEdit = this.isEditMode;
      this.#mode = mode;
      this.#syncModeToggle();
      if (leavingEdit && this.form) await this.submit();
      this.render();
    }
  };
}
