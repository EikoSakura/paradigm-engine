const { HandlebarsApplicationMixin } = foundry.applications.api;

/* Shared sheet chrome: the View | Edit toggle in the window title bar.
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
        setMode: this.#onSetMode
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
        const toggle = document.createElement("div");
        toggle.className = "modetoggle";
        for (const [mode, key] of [["view", "PARADIGMENGINE.Mode.View"], ["edit", "PARADIGMENGINE.Mode.Edit"]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.action = "setMode";
          button.dataset.mode = mode;
          button.textContent = game.i18n.localize(key);
          toggle.append(button);
        }
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

    /* A re-render mid-edit would tear the open prose editor down and
       rebuild it from stored data; carry the live element into the
       incoming part BEFORE insertion instead. The swapped-out fresh
       element never joins the document, so it never activates detached —
       an editor activating outside the document throws from its menu
       plugin and comes up dead. */
    _preSyncPartState(partId, newElement, priorElement, state) {
      super._preSyncPartState(partId, newElement, priorElement, state);
      for (const prior of priorElement.querySelectorAll("prose-mirror")) {
        const next = newElement.querySelector(`prose-mirror[name="${prior.name}"]`);
        if (next) next.replaceWith(prior);
      }
    }

    #syncModeToggle() {
      for (const button of this.element.querySelectorAll(".modetoggle button")) {
        button.classList.toggle("on", button.dataset.mode === this.#mode);
      }
    }

    static async #onSetMode(event, target) {
      const mode = target.dataset.mode === "edit" ? "edit" : "view";
      if (mode === this.#mode) return;
      const leavingEdit = this.isEditMode;
      this.#mode = mode;
      this.#syncModeToggle();
      if (leavingEdit && this.form) await this.submit();
      this.render();
    }
  };
}
