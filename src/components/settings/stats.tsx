import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy } from "lucide-react";
import { useStats } from "../../hooks/useStats";
import { Sparkline } from "../Sparkline";
import { Card, Field, Badge } from "./kit";
import {
  formatBytes,
  formatComma,
  formatDuration,
  latencyToken,
} from "../../lib/format";

const PHASE_RU: Record<string, string> = {
  idle: "простой",
  verifying: "проверка",
  walking: "обход папок",
  extracting: "извлечение текста",
  embedding: "смысловой анализ",
  committing: "запись",
};

/* Stats for Nerds — the centerpiece. Polls get_stats every 2 s while this
   section is mounted (the ONLY place that does). Falls back to zeroed
   placeholders when the backend command is missing. */

function StatNumber({
  value,
  suffix,
  tone,
  caption,
}: {
  value: string;
  suffix?: string;
  tone?: string;
  caption: string;
}) {
  return (
    <div className="min-w-0">
      <p className={`truncate font-mono text-[20px] leading-6 ${tone ?? "text-fg"}`}>
        {value}
        {suffix && <span className="ml-1 text-[11px] text-subtle">{suffix}</span>}
      </p>
      <p className="text-[11px] text-subtle">{caption}</p>
    </div>
  );
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-success" : "bg-subtle"}`} />
      {label}
    </div>
  );
}

