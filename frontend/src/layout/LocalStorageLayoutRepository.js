function cloneLayout(layout) {
  return layout.map((item) => ({ ...item }));
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export class LocalStorageLayoutRepository {
  constructor({ storageKey, version, defaultLayout, storage = window.localStorage }) {
    this.storageKey = storageKey;
    this.version = version;
    this.defaultLayout = cloneLayout(defaultLayout);
    this.storage = storage;
  }

  load() {
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return this.getDefaultLayout();

      const parsed = JSON.parse(raw);
      if (parsed?.version !== this.version || !Array.isArray(parsed.items)) {
        return this.getDefaultLayout();
      }

      return this._mergeWithDefaults(parsed.items);
    } catch (error) {
      console.warn("HEROS layout restore failed; using defaults.", error);
      return this.getDefaultLayout();
    }
  }

  save(layout) {
    const items = this._mergeWithDefaults(layout);
    this.storage.setItem(this.storageKey, JSON.stringify({
      version: this.version,
      savedAt: new Date().toISOString(),
      items,
    }));
    return cloneLayout(items);
  }

  getDefaultLayout() {
    return cloneLayout(this.defaultLayout);
  }

  _mergeWithDefaults(layout) {
    const byId = new Map();

    for (const item of Array.isArray(layout) ? layout : []) {
      if (!item || typeof item.id !== "string") continue;
      byId.set(item.id, item);
    }

    return this.defaultLayout.map((defaultItem) => {
      const saved = byId.get(defaultItem.id);
      if (!saved) return { ...defaultItem };

      if (saved.hidden === true) {
        return { ...defaultItem, hidden: true };
      }

      const next = {
        ...defaultItem,
        x: Number(saved.x),
        y: Number(saved.y),
        w: Number(saved.w),
        h: Number(saved.h),
      };

      if (![next.x, next.y, next.w, next.h].every(isFiniteNumber)) {
        return { ...defaultItem };
      }

      next.x = Math.max(0, Math.round(next.x));
      next.y = Math.max(0, Math.round(next.y));
      next.w = Math.min(12, Math.max(defaultItem.minW ?? 1, Math.round(next.w)));
      next.h = Math.max(defaultItem.minH ?? 1, Math.round(next.h));

      return next;
    });
  }
}
