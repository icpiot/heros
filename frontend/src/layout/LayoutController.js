function cloneLayout(layout) {
  return layout.map((item) => ({ ...item }));
}

export class LayoutController {
  constructor(repository) {
    this.repository = repository;
    this.savedLayout = repository.load();
    this.draftLayout = cloneLayout(this.savedLayout);
  }

  get layout() {
    return cloneLayout(this.draftLayout);
  }

  beginEdit() {
    this.draftLayout = cloneLayout(this.savedLayout);
    return this.layout;
  }

  updateDraft(layout) {
    this.draftLayout = cloneLayout(layout);
    return this.layout;
  }

  hideItem(id) {
    this.draftLayout = this.draftLayout.map((item) => (
      item.id === id ? { ...item, hidden: true } : item
    ));
    return this.layout;
  }

  save() {
    this.savedLayout = this.repository.save(this.draftLayout);
    this.draftLayout = cloneLayout(this.savedLayout);
    return this.layout;
  }

  cancel() {
    this.draftLayout = cloneLayout(this.savedLayout);
    return this.layout;
  }

  resetToDefaultDraft() {
    this.draftLayout = this.repository.getDefaultLayout();
    return this.layout;
  }
}
