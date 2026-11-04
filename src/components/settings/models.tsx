import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy } from "lucide-react";
import { ModelsStatus } from "../../types";
import { formatBytes } from "../../lib/format";
import { Card, Field } from "./kit";

/* Model files — real on-disk artifacts behind the optional neural tier.
   Loads `get_models_status` on mount and polls every 600 ms only while a
   download is running. Every command is defensive: the backend may not
   ship it yet, so the card degrades to a calm unavailable state. */

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
}

export function ModelFilesCard() {
  const [status, setStatus] = useState<ModelsStatus | null>(null);
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await invoke<ModelsStatus>("get_models_status"));
      setLive(true);
    } catch (err) {
      console.warn("get_models_status not available:", err);
      setLive(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 600 ms heartbeat strictly while a download is in flight.
  useEffect(() => {
    if (!live || !status?.downloading) return;
    const id = window.setInterval(load, 600);
    return () => window.clearInterval(id);
  }, [live, status?.downloading, load]);

  const copyDir = useCallback(async () => {
    if (!status?.dir) return;
    try {
      await navigator.clipboard.writeText(status.dir);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }, [status?.dir]);

  // Defensive totals: backend fields win, artifact sums fill the gaps.
  const artifacts = status?.artifacts ?? [];
  const expected =
    status?.total_bytes || artifacts.reduce((n, a) => n + (a.bytes_expected || 0), 0);
  const present =
    status?.total_present_bytes ||
    artifacts.reduce((n, a) => n + (a.present ? a.bytes_on_disk || a.bytes_expected || 0 : 0), 0);

  const prog = status?.progress;
  const pct =
    prog && prog.total > 0 ? Math.min(100, Math.round((prog.downloaded / prog.total) * 100)) : 0;

  return (
    <Card title="Файлы моделей">
      {/* Directory */}
      {live && status?.dir && (
        <Field label="Папка" description="Где на диске хранятся файлы моделей.">
          <div className="flex min-w-0 items-center gap-1">
            <code className="max-w-56 truncate font-mono text-[11px] text-muted">{status.dir}</code>
            <button
              type="button"
              title="Скопировать путь"
              onClick={copyDir}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-subtle transition-colors hover:bg-accent-soft hover:text-fg"
            >
              {copied ? <Check className="h-3 w-3 text-accent" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </Field>
      )}

      {/* Totals */}
      {live && (
        <Field label="На диске" description="Загружено / требуется для нейросетевого уровня.">
          <span className="font-mono text-[11px] text-fg">
            {formatBytes(present)} / {formatBytes(expected)}
          </span>
        </Field>
      )}

      {/* Artifacts */}
      {live &&
        artifacts.map((a) => (
          <div
            key={a.name + a.url}
            className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.present ? "bg-success" : "bg-subtle"}`} />
              <code className="truncate font-mono text-[11px] text-fg">{a.name}</code>
            </div>
            <span className="shrink-0 font-mono text-[11px] text-subtle">
              {formatBytes(a.present ? a.bytes_on_disk || a.bytes_expected : a.bytes_expected)}
            </span>
          </div>
        ))}

      {/* State (read-only — downloads live in setup). */}
      {!live ? (
        <p className="px-4 py-3.5 text-[12px] leading-[18px] text-muted">
          Состояние моделей недоступно: команда серверной части пока не подключена.
        </p>
      ) : status?.downloading ? (
        <div className="space-y-2 border-t border-line px-4 py-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent-soft">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <code className="min-w-0 truncate font-mono text-muted">{prog?.file ?? "загрузка…"}</code>
            <span className="shrink-0 font-mono text-fg">
              {mb(prog?.downloaded ?? 0)} / {mb(prog?.total || expected)} · {pct}%
            </span>
          </div>
          <p className="font-mono text-[11px] text-subtle">загрузка в мастере настройки…</p>
        </div>
      ) : status?.error ? (
        <div className="border-t border-line px-4 py-3">
          <p className="break-words text-[11px] text-danger">{status.error}</p>
          <p className="pt-1.5 text-[12px] leading-[18px] text-muted">
            Чтобы повторить загрузку, откройте <b>О программе → Повторить настройку</b>.
          </p>
        </div>
      ) : status?.ready ? (
        <div className="flex items-center gap-1.5 border-t border-line px-4 py-3">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <p className="text-[12px] font-medium text-fg">Файлы моделей готовы</p>
        </div>
      ) : (
        <div className="border-t border-line px-4 py-3">
          <p className="text-[12px] leading-[18px] text-muted">
            Не загружены. Чтобы получить дополнительный нейросетевой уровень, откройте{" "}
            <b>О программе → Повторить настройку</b>.
          </p>
        </div>
      )}

      {/* Honest note. */}
      <p className="border-t border-line bg-accent-soft px-4 py-2.5 text-[12px] leading-[18px] text-muted">
        Базовый смысловой поиск встроен. Эти файлы заранее загружают дополнительный нейросетевой
        уровень для работы без интернета.
      </p>
    </Card>
  );
}