export function StatsForNerds() {
  const { stats, live } = useStats(2000);
  const [copied, setCopied] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const q = stats.queries;
  const i = stats.index;
  const ing = stats.ingestion;
  const rt = stats.runtime;
  // A rebuild is busy from click to crawl end; the backend also rejects
  // rebuilds while any crawl is running, so live stats gate the button too.
  const busy = rebuilding || ing.is_indexing;

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ queries: q, index: i, ingestion: ing, runtime: rt }, null, 2),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] text-subtle">
          {live ? (
            <>
              данные <code className="font-mono text-accent">get_stats</code> каждые 2 с
            </>
          ) : (
            "ожидание get_stats, показаны нулевые значения"
          )}
        </p>
        <button
          type="button"
          onClick={copyDiagnostics}
          className="btn btn-secondary h-8 px-3 text-[12px]"
        >
          {copied ? <Check className="h-3 w-3 text-accent" /> : <Copy className="h-3 w-3" />}
          Скопировать диагностику
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (
              !window.confirm(
                "Перестроить индекс с нуля? Программа удалит полнотекстовый индекс, смысловые фрагменты и миниатюры, а затем заново просканирует папки.",
              )
            )
              return;
            setRebuilding(true);
            try {
              // Resolves as soon as the in-process rebuild starts; progress
              // shows up in live stats and the bar below.
              await invoke("rebuild_index");
            } catch (err) {
              console.error("Rebuild failed:", err);
              alert("Не удалось перестроить индекс: " + err);
            } finally {
              setRebuilding(false);
            }
          }}
          className="btn btn-secondary h-8 px-3 text-[12px]"
        >
          {rebuilding ? "Перестройка…" : ing.is_indexing ? "Индексация…" : "Перестроить индекс"}
        </button>
      </div>

      {/* Latency */}
      <Card title="Время ответа на запросы">
        <div className="flex items-center gap-5 px-4 py-3.5">
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <StatNumber value={q.p50_ms.toFixed(1)} suffix="мс" caption="p50" />
            <StatNumber value={q.p95_ms.toFixed(1)} suffix="мс" caption="p95" />
            <StatNumber
              value={q.p99_ms.toFixed(1)}
              suffix="мс"
              tone={latencyToken(q.p99_ms)}
              caption="p99"
            />
            <StatNumber
              value={q.last_ms.toFixed(1)}
              suffix="мс"
              tone={latencyToken(q.last_ms)}
              caption="последний"
            />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Sparkline values={q.history} width={110} height={36} />
            <span className="font-mono text-[11px] text-subtle">
              {formatComma(q.total)} запр.
            </span>
          </div>
        </div>
      </Card>

      {/* Index composition */}
      <Card title="Состав индекса">
        <div className="grid grid-cols-2 gap-x-6 px-4 py-3 sm:grid-cols-4">
          <StatNumber value={formatComma(i.files)} caption="файлы" />
          <StatNumber value={formatComma(i.dirs)} caption="папки" />
          <StatNumber value={formatComma(i.content_docs)} caption="с текстом" />
          <StatNumber value={formatComma(i.semantic_units)} caption="смысловые фрагменты" />
        </div>
        <div className="border-t border-line">
          <Field label="Tantivy (полнотекстовый)" description="Инвертированный индекс BM25 и быстрые поля.">
            <span className="font-mono text-[11px] text-fg">{formatBytes(i.tantivy_bytes)}</span>
          </Field>
          <Field label="Векторы (i8)" description="Статический уровень эмбеддингов.">
            <span className="font-mono text-[11px] text-fg">{formatBytes(i.vector_bytes)}</span>
          </Field>
          <Field label="Метаданные (SQLite WAL)" description="Основное хранилище, снимок в памяти.">
            <span className="font-mono text-[11px] text-fg">{formatBytes(i.metadata_db_bytes)}</span>
          </Field>
          <Field label="Последняя сверка" description="Насколько индекс актуален сейчас.">
            <span className="font-mono text-[11px] text-fg">
              {i.last_reconcile_secs_ago == null ? "—" : `${Math.round(i.last_reconcile_secs_ago)} с назад`}
            </span>
          </Field>
        </div>
      </Card>

      {/* Ingestion */}
      <Card title="Индексация">
        <div className="px-4 py-3.5">
          <div className="flex items-center justify-between gap-4 pb-2">
            <div className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  ing.is_indexing ? "bg-accent dot-pulse" : "bg-subtle"
                }`}
              />
              <span className="font-mono text-[12px] text-fg">
                {PHASE_RU[ing.phase === "walking" && (ing.files_indexed ?? 0) === 0 ? "verifying" : ing.phase] ?? ing.phase}
              </span>
              {!live && <Badge>заглушка</Badge>}
            </div>
            <span className="font-mono text-[11px] text-subtle">
              {ing.files_per_sec > 0 ? `${formatComma(Math.round(ing.files_per_sec))} ф/с` : "простой"}
              {ing.eta_secs != null && ing.eta_secs > 0 && ` · осталось ${formatDuration(ing.eta_secs)}`}
            </span>
          </div>
          {/* Indeterminate when no total is known; depth signals backlog. */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent-soft">
            <div
              className={`h-full rounded-full bg-accent ${ing.is_indexing ? "progress-bar" : ""}`}
              style={!ing.is_indexing ? { width: "0%" } : undefined}
            />
          </div>
          <div className="flex gap-6 pt-3">
            <StatNumber value={formatComma(ing.files_indexed)} caption="файлов в индексе" />
            <StatNumber value={formatComma(ing.content_indexed)} caption="текст извлечён" />
            <StatNumber value={formatComma(ing.units_indexed)} caption="фрагментов обработано" />
            <StatNumber value={formatComma(ing.embed_queue_depth)} caption="в очереди" />
          </div>
        </div>
      </Card>

      {/* Runtime */}
      <Card title="Работа программы">
        <div className="grid grid-cols-2 gap-x-6 px-4 py-3 sm:grid-cols-3">
          <StatNumber value={formatDuration(rt.uptime_secs)} caption="время работы" />
          <StatNumber value={formatBytes(rt.rss_bytes)} caption="память (RSS)" />
          <StatNumber
            value={rt.model_id || "—"}
            caption="смысловая модель"
          />
        </div>
        <div className="flex gap-5 border-t border-line px-4 py-2.5">
          <Dot ok={rt.watcher_ok} label="отслеживание файлов" />
          <Dot ok={rt.semantic_ready} label="смысловой поиск готов" />
          <Dot ok={live} label="живые данные" />
        </div>
      </Card>
    </div>
  );
}
