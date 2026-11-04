/* Formatting helpers shared across components. Monospace-facing so that
   numbers tabulate cleanly in the status bar, stats and result rows. */

/** Выбирает форму слова по числу: plural(5, "файл", "файла", "файлов"). */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n));
  const m10 = a % 10;
  const m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Число со словом в правильном падеже: pluralN(5, "файл", "файла", "файлов") -> "5 файлов". */
export function pluralN(n: number, one: string, few: string, many: string): string {
  return `${formatComma(n)} ${plural(n, one, few, many)}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 Б";
  const k = 1024;
  const sizes = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const v = bytes / Math.pow(k, i);
  const num = v >= 100 ? Math.round(v) : parseFloat(v.toFixed(1));
  return `${String(num).replace(".", ",")} ${sizes[i]}`;
}

export function formatComma(n: number): string {
  return n.toLocaleString("ru-RU");
}

export function formatRelativeTime(secs: number): string {
  if (!secs) return "";
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - secs);
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 86400 * 30) {
    const d = Math.floor(diff / 86400);
    return `${d} ${plural(d, "день", "дня", "дней")} назад`;
  }
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))} мес назад`;
  return new Date(secs * 1000).toLocaleDateString("ru-RU");
}

export function formatDuration(secs: number): string {
  if (!secs || secs <= 0) return "0 с";
  if (secs < 60) return `${Math.round(secs)} с`;
  const m = Math.floor(secs / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h} ч ${m % 60} мин`;
  return `${m} мин ${Math.floor(secs % 60)} с`;
}

/** Extracts the free-text search terms, dropping `filter:` tokens. */
export function queryTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 1 && !t.includes(":"));
}

/** Splits text into plain / match segments for subtle inline highlighting. */
export function highlightSegments(
  text: string,
  terms: string[],
): { text: string; match: boolean }[] {
  if (terms.length === 0) return [{ text, match: false }];
  const lower = text.toLowerCase();
  type Seg = { start: number; end: number };
  const ranges: Seg[] = [];
  for (const term of terms) {
    let idx = lower.indexOf(term);
    while (idx !== -1 && term.length > 0) {
      ranges.push({ start: idx, end: idx + term.length });
      idx = lower.indexOf(term, idx + term.length);
    }
  }
  if (ranges.length === 0) return [{ text, match: false }];
  ranges.sort((a, b) => a.start - b.start);
  // Merge overlaps.
  const merged: Seg[] = [ranges[0]];
  for (const r of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push(r);
  }
  const out: { text: string; match: boolean }[] = [];
  let pos = 0;
  for (const r of merged) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start), match: false });
    out.push({ text: text.slice(r.start, r.end), match: true });
    pos = r.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), match: false });
  return out;
}

/** Formats a millisecond latency with a tailwind color class by bucket. */
export function latencyToken(ms: number): string {
  if (ms < 10) return "text-success";
  if (ms < 40) return "text-warning";
  return "text-danger";
}

export function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() || p;
}

/** Parent folder for display: home collapsed to ~, long paths keep the tail. */
export function displayParent(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  parts.pop();
  let p = parts.join("/");
  p = p.replace(/^\/(Users|home)\/[^/]+/, "~").replace(/^[A-Z]:\/Users\/[^/]+/i, "~");
  const segs = p.split("/");
  return segs.length > 4 ? `${segs[0]}/…/${segs.slice(-2).join("/")}` : p || "/";
}
