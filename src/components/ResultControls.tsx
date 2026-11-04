import { Bookmark, ChevronDown, LayoutGrid, Rows3 } from "lucide-react";

/* Right side of the toolbar: sort, layout, save. Same capsule material as
   the category segments. */

export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "best", label: "По релевантности" },
  { value: "newest", label: "Сначала новые" },
  { value: "oldest", label: "Сначала старые" },
  { value: "largest", label: "Сначала крупные" },
  { value: "name", label: "По имени" },
];

export function ResultControls({
  sort,
  onSort,
  view,
  onView,
  onSave,
  canSave,
}: {
  sort: string;
  onSort: (value: string) => void;
  view: "grid" | "list";
  onView: (v: "grid" | "list") => void;
  onSave: () => void;
  canSave: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <label className="control relative flex h-[38px] items-center rounded-control" title="Сортировка результатов">
        <span className="sr-only">Сортировка</span>
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value)}
          aria-label="Сортировка результатов"
          className="h-full cursor-pointer appearance-none rounded-control bg-transparent pl-3.5 pr-8 text-[13px] font-medium text-fg outline-none"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-subtle" strokeWidth={2} />
      </label>

      <div role="radiogroup" aria-label="Вид" className="control flex items-center gap-0.5 rounded-control p-1">
        <button type="button" role="radio" aria-checked={view === "grid"} aria-label="Плитка" title="Плитка" onClick={() => onView("grid")} className="seg !px-2.5">
          <LayoutGrid className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button type="button" role="radio" aria-checked={view === "list"} aria-label="Список" title="Список" onClick={() => onView("list")} className="seg !px-2.5">
          <Rows3 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {canSave && (
        <button type="button" title="Сохранить этот поиск" aria-label="Сохранить этот поиск" onClick={onSave} className="control flex h-[38px] w-[38px] items-center justify-center rounded-control text-muted transition-colors hover:text-fg">
          <Bookmark className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
