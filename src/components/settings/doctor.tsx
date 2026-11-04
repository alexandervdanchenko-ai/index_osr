import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, Stethoscope } from "lucide-react";
import { DoctorCheck, DoctorReport } from "../../types";
import { Card } from "./kit";
import { plural } from "../../lib/format";

/* Doctor — one-shot diagnostics over the index, watcher, database and
   models. Never auto-runs on mount; failures degrade to a calm inline
   card because the backend command may not exist yet. */

type Phase = "idle" | "running" | "done" | "error";

const RANK: Record<DoctorCheck["status"], number> = { fail: 0, warn: 1, ok: 2 };
const WORD: Record<DoctorCheck["status"], string> = { ok: "норма", warn: "внимание", fail: "ошибка" };
const DOT: Record<DoctorCheck["status"], string> = {
  ok: "bg-success",
  warn: "bg-warning",
  fail: "bg-danger",
};
const TONE: Record<DoctorCheck["status"], string> = {
  ok: "text-success",
  warn: "text-warning",
  fail: "text-danger",
};

/** Fails first, then warns, then ok; order otherwise stays as reported. */
function sortChecks(checks: DoctorCheck[]): DoctorCheck[] {
  return checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => RANK[a.c.status] - RANK[b.c.status] || a.i - b.i)
    .map((x) => x.c);
}

export function DoctorSection() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedFix, setCopiedFix] = useState<string | null>(null);

  const run = useCallback(() => {
    setPhase("running");
    setCopied(false);
    setCopiedFix(null);
    invoke<DoctorReport>("run_doctor")
      .then((res) => {
        setReport(res);
        setPhase("done");
      })
      .catch((err) => {
        console.warn("run_doctor not available:", err);
        setPhase("error");
      });
  }, []);

  const copyReport = useCallback(async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }, [report]);

  const copyFix = useCallback(async (id: string, fix: string) => {
    try {
      await navigator.clipboard.writeText(fix);
      setCopiedFix(id);
      window.setTimeout(() => setCopiedFix(null), 1500);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }, []);

  const checks = report ? sortChecks(report.checks) : [];
  const summary = report?.summary ?? { ok: 0, warn: 0, fail: 0 };
  const total = summary.ok + summary.warn + summary.fail;

  return (
    <div>
      {/* Toolbar: actions right-aligned; the section header above carries
          the description. */}
      <div className="mb-3 flex items-center justify-end gap-1.5">
        {report && phase !== "running" && (
          <button
            type="button"
            onClick={copyReport}
            className="btn btn-secondary h-8 px-3 text-[12px]"
          >
            {copied ? <Check className="h-3 w-3 text-accent" /> : <Copy className="h-3 w-3" />}
            Скопировать отчёт
          </button>
        )}
        <button
          type="button"
          onClick={run}
          disabled={phase === "running"}
          className="btn btn-primary h-8 px-4 text-[12px]"
        >
          <Stethoscope className="h-3 w-3" />
          Запустить проверку
        </button>
      </div>

      {phase === "idle" && (
        <Card>
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-accent-soft text-subtle">
              <Stethoscope className="h-4 w-4" />
            </span>
            <p className="text-[13px] font-medium text-fg">Проверка ещё не запускалась</p>
            <p className="max-w-sm text-[12px] leading-[18px] text-muted">
              Проверяются полнотекстовый индекс, отслеживание файлов, база метаданных и файлы
              моделей. Всё выполняется на вашем компьютере, ничего никуда не отправляется.
            </p>
          </div>
        </Card>
      )}

      {phase === "running" && (
        <Card title="Идёт проверка">
          <div className="space-y-0">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-line" />
                <span
                  className="h-2.5 animate-pulse rounded-full bg-line"
                  style={{ width: `${34 + ((i * 23) % 40)}%` }}
                />
                <span className="ml-auto h-2 w-8 shrink-0 animate-pulse rounded-full bg-line" />
              </div>
            ))}
          </div>
        </Card>
      )}

      {phase === "error" && (
        <div className="overflow-hidden rounded-panel border border-danger/30 bg-elevated">
          <p className="p-4 text-[12px] font-medium text-danger">Диагностика недоступна: серверная часть не подключена</p>
          <p className="px-4 pb-3 text-[12px] leading-[18px] text-muted">
            Команда <code className="font-mono">run_doctor</code> не ответила. Проверки выполняются
            только на этом компьютере и ничего не изменяют.
          </p>
        </div>
      )}

      {phase === "done" && report && (
        <Card>
          {/* Summary line with semantic-colored counts. */}
          <div className="flex items-center justify-between gap-4 border-b border-line bg-accent-soft px-4 py-2.5">
            <p className="text-[12px] text-muted">
              {total} {plural(total, "проверка", "проверки", "проверок")} ·{" "}
              <span className="text-success">{summary.ok} в норме</span> ·{" "}
              <span className="text-warning">{summary.warn} {plural(summary.warn, "предупреждение", "предупреждения", "предупреждений")}</span>
              {summary.fail > 0 && (
                <>
                  {" · "}
                  <span className="text-danger">{summary.fail} {plural(summary.fail, "ошибка", "ошибки", "ошибок")}</span>
                </>
              )}
            </p>
            {report.ran_at > 0 && (
              <p className="shrink-0 font-mono text-[11px] text-subtle">
                {new Date(report.ran_at < 1e12 ? report.ran_at * 1000 : report.ran_at).toLocaleTimeString("ru-RU")}
              </p>
            )}
          </div>

          {checks.map((c) => (
            <div key={c.id} className="flex gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
              <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${DOT[c.status]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-fg">{c.label}</p>
                {c.detail && (
                  <p className="break-words text-[12px] leading-[18px] text-muted">{c.detail}</p>
                )}
                {c.fix && (
                  <div className="mt-1 flex min-w-0 items-start gap-1.5">
                    <code className="min-w-0 select-text break-all rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-muted">
                      {c.fix}
                    </code>
                    <button
                      type="button"
                      title="Скопировать исправление"
                      onClick={() => copyFix(c.id, c.fix ?? "")}
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-subtle transition-colors hover:bg-accent-soft hover:text-fg"
                    >
                      {copiedFix === c.id ? (
                        <Check className="h-3 w-3 text-accent" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                )}
              </div>
              <span className={`shrink-0 text-[11px] font-medium ${TONE[c.status]}`}>
                {WORD[c.status]}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
