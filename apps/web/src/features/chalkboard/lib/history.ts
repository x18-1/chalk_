export type ChalkboardHistoryItem = {
  id: string;
  title: string;
  sceneId?: string;
  lastOpenedAt: number;
};

const STORAGE_KEY = "chalkboard:history";

// The imported Fourier package has two public aliases during migration. Keep
// one classroom record so the global rail cannot show duplicate courses.
export function canonicalChalkboardId(id: string): string {
  return id === "fourier-transform-intro" ? "681PbzeDfm" : id;
}

function isHistoryItem(value: unknown): value is ChalkboardHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.title === "string" && typeof item.lastOpenedAt === "number";
}

export function loadChalkboardHistory(): ChalkboardHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const byId = new Map<string, ChalkboardHistoryItem>();
    for (const raw of parsed) {
      if (!isHistoryItem(raw)) continue;
      const id = canonicalChalkboardId(raw.id);
      const current = byId.get(id);
      const item = { ...raw, id };
      if (!current || item.lastOpenedAt > current.lastOpenedAt) byId.set(id, item);
    }
    return [...byId.values()].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
  } catch {
    return [];
  }
}

export function saveChalkboardHistory(items: ChalkboardHistoryItem[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 24)));
}

export function upsertChalkboardHistory(item: ChalkboardHistoryItem): ChalkboardHistoryItem[] {
  const normalized = { ...item, id: canonicalChalkboardId(item.id) };
  const next = [normalized, ...loadChalkboardHistory().filter((current) => current.id !== normalized.id)];
  saveChalkboardHistory(next);
  return next;
}
