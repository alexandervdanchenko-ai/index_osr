import React from "react";
import type { IndexingStatus, DoctorReport } from "../types";
import { formatComma, plural, pluralN } from "../lib/format";
import { Stethoscope, ArrowUpCircle } from "lucide-react";

/* Status line. Index health on the left, the few keys worth knowing on the
   right. Quiet by default: it only takes the ink while indexing. */

const HINTS: { keys: string; label: string }[] = [
  { keys: "↵", label: "Открыть" },
  { keys: "Space", label: "Просмотр" },
  { keys: "⇧↵", label: "В папке" },
  { keys: "⌘I", label: "Сведения" },
];

function statusText(s: IndexingStatus | null | undefined): { text: string; busy: boolean } {
  if (!s) return { text: "", busy: false };
  if (s.paused) return { text: "Индексация приостановлена", busy: false };
  if (s.is_indexing || (s.phase && s.phase !== "idle")) {
    if (s.phase === "rebuilding") return { text: s.current_status || "Перестройка индекса…", busy: true };
    const done = s.extract_done ?? s.files_indexed;
    const total = s.extract_total ?? s.total_files;
    return {
      text: total ? `Индексация: ${formatComma(done)} из ${formatComma(total)}` : `Индексация: ${pluralN(done, "файл", "файла", "файлов")}`,
      busy: true,
    };
  }
  return { text: pluralN(s.files_indexed, "файл", "файла", "файлов"), busy: false };
}

export const KeyHintStrip: React.FC<{
  status?: IndexingStatus | null;
  doctor?: DoctorReport | null;
  updateAvailable?: string | null;
  onDoctor?: () => void;
  onUpdate?: () => void;
}> = ({ status, doctor, updateAvailable, onDoctor, onUpdate }) => {
  const { text, busy } = statusText(status);
  const issues = doctor ? doctor.summary.warn + doctor.summary.fail : 0;
  return (
    <div className="relative z-10 flex h-7 shrink-0 items-center justify-between gap-4 px-3.5 text-[11px] text-subtle">
      <span className="flex items-center gap-2">
        {text && (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${busy ? "dot-pulse bg-ink" : "bg-success/70"}`} />
            <span className="t-meta">{text}</span>
          </>
        )}
        {doctor && (
          <button
            type="button"
            onClick={onDoctor}
            title={issues ? `${issues} ${plural(issues, "проблема", "проблемы", "проблем")} - открыть «Диагностику»` : "Индекс в порядке"}
            className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors hover:bg-surface-2 ${issues ? "text-warning" : "text-subtle"}`}
          >
            <Stethoscope className="h-3.5 w-3.5" />
            {issues > 0 && <span className="t-meta">{issues} {plural(issues, "проблема", "проблемы", "проблем")}</span>}
          </button>
        )}
        {updateAvailable && (
          <button
            type="button"
            onClick={onUpdate}
            title={`Доступно обновление: ${updateAvailable}`}
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-accent transition-colors hover:bg-surface-2"
          >
            <ArrowUpCircle className="h-3.5 w-3.5" />
            <span className="t-meta">Обновить</span>
          </button>
        )}
      </span>
      <span className="hidden items-center gap-4 sm:flex">
        {HINTS.map((h) => (
          <span key={h.label} className="flex items-center gap-1.5">
            <span className="kbd">{h.keys}</span>
            <span>{h.label}</span>
          </span>
        ))}
      </span>
    </div>
  );
};
