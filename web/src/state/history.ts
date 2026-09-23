// Undo/redo stack of parameter changes. Consecutive edits to the same parameter
// within the merge window collapse into one entry (a fader or EQ-handle drag is a
// single undo step); seal() ends a gesture explicitly.

export interface Change<V> {
  key: string;
  before: V;
  after: V;
}

export interface HistoryEntry<V> {
  label: string;
  changes: Change<V>[];
  mergeKey?: string;
  lastAt: number;
}

export interface HistoryOptions {
  limit?: number;
  mergeWindowMs?: number;
  now?: () => number;
}

const DEFAULT_LIMIT = 200;
const DEFAULT_MERGE_WINDOW_MS = 1000;

export class History<V> {
  private readonly undoStack: HistoryEntry<V>[] = [];
  private readonly redoStack: HistoryEntry<V>[] = [];
  private readonly limit: number;
  private readonly mergeWindowMs: number;
  private readonly now: () => number;
  private sealed = true;

  constructor(options: HistoryOptions = {}) {
    this.limit = options.limit ?? DEFAULT_LIMIT;
    this.mergeWindowMs = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;
    this.now = options.now ?? (() => Date.now());
  }

  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  /** Record changes. With a mergeKey, extends the previous entry if it is the same ongoing edit. */
  record(label: string, changes: Change<V>[], mergeKey?: string): void {
    if (changes.length === 0) return;
    const at = this.now();
    const top = this.undoStack[this.undoStack.length - 1];
    this.redoStack.length = 0;
    if (top && !this.sealed && mergeKey !== undefined && top.mergeKey === mergeKey && at - top.lastAt <= this.mergeWindowMs) {
      for (const change of changes) {
        const existing = top.changes.find((c) => c.key === change.key);
        if (existing) existing.after = change.after;
        else top.changes.push(change);
      }
      top.lastAt = at;
      return;
    }
    this.undoStack.push({ label, changes, mergeKey, lastAt: at });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.sealed = mergeKey === undefined;
  }

  /** End the current gesture: the next edit starts a new entry even within the merge window. */
  seal(): void {
    this.sealed = true;
  }

  undo(): HistoryEntry<V> | undefined {
    const entry = this.undoStack.pop();
    if (entry) this.redoStack.push(entry);
    this.sealed = true;
    return entry;
  }

  redo(): HistoryEntry<V> | undefined {
    const entry = this.redoStack.pop();
    if (entry) this.undoStack.push(entry);
    this.sealed = true;
    return entry;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.sealed = true;
  }
}
