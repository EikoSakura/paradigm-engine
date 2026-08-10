const { HandlebarsApplicationMixin } = foundry.applications.api;

/* Shared sheet chrome: the View | Edit toggle in the window title bar.
   Mode is per-user display state, never stored on the document.
   The always-open prose editor only fires "change" on an explicit save,
   so leaving edit mode or closing the window submits the form itself. */
export default function ProjectAnimeSheet(Base) {
  return class extends HandlebarsApplicationMixin(Base) {
    static DEFAULT_OPTIONS = {
      classes: ["project-anime", "sheet"],
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
        for (const [mode, key] of [["view", "PROJECTANIME.Mode.View"], ["edit", "PROJECTANIME.Mode.Edit"]]) {
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

    /* A re-render mid-edit tears the prose editor down; carry the element,
       and with it the unsaved text, over into the new part. The carried text
       already sits in the element's committed value, so a later editor save
       would see no change — submit it now instead of leaving it pending. */
    _syncPartState(partId, newElement, priorElement, state) {
      super._syncPartState(partId, newElement, priorElement, state);
      for (const prior of priorElement.querySelectorAll("prose-mirror.active")) {
        const next = newElement.querySelector(`prose-mirror[name="${prior.name}"]`);
        if (!next) continue;
        const dirty = next.value !== prior.value;
        next.replaceWith(prior);
        if (dirty) queueMicrotask(() => prior.dispatchEvent(new Event("change", { bubbles: true })));
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
