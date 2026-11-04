import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import {
  Bot,
  Check,
  Copy,
  Filter,
  FolderTree,
  Info,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  KensakuConfig,
  ClientStatus,
  InstallOutcome,
} from "../types";
import { useTheme } from "../hooks/useTheme";
import { useStats } from "../hooks/useStats";
import { Card, Field, Switch, Stepper, SectionHeader, reasonFrom } from "./settings/kit";
import { OcrField } from "./settings/ocr";
import { StatsForNerds } from "./settings/stats";
import { DoctorSection } from "./settings/doctor";
import { ModelFilesCard } from "./settings/models";
import { formatBytes, formatComma, pluralN } from "../lib/format";

export interface SettingsProps {
  onClose: () => void;
  initialSection?: string;
  onConfigSaved: () => void;
}

type SectionId =
  | "general"
  | "folders"
  | "exclusions"
  | "search"
  | "ai"
  | "beta"
  | "agents"
  | "stats"
  | "doctor"
  | "about";

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "Общие", icon: SlidersHorizontal },
  { id: "folders", label: "Папки", icon: FolderTree },
  { id: "exclusions", label: "Исключения", icon: Filter },
  { id: "search", label: "Поиск", icon: Search },
  { id: "ai", label: "Смысловой поиск", icon: Sparkles },
  { id: "agents", label: "Агенты", icon: Bot },
  { id: "doctor", label: "Диагностика", icon: Stethoscope },
  { id: "about", label: "О программе", icon: Info },
];

const SECTION_META: Record<SectionId, { title: string; description: string }> = {
  general: { title: "Общие", description: "Оформление, вызов окна и запуск." },
  folders: { title: "Папки", description: "Папки на этом компьютере, которые отслеживаются и индексируются." },
  exclusions: { title: "Исключения", description: "Имена и расширения, которые не попадают в индекс." },
  search: { title: "Поиск", description: "Ранжирование, OCR и язык запросов." },
  ai: { title: "Смысловой поиск", description: "Понимает смысл, а не только слова. Работает на этом компьютере." },
  beta: { title: "Бета", description: "Экспериментальные функции вне основного поиска." },
  agents: { title: "Агенты", description: "Доступ только для чтения для MCP-клиентов и командной строки." },
  stats: { title: "Подробная статистика", description: "Текущие показатели работающего индекса." },
  doctor: { title: "Диагностика", description: "Актуален ли индекс и всё ли работает." },
  about: { title: "О программе", description: "Версия, справка и сброс." },
};

const EXCLUSION_PRESETS: Record<string, string[]> = {
  "Разработчик": [
    "node_modules", ".git", "target", "dist", "build", "out",
    ".next", ".nuxt", ".output", ".cache", ".venv", "venv",
    "__pycache__", "vendor", ".gradle", ".idea", ".vscode",
  ],
  "Дизайнер": [
    "node_modules", ".git", ".Trash", ".cache", "Backups",
    "Time Machine", "Library", "lost+found", ".dub", "_archive",
  ],
  "Универсальный": [
    "node_modules", ".git", "target", "dist", "build", "out",
    ".cache", ".venv", "__pycache__", ".Trash", "Backups",
    "lost+found", ".idea", ".vscode", "Library",
  ],
};

/* Full overlay settings page: 200px rail + bento sections.
   Config edits are local until Save; theme applies immediately. */

export function Settings({ onClose, initialSection, onConfigSaved }: SettingsProps) {
  const [section, setSection] = useState<SectionId>(
    (SECTIONS.find((s) => s.id === initialSection)?.id ?? "general") as SectionId,
  );
  const [config, setConfig] = useState<KensakuConfig | null>(null);
  /* Loaded snapshot — serialized once. A JSON compare marks the save bar. */
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = config !== null && snapshot !== null && JSON.stringify(config) !== snapshot;

  useEffect(() => {
    invoke<KensakuConfig>("get_config")
      .then((cfg) => {
        setConfig(cfg);
        setSnapshot(JSON.stringify(cfg));
      })
      .catch((err) => console.error("Failed to load config:", err));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = async (reindex: boolean) => {
    if (!config) return;
    setSaving(true);
    try {
      await invoke("save_config", { config });
      setSnapshot(JSON.stringify(config));
      if (reindex) {
        await invoke("complete_setup", {
          watchedDirs: config.watched_dirs,
          excludedDirs: config.excluded_dirs,
          shortcut: config.shortcut,
        });
      }
      onConfigSaved();
      if (reindex) {
        onClose();
      } else {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1600);
      }
    } catch (err) {
      console.error("Save failed:", err);
      alert("Не удалось сохранить настройки: " + err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-in absolute inset-0 z-40 flex bg-bg">
      <nav data-tauri-drag-region className="relative z-10 flex w-[200px] shrink-0 flex-col overflow-y-auto px-3 pb-3 pt-5">
        <p data-tauri-drag-region className="t-title px-3 pb-4 text-fg">Настройки</p>
        <div className="flex flex-col gap-0.5">
          {SECTIONS.map((s) => {
            const active = section === s.id;
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-8 w-full items-center gap-2.5 rounded-control px-2.5 text-[13px] transition-colors duration-150 ${
                  active ? "control font-medium text-fg" : "text-muted hover:text-fg"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-fg" : "text-subtle"}`} strokeWidth={1.75} />
                {s.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="surface relative z-10 m-2 ml-0 min-w-0 flex-1 overflow-hidden rounded-sheet">
        <button
          type="button"
          title="Закрыть (Esc)" aria-label="Закрыть"
          onClick={onClose}
          className="btn btn-ghost btn-icon absolute right-4 top-4 z-20 h-8 !rounded-full"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <div className="absolute inset-0 overflow-y-auto px-6 pb-20 pt-6" style={{ scrollbarGutter: "stable" }}>
          <div className="mx-auto max-w-[640px]">
            {config ? (
              <SectionShell section={section}>{renderSection(section, config, setConfig)}</SectionShell>
            ) : (
              <ConfigSkeleton />
            )}
          </div>
        </div>

        <footer className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center">
          <div className="control pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5">
            <span className="flex items-center gap-2 pr-2 text-[12px] text-muted">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${dirty ? "bg-warning" : "bg-success/70"}`} />
              {dirty ? "Есть несохранённые изменения" : saved ? "Сохранено" : "Изменений нет"}
            </span>
            <button type="button" onClick={() => handleSave(true)} disabled={saving || !config} className="btn btn-ghost h-8 !rounded-full px-3 text-[12px]">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
              Сохранить и переиндексировать
            </button>
            <button type="button" onClick={() => handleSave(false)} disabled={saving || !config || !dirty} className="btn btn-primary h-8 !rounded-full px-4 text-[12px]">
              {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {saved ? "Сохранено" : saving ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}

function renderSection(
  section: SectionId,
  config: KensakuConfig,
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>,
): React.ReactNode {
  switch (section) {
    case "general":
      return <GeneralSection config={config} setConfig={setConfig} />;
    case "folders":
      return <FoldersSection config={config} setConfig={setConfig} />;
    case "exclusions":
      return <ExclusionsSection config={config} setConfig={setConfig} />;
    case "search":
      return <SearchSection config={config} setConfig={setConfig} />;
    case "ai":
      return <AiSection config={config} setConfig={setConfig} />;
    case "agents":
      return <AgentsSection config={config} setConfig={setConfig} />;
    case "doctor":
      // Health groups what used to be Doctor, Stats for Nerds and Beta.
      return (
        <>
          <DoctorSection />
          <StatsForNerds />
          <BetaSection config={config} setConfig={setConfig} />
        </>
      );
    case "about":
      return <AboutSection />;
  }
}

function ConfigSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="surface h-16 animate-pulse opacity-60" />
      ))}
    </div>
  );
}

/** Wraps every section: header block first, then the cards. */
function SectionShell({ section, children }: { section: SectionId; children: React.ReactNode }) {
  const meta = SECTION_META[section];
  return (
    // Keyed by section so each switch replays a short ease-in.
    <div key={section} className="section-enter">
      <SectionHeader title={meta.title} description={meta.description} />
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* General                                                           */
/* ---------------------------------------------------------------- */

function GeneralSection({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  const { theme, setTheme } = useTheme();
  const [capturing, setCapturing] = useState(false);

  /* null = unknown (backend rejected get_autostart) → switch stays off. */
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<boolean>("get_autostart")
      .then((v) => {
        if (!cancelled) setAutostart(v);
      })
      .catch(() => {
        if (!cancelled) setAutostart(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Optimistic toggle: flip the switch immediately, revert on failure. */
  const toggleAutostart = async (next: boolean) => {
    if (autostart === null || autostartBusy) return;
    const prev = autostart;
    setAutostart(next);
    setAutostartError(null);
    setAutostartBusy(true);
    try {
      await invoke("set_autostart", { enabled: next });
    } catch (err) {
      setAutostart(prev);
      setAutostartError(reasonFrom(err));
    } finally {
      setAutostartBusy(false);
    }
  };

  useEffect(() => {
    if (!capturing) return;
    document.body.dataset.ksCapture = "1";
    // Modifiers accumulate across keydowns, so tapping Ctrl then K works as
    // well as holding Ctrl+K.
    const pressed = new Set<string>();
    const normalizeModifier = (key: string) => (key === "Meta" ? "Super" : key);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }
      if (["Control", "Super", "Meta", "Alt", "Shift"].includes(e.key)) {
        pressed.add(normalizeModifier(e.key));
        return;
      }
      if (e.ctrlKey) pressed.add("Control");
      if (e.metaKey) pressed.add("Super");
      if (e.altKey) pressed.add("Alt");
      if (e.shiftKey) pressed.add("Shift");
      const order = ["Control", "Super", "Alt", "Shift"];
      const parts = order.filter((m) => pressed.has(m));
      const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      parts.push(key);
      setConfig((c) => (c ? { ...c, shortcut: parts.join("+") } : c));
      setCapturing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      delete document.body.dataset.ksCapture;
      window.removeEventListener("keydown", onKey);
    };
  }, [capturing, setConfig]);

  return (
    <>
      <Card title="Оформление">
        <div className="grid grid-cols-2 gap-4 p-4">
          {(["light", "dark"] as const).map((value) => (
            <ThemeSwatch
              key={value}
              value={value}
              active={theme === value}
              onSelect={() => {
                setTheme(value);
                /* Keep the app's config copy in step, or a later Save would
                   write the stale theme back over the persisted pick. */
                setConfig((c) => (c ? { ...c, theme: value } : c));
              }}
            />
          ))}
        </div>
      </Card>

      <Card title="Вызов окна">
        <Field label="Сочетание клавиш" description="Открывает поиск из любой программы. Чтобы изменить, щёлкните и нажмите новое сочетание. В Linux с Wayland глобальные клавиши могут блокироваться: назначьте сочетание на команду kensaku --toggle.">
          <button
            type="button"
            onClick={() => setCapturing(true)}
            className={`flex h-8 min-w-40 items-center justify-center rounded-control border px-3 font-mono text-[12px] transition-colors duration-150 ${
              capturing
                ? "border-accent text-accent"
                : "border-line bg-accent-soft text-fg hover:border-line-strong"
            }`}
          >
            {capturing ? "нажмите клавиши…" : config.shortcut}
          </button>
        </Field>

        <Field label="Максимум результатов" description="Предел на один запрос. Чем меньше, тем быстрее показ.">
          <Stepper
            value={config.max_results}
            min={25}
            max={500}
            step={25}
            onChange={(v) => setConfig((c) => (c ? { ...c, max_results: v } : c))}
          />
        </Field>

        <Field
          label="Запуск при входе в систему"
          description={
            autostart === null ? "Недоступно в этой системе" : "Запускать программу при входе в систему."
          }
        >
          <Switch
            checked={autostart ?? false}
            disabled={autostart === null || autostartBusy}
            onChange={toggleAutostart}
          />
        </Field>
        {autostartError && (
          <p className="break-words border-t border-line px-4 py-2 font-mono text-[11px] text-danger">
            Не удалось изменить автозапуск: {autostartError}
          </p>
        )}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Folders                                                           */
/* ---------------------------------------------------------------- */

function FoldersSection({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  const [input, setInput] = useState("");
  const { stats } = useStats(null);

  const addDir = () => {
    const t = input.trim();
    if (t && !config.watched_dirs.includes(t)) {
      setConfig((c) => (c ? { ...c, watched_dirs: [...c.watched_dirs, t] } : c));
      setInput("");
    }
  };

  const addDropped = (paths: string[]) =>
    setConfig((c) => {
      if (!c) return c;
      const fresh = paths.filter((p) => !c.watched_dirs.includes(p));
      return fresh.length ? { ...c, watched_dirs: [...c.watched_dirs, ...fresh] } : c;
    });

  return (
    <>
      <Card title="Отслеживаемые папки">
        {config.watched_dirs.length === 0 && (
          <p className="px-4 py-3 text-[11px] text-subtle">Папки пока не добавлены.</p>
        )}
        {config.watched_dirs.map((dir) => (
          <div
            key={dir}
            className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-[12px] text-fg">
                {dir.split("/").filter(Boolean).pop() || dir}
              </p>
              <p className="truncate font-mono text-[11px] text-subtle">{dir}</p>
            </div>
            <button
              type="button"
              title={`Перестать отслеживать ${dir}`}
              onClick={() =>
                setConfig((c) =>
                  c ? { ...c, watched_dirs: c.watched_dirs.filter((d) => d !== dir) } : c,
                )
              }
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-subtle transition-colors hover:bg-accent-soft hover:text-danger"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add("border-accent", "text-fg");
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove("border-accent", "text-fg");
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("border-accent", "text-fg");
            const paths: string[] = [];
            for (const item of Array.from(e.dataTransfer.files)) {
              const p = (item as File & { path?: string }).path;
              if (p) paths.push(p);
            }
            if (paths.length === 0 && input.trim()) paths.push(input.trim());
            addDropped(paths);
          }}
          className="mx-4 my-2.5 flex h-16 items-center justify-center rounded-control border border-dashed border-line text-[11px] text-subtle transition-colors duration-150"
        >
          Перетащите сюда папки, чтобы добавить их
        </div>

        <div className="flex gap-1.5 border-t border-line p-3">
          <input
            type="text"
            value={input}
            placeholder="Полный путь к папке, например C:\Документы"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDir()}
            spellCheck={false}
            className="field h-8 min-w-0 flex-1 font-mono"
          />
          <button
            type="button"
            onClick={addDir}
            className="btn btn-secondary h-8 px-3 text-[12px]"
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить
          </button>
        </div>
        {stats && stats.index.files > 0 && (
          <p className="border-t border-line px-4 py-2 font-mono text-[11px] text-subtle">
            В индексе {pluralN(stats.index.files, "файл", "файла", "файлов")} в {pluralN(stats.index.dirs, "папке", "папках", "папках")}
          </p>
        )}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Exclusions                                                        */
/* ---------------------------------------------------------------- */

function ExclusionsSection({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  const [dirInput, setDirInput] = useState("");
  const [extInput, setExtInput] = useState("");

  const removeDir = (d: string) =>
    setConfig((c) => (c ? { ...c, excluded_dirs: c.excluded_dirs.filter((x) => x !== d) } : c));

  return (
    <>
      <Card title="Готовые наборы">
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {Object.keys(EXCLUSION_PRESETS).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setConfig((c) => (c ? { ...c, excluded_dirs: [...EXCLUSION_PRESETS[p]] } : c))}
              className="flex h-7 items-center rounded-full border border-line px-3 text-[12px] text-muted transition-colors duration-150 hover:border-line-strong hover:text-fg"
            >
              {p}
            </button>
          ))}
          <span className="self-center text-[11px] text-subtle">заменяет список ниже</span>
        </div>
      </Card>

      <Card title="Исключённые имена папок">
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {config.excluded_dirs.map((d) => (
            <button
              key={d}
              type="button"
              title={`Удалить ${d}`}
              onClick={() => removeDir(d)}
              className="group flex h-6 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 font-mono text-[11px] text-muted transition-colors hover:text-danger"
            >
              {d}
              <X className="h-3 w-3 opacity-50 group-hover:opacity-100" />
            </button>
          ))}
        </div>
        <div className="border-t border-line p-3">
          <input
            value={dirInput}
            placeholder="имя папки, например Архив; Enter - добавить"
            onChange={(e) => setDirInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirInput.trim()) {
                const t = dirInput.trim();
                setConfig((c) =>
                  c && !c.excluded_dirs.includes(t) ? { ...c, excluded_dirs: [...c.excluded_dirs, t] } : c,
                );
                setDirInput("");
              }
            }}
            spellCheck={false}
            className="field h-8 w-full font-mono"
          />
        </div>
      </Card>

      <Card title="Исключённые расширения">
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {config.excluded_extensions.map((x) => (
            <button
              key={x}
              type="button"
              title={`Удалить ${x}`}
              onClick={() =>
                setConfig((c) =>
                  c ? { ...c, excluded_extensions: c.excluded_extensions.filter((e) => e !== x) } : c,
                )
              }
              className="group flex h-6 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 font-mono text-[11px] text-muted transition-colors hover:text-danger"
            >
              {x}
              <X className="h-3 w-3 opacity-50 group-hover:opacity-100" />
            </button>
          ))}
        </div>
        <div className="border-t border-line p-3">
          <input
            value={extInput}
            placeholder="расширение, например .bin; Enter - добавить"
            onChange={(e) => setExtInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && extInput.trim()) {
                const t = extInput.trim();
                setConfig((c) =>
                  c && !c.excluded_extensions.includes(t)
                    ? { ...c, excluded_extensions: [...c.excluded_extensions, t] }
                    : c,
                );
                setExtInput("");
              }
            }}
            spellCheck={false}
            className="field h-8 w-full font-mono"
          />
        </div>
      </Card>

      <Card title="Скрытые файлы">
        <Field
          label="Пропускать скрытые файлы"
          description="Не индексировать файлы и папки, имя которых начинается с точки. Выключите, чтобы индексировать их."
        >
          <Switch
            checked={config.skip_hidden ?? true}
            onChange={(v) => setConfig((c) => (c ? { ...c, skip_hidden: v } : c))}
          />
        </Field>
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Search                                                            */
/* ---------------------------------------------------------------- */

const CHEATSHEET: [string, string][] = [
  ["type:image,dir,doc,code,media", "Тип файла"],
  ["ext:png", "По расширению"],
  ['in:"~/Projects"', "В папке и вложенных"],
  ["modified:<7d", "Изменён недавно"],
  ["size:>2mb", "Порог размера"],
  ["-ext:log", "Отрицание фильтра"],
  [">reindex", "Перестроить весь индекс"],
  [">doctor", "Диагностика"],
  [">model", "Состояние модели"],
  [">add folder", "Добавить папку"],
];

function SearchSection({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  return (
    <>
      <Card title="Результаты">
        <Field
          label="Показывать миниатюры"
          description="Миниатюры изображений и PDF (первая страница). Для PDF нужен poppler, без него показывается значок файла. Выключите, чтобы не строить миниатюры."
        >
          <Switch
            checked={config.show_thumbnails ?? true}
            onChange={(v) => setConfig((c) => (c ? { ...c, show_thumbnails: v } : c))}
          />
        </Field>
        <Field
          label="Вид результатов"
          description="Плитка - карточки с изображениями. Список - по файлу в строке, с размером и датой."
        >
          <div role="radiogroup" aria-label="Вид результатов" className="pill-group">
            {(["grid", "list"] as const).map((v) => {
              const active = (config.results_view ?? "grid") === v;
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setConfig((c) => (c ? { ...c, results_view: v } : c))}
                  className="pill"
                >
                  {v === "grid" ? "Плитка" : "Список"}
                </button>
              );
            })}
          </div>
        </Field>
      </Card>

      <Card title="Ранжирование">
        <Field
          label="Смысловой поиск"
          description="Статические эмбеддинги, ~0,1 мс на запрос, объединяются с BM25 через RRF."
        >
          <Switch
            checked={config.semantic_enabled ?? true}
            onChange={(v) => setConfig((c) => (c ? { ...c, semantic_enabled: v } : c))}
          />
        </Field>
        <OcrField config={config} setConfig={setConfig} />
      </Card>

      <Card title="Фоновая индексация">
        <Field
          label="Режим обхода"
          description="«Сбалансированный» - низкий приоритет диска и процессора. «Экономный» - ещё и замедляется при работе от батареи. «Максимальная скорость» - обычный приоритет."
        >
          <select
            value={config.crawl_mode ?? "full"}
            onChange={(e) =>
              setConfig((c) =>
                c
                  ? {
                      ...c,
                      crawl_mode: e.target.value as
                        | "full"
                        | "balanced"
                        | "eco",
                    }
                  : c,
              )
            }
            className="field h-8"
          >
            <option value="full">Максимальная скорость</option>
            <option value="balanced">Сбалансированный</option>
            <option value="eco">Экономный</option>
          </select>
        </Field>
        <Field
          label="Приостановить индексацию"
          description="Новые файлы не читаются. Переименования и удаления по-прежнему учитываются."
        >
          <Switch
            checked={config.pause_indexing ?? false}
            onChange={(v) =>
              setConfig((c) => (c ? { ...c, pause_indexing: v } : c))
            }
          />
        </Field>
      </Card>

      <Card title="Синонимы">
        <div className="space-y-2 p-4">
          <p className="text-[12px] leading-[18px] text-muted">
            Личный словарь: по слову находятся и все его варианты
            (без учёта регистра, достаточно любого из вариантов).
          </p>
          {(config.aliases ?? []).map((alias, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={alias.term}
                placeholder="слово"
                onChange={(e) =>
                  setConfig((c) => {
                    if (!c) return c;
                    const aliases = [...(c.aliases ?? [])];
                    aliases[i] = { ...aliases[i], term: e.target.value };
                    return { ...c, aliases };
                  })
                }
                className="field h-8 w-28 shrink-0 font-mono"
              />
              <span className="text-subtle">→</span>
              <input
                type="text"
                value={alias.expansions.join(", ")}
                placeholder="иск, исковое заявление"
                onChange={(e) =>
                  setConfig((c) => {
                    if (!c) return c;
                    const aliases = [...(c.aliases ?? [])];
                    aliases[i] = {
                      ...aliases[i],
                      expansions: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    };
                    return { ...c, aliases };
                  })
                }
                className="field h-8 min-w-0 flex-1 font-mono"
              />
              <button
                type="button"
                title="Удалить синоним"
                onClick={() =>
                  setConfig((c) =>
                    c ? { ...c, aliases: (c.aliases ?? []).filter((_, j) => j !== i) } : c,
                  )
                }
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-subtle transition-colors hover:bg-accent-soft hover:text-danger"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setConfig((c) =>
                c ? { ...c, aliases: [...(c.aliases ?? []), { term: "", expansions: [] }] } : c,
              )
            }
            className="flex h-7 items-center gap-1 rounded-control border border-line px-2.5 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            <Plus className="h-3 w-3" /> Добавить синоним
          </button>
        </div>
      </Card>

      <Card title="Язык запросов">
        <div className="grid grid-cols-2 gap-x-8 px-4 py-2.5">
          {CHEATSHEET.map(([token, desc], idx) => (
            <div
              key={token}
              className={`flex h-8 items-center justify-between gap-3 ${
                idx < CHEATSHEET.length - 2 ? "border-b border-line/70" : ""
              }`}
            >
              <code className="shrink-0 whitespace-nowrap text-fg">{token}</code>
              <span className="truncate text-right text-[11px] text-subtle">{desc}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* AI & Semantic                                                     */
/* ---------------------------------------------------------------- */

function AiSection({ config, setConfig }: { config: KensakuConfig; setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>> }) {
  const { stats, live } = useStats(2000);
  const [reembedState, setReembedState] = useState<"idle" | "pending">("idle");

  const modelId =
    stats?.runtime?.model_id || config.semantic_model || "появится после подключения";
  const queueDepth = stats?.ingestion?.embed_queue_depth ?? 0;

  const reembed = async () => {
    setReembedState("pending");
    try {
      await invoke("reembed_all");
    } catch {
      console.warn("reembed_all not available yet");
    }
    window.setTimeout(() => setReembedState("idle"), 1500);
  };

  return (
    <>
      <Card title="Модель эмбеддингов">
        <Field label="Модель" description="Статические эмбеддинги: без видеокарты и без интернета.">
          <span className="max-w-48 truncate font-mono text-[11px] text-fg">{modelId}</span>
        </Field>
        <Field label="Размерность" description="По данным описания модели.">
          <span className="font-mono text-[11px] text-muted">{live ? "-" : "-"}</span>
        </Field>
        <Field label="Векторы на диске" description="Векторы хранятся в metadata.db.">
          <span className="font-mono text-[11px] text-muted">{formatBytes(stats?.index?.vector_bytes ?? 0)}</span>
        </Field>
        <Field label="Готовность" description="Доступны ли фрагменты для поиска прямо сейчас.">
          <span
            className={`font-mono text-[11px] ${
              stats?.runtime?.semantic_ready ? "text-success" : "text-warning"
            }`}
          >
            {stats?.runtime?.semantic_ready ? "готово" : live ? "подготовка" : "ожидание"}
          </span>
        </Field>
      </Card>

      <Card title="Таблица эмбеддингов">
        <Field
          label="Таблица f32"
          description="Хранить таблицу в f32 вместо компактной i8. Только для сравнения качества."
        >
          <Switch
            checked={config.semantic_f32_table ?? false}
            onChange={(v) => setConfig((c) => (c ? { ...c, semantic_f32_table: v } : c))}
          />
        </Field>
      </Card>

      <Card title="Очередь обработки">
        <div className="space-y-2 p-4">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted">Фрагментов в очереди</span>
            <span className="font-mono text-fg">{formatComma(queueDepth)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent-soft">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${queueDepth > 0 ? Math.max(4, Math.min(100, queueDepth)) : 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="font-mono text-[11px] text-subtle">
              {live ? "обновляется каждые 2 с" : "ожидание get_stats"}
            </span>
            <button
              type="button"
              onClick={reembed}
              className="flex h-7 items-center gap-1.5 rounded-control border border-line px-2.5 text-[11px] text-fg transition-colors hover:border-line-strong"
            >
              <RefreshCw className="h-3 w-3" />
              {reembedState === "pending" ? "В очереди…" : "Обработать заново"}
            </button>
          </div>
        </div>
      </Card>

      <ModelFilesCard />
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Agents                                                            */
/* ---------------------------------------------------------------- */

const MCP_CONFIG = `{
  "mcpServers": {
    "kensaku": { "command": "kensaku-cli", "args": ["mcp"] }
  }
}`;

const CLI_EXAMPLES = [
  'kensaku-cli search "docker error" --json --limit 10',
  'kensaku-cli search "type:pdf invoice" --path ~/Documents',
  'kensaku-cli state --json',
];

const MCP_TOOLS: [string, string][] = [
  ["health_check", "служба · БД · индекс · модель"],
  ["search", "query, page_size ≤ 50, cursor, mode, фильтры"],
  ["read_snippet", "path, query?, max_tokens ≤ 1024"],
  ["index_state", "счётчики, этап, очередь, актуальность"],
  ["regex_search", "ограниченный шаблон, page_size, cursor"],
  ["find_symbol", "имя символа, language?, page_size ≤ 50"],
  ["reindex", "только если включено; нужна служба"],
];

/** One copyable mono row — command text with a trailing copy button. */
function CopyRow({
  text,
  copied,
  onCopied,
}: {
  text: string;
  copied: boolean;
  onCopied: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line/60 px-3 py-2 last:border-b-0">
      <code className="no-scrollbar min-w-0 flex-1 select-text overflow-x-auto whitespace-nowrap font-mono text-[11px] leading-5 text-fg">
        {text}
      </code>
      <button
        type="button"
        title="Скопировать"
        onClick={() => {
          navigator.clipboard.writeText(text);
          onCopied();
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-subtle transition-colors hover:bg-elevated hover:text-fg"
      >
        {copied ? <Check className="h-3 w-3 text-accent" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Beta                                                              */
/* ---------------------------------------------------------------- */

function BetaSection({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  void config;
  void setConfig;
  return (
    <Card title="Поиск по изображениям">
      <div className="flex items-center justify-between gap-4 px-4 py-3 opacity-50">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-fg">Поиск по изображениям</p>
          <p className="text-[12px] leading-[18px] text-muted">Поиск картинок по тому, что на них изображено. Появится позже.</p>
        </div>
        <span className="shrink-0 rounded-small border border-line px-2 py-0.5 text-[12px] text-muted">Позже</span>
      </div>
    </Card>
  );
}

function AgentConnectCard() {
  const [statuses, setStatuses] = useState<ClientStatus[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setStatuses(await invoke<ClientStatus[]>("agent_connect_status"));
    } catch {
      setStatuses([]);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const install = async (id: string) => {
    setBusy(id);
    setNotice(null);
    try {
      const outcome = await invoke<InstallOutcome>("agent_connect_install", { client: id });
      setNotice(outcome.message);
    } catch (err) {
      setNotice(reasonFrom(err));
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const statusLabel = (status: ClientStatus): string => {
    if (status.configured) return "Подключён";
    if (status.installed) return "Найден";
    if (status.config_path) return "Не настроен";
    return "Не найден";
  };

  return (
    <Card title="Подключение в один щелчок">
      <div>
        {statuses.length === 0 && (
          <p className="px-4 py-3 text-[12px] text-muted">
            Поиск установленных MCP-клиентов…
          </p>
        )}
        {statuses.map((status) => (
          <div
            key={status.id}
            className="flex items-center justify-between gap-4 border-b border-line/60 px-4 py-2.5 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-fg">{status.name}</p>
              <p className="truncate font-mono text-[11px] text-subtle">
                {status.config_path ?? "файл настроек не найден"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
                  status.configured
                    ? "bg-accent-soft text-accent"
                    : "border border-line text-subtle"
                }`}
              >
                {statusLabel(status)}
              </span>
              {!status.configured && (
                <button
                  type="button"
                  disabled={busy === status.id || !status.config_path}
                  onClick={() => void install(status.id)}
                  className="flex h-6 items-center rounded-control border border-line px-2 text-[11px] text-fg transition-colors hover:border-line-strong disabled:opacity-50"
                >
                  {busy === status.id ? "Добавление…" : "Подключить"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {notice && (
        <p className="border-t border-line px-4 py-2 text-[12px] text-muted">{notice}</p>
      )}
      <p className="border-t border-line px-4 py-2.5 text-[12px] leading-[18px] text-muted">
        При подключении в файл настроек клиента добавляется одна запись (рядом сохраняется
        резервная копия). Затем перезапустите клиент. Настройку вручную через JSON см. ниже.
      </p>
    </Card>
  );
}

function AgentsSection({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  const [configCopied, setConfigCopied] = useState(false);
  const [copiedRow, setCopiedRow] = useState<string | null>(null);

  const flashRow = (text: string) => {
    setCopiedRow(text);
    window.setTimeout(() => setCopiedRow((r) => (r === text ? null : r)), 1500);
  };

  return (
    <>
      <p className="pb-3 text-[12px] leading-[18px] text-muted">
        Разрешите ИИ-агентам искать по этому индексу. По умолчанию только чтение, локально, без интернета.
      </p>

      <AgentConnectCard />

      {/* MCP */}
      <Card title="Model Context Protocol">
        <div className="px-4 py-3">
          <p className="text-[12px] leading-[18px] text-muted">
            Укажите Claude Code, Cursor или другому MCP-клиенту программу{" "}
            <code className="font-mono text-[11px] text-fg">kensaku-cli</code>. Она использует
            папку данных этого приложения: подключается к работающей службе, а если службы нет,
            читает индекс в режиме только для чтения.
          </p>
        </div>
        <div className="relative border-t border-line bg-accent-soft p-3 pr-10">
          <pre className="select-text whitespace-pre-wrap break-all font-mono text-[11px] leading-[18px] text-muted">
            {MCP_CONFIG}
          </pre>
          <button
            type="button"
            title="Скопировать JSON настроек"
            onClick={() => {
              navigator.clipboard.writeText(MCP_CONFIG);
              setConfigCopied(true);
              window.setTimeout(() => setConfigCopied(false), 1500);
            }}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-subtle transition-colors hover:bg-elevated hover:text-fg"
          >
            {configCopied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-[12px] leading-[18px] text-muted">
          Если <code className="font-mono text-[11px] text-fg">kensaku-cli</code> нет в PATH,
          укажите полный путь к программе, например{" "}
          <code className="font-mono text-[11px] text-fg">~/.cargo/bin/kensaku-cli</code> или{" "}
          <code className="font-mono text-[11px] text-fg">target/release/kensaku-cli</code>.
        </p>
      </Card>

      {/* CLI */}
      <Card title="Командная строка">
        <div>
          {CLI_EXAMPLES.map((cmd) => (
            <CopyRow
              key={cmd}
              text={cmd}
              copied={copiedRow === cmd}
              onCopied={() => flashRow(cmd)}
            />
          ))}
        </div>
        <p className="border-t border-line px-4 py-2.5 text-[12px] leading-[18px] text-muted">
          Когда служба запущена, MCP-сервер передаёт запросы ей и сам базу не открывает.
          Без службы используется локальный индекс в режиме только для чтения.
        </p>
      </Card>

      {/* Tools */}
      <Card title="Инструменты MCP">
        <div className="px-4 py-1.5">
          {MCP_TOOLS.map(([name, args]) => (
            <div
              key={name}
              className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2.5 last:border-b-0"
            >
              <code className="shrink-0 whitespace-nowrap font-mono text-[11px] font-medium text-fg">
                {name}
              </code>
              <span className="min-w-0 truncate text-right font-mono text-[11px] text-subtle">
                {args}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Write access */}
      <Card title="Доступ на запись">
        <Field
          label="Разрешить переиндексацию через MCP"
          description="Добавляет агентам инструмент reindex. Нужна работающая служба; после изменения перезапустите MCP-клиенты."
        >
          <Switch
            checked={config.mcp_allow_reindex ?? false}
            onChange={(v) =>
              setConfig((c) => (c ? { ...c, mcp_allow_reindex: v } : c))
            }
          />
        </Field>
      </Card>

      {/* Security */}
      <Card title="Безопасность">
        <p className="p-4 text-[12px] leading-[18px] text-muted">
          По умолчанию только чтение. <code className="font-mono text-[11px] text-fg">reindex</code>
          выключен, пока его не включат выше. Нет доступа к командной оболочке и интернету.
          Учитываются отслеживаемые папки, исключения и разрешения службы.
        </p>
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* About + Danger zone                                               */
/* ---------------------------------------------------------------- */

const CONFIRM_WORD = "RESET";

/** Best-effort: the backend may not ship get_reset_pending yet. */
function useResetPending(): boolean {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    invoke<boolean>("get_reset_pending")
      .then(setPending)
      .catch(() => setPending(false));
  }, []);
  return pending;
}

/** Tracks keys the app persists in localStorage, so a reset starts clean. */
function clearClientState() {
  try {
    for (const key of ["kensaku.theme", "kensaku.view", "kensaku.preview"]) {
      localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable — the backend reset owns the rest */
  }
}

/**
 * Type-RESET confirmation. Traps focus, Esc cancels, Enter submits only
 * when the word matches exactly. On reject the error surfaces inline and
 * nothing is cleared; on resolve the app is expected to restart.
 */
function ResetDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const matches = text === CONFIRM_WORD;

  /* Window-level capture so Esc/Tab are handled before the settings
     overlay's own Escape-to-close listener sees them. */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>("input, button:not([disabled])"));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    const input = dialog.querySelector<HTMLInputElement>("input");
    input?.focus();
    input?.select();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const submit = async () => {
    if (!matches || running) return;
    setRunning(true);
    setError(null);
    try {
      await invoke("reset_all", { confirm: CONFIRM_WORD });
      // Resolves → the app restarts. Clear client-only view state so a
      // relaunched window comes up fresh; show nothing.
      clearClientState();
      onClose();
    } catch (err) {
      // Rejects → keep everything, surface the reason inline.
      console.error("reset_all failed:", err);
      setError(String(err));
      setRunning(false);
    }
  };

  return (
    <div
      className="fade-in absolute inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-[2px]"
      style={{ background: "var(--scrim)" }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Сброс программы"
        className="overlay-in elevated w-full max-w-[400px] overflow-hidden border-danger/30"
      >
        <div className="flex items-center justify-between border-b border-line bg-accent-soft px-4 py-2.5">
          <p className="text-[11px] font-medium text-danger">Опасная зона</p>
          <button
            type="button"
            title="Отмена (Esc)"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="p-4">
            <p className="text-[13px] font-semibold text-fg">Сброс программы</p>
            <p className="pt-0.5 text-[12px] leading-[18px] text-muted">
              Индекс и настройки будут удалены, программа перезапустится.
            </p>
          </div>

          <div className="px-4 pb-4">
            <label htmlFor="reset-confirm" className="eyebrow pb-1.5 block">
              Для подтверждения введите <span className="font-mono normal-case text-danger">RESET</span>
            </label>
            <input
              id="reset-confirm"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={`h-9 w-full rounded-control border bg-accent-soft px-2.5 font-mono text-[12px] text-fg outline-none transition-colors focus:border-accent ${
                text && !matches ? "border-danger/50" : "border-line"
              }`}
            />
            {error && (
              <p className="break-words pt-2 font-mono text-[11px] text-danger">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-1.5 border-t border-line bg-accent-soft px-3 py-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 items-center rounded-control border border-line px-3 text-[12px] text-fg transition-colors hover:border-line-strong"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!matches || running}
              className="flex h-8 items-center rounded-control bg-danger px-3 text-[12px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? "Сброс…" : "Сбросить и перезапустить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AboutSection() {
  const resetPending = useResetPending();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [version, setVersion] = useState<string>("…");

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        if (!cancelled) setVersion("неизвестна");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {resetPending && (
        <div className="flex items-center gap-2 rounded-control border border-warning/40 bg-elevated px-4 py-2.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
          <p className="text-[12px] text-muted">Сброс запланирован и завершится при следующем запуске.</p>
        </div>
      )}
      {resetPending && <div className="h-3" />}

      <Card title="Версия">
        <div className="flex items-center justify-between p-4">
          <div>
            <p className="text-[15px] font-semibold text-fg">
              Поиск по документам
            </p>
            <p className="font-mono text-[11px] text-subtle">{version}</p>
            <p className="mt-1 text-[11px] text-subtle">
              Автообновление пока не подключено, обновление выполняется вручную.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {["Rust", "Tauri 2", "MIT"].map((b) => (
              <span
                key={b}
                className="rounded-full border border-line px-2.5 py-1 font-mono text-[11px] text-muted"
              >
                {b}
              </span>
            ))}
          </div>
        </div>
        <div className="border-t border-line px-4 py-3">
          <span className="text-[11px] text-subtle">
            Обновляется вместе с программой «Мониторинг судебных дел». Сама программа в интернет не обращается.
          </span>
        </div>
      </Card>

      <Card title="Как пользоваться программой">
        <div className="space-y-2 p-4 text-[12px] leading-[18px] text-muted">
          <p className="text-fg">Несколько приёмов для быстрого поиска:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>Tab</b> показывает или скрывает панель сведений рядом с результатами.</li>
            <li><b>Синонимы</b> позволяют по слову «иск» находить и «исковое заявление».</li>
            <li><b>Фильтры</b>, например <code className="font-mono text-[11px] text-fg">type:pdf</code>, <code className="font-mono text-[11px] text-fg">ext:png</code>, <code className="font-mono text-[11px] text-fg">in:~/Projects</code>, <code className="font-mono text-[11px] text-fg">modified:&lt;7d</code>, сужают выдачу.</li>
            <li><b>/</b> открывает меню команд для быстрых действий: <code className="font-mono text-[11px] text-fg">/dupes</code>, <code className="font-mono text-[11px] text-fg">/doctor</code>, <code className="font-mono text-[11px] text-fg">/settings</code>.</li>
            <li><b>@</b> с именем папки - поиск внутри этой папки.</li>
            <li><b>Сортировка</b> и <b>сохранённые поиски</b> держат нужные запросы под рукой.</li>
            <li><b>Закрепите</b> важные файлы, чтобы они оставались на главном экране.</li>
            <li><b>OCR</b> распознаёт текст на изображениях и скриншотах.</li>
          </ul>
          <p>Все данные остаются на вашем компьютере и никуда не отправляются.</p>
        </div>
      </Card>

      <Card title="Идея">
        <div className="p-4 text-center">
          <p className="font-serif text-[15px] italic leading-[18px] text-muted">
            «Локальный индекс вашего компьютера только для чтения, который отвечает быстрее
            чем за 15 мс - вам и всем ИИ-агентам, с которыми вы работаете.»
          </p>
        </div>
      </Card>

      <Card title="Настройка">
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-fg">Повторить настройку</p>
            <p className="line-clamp-2 pt-0.5 text-[12px] leading-[18px] text-muted">
              Заново пройти мастер первой настройки (папки, параметры, дополнительные пакеты, первое
              сканирование). Индекс и настройки сохранятся.
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                await invoke("run_setup_again");
                window.location.reload();
              } catch (e) {
                console.error(e);
              }
            }}
            className="h-8 shrink-0 rounded-control border border-line px-3 text-[11px] font-medium text-fg transition-colors hover:border-line-strong"
          >
            Повторить настройку…
          </button>
        </div>
      </Card>

      {/* Danger zone — visually distinct but calm: danger hairline, no fills. */}
      <div>
        <p className="pb-2 text-[11px] font-medium text-danger">
          Опасная зона
        </p>
        <div className="overflow-hidden rounded-panel border border-danger/30 bg-elevated">
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg">Сброс программы</p>
              <p className="line-clamp-2 pt-0.5 text-[12px] leading-[18px] text-muted">
                Удаляет индекс, базу метаданных, загруженные модели и настройки. Отменить это
                нельзя.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="h-8 shrink-0 rounded-control border border-danger/40 px-3 text-[11px] font-medium text-danger transition-colors hover:bg-danger/10"
            >
              Сбросить всё…
            </button>
          </div>
        </div>
      </div>

      {confirmOpen && <ResetDialog onClose={() => setConfirmOpen(false)} />}
    </>
  );
}

/* A tiny rendering of the app in each finish: field, rule, three tiles.
   Colors are the real tokens, scoped by data-theme on the swatch. */
function ThemeSwatch({ value, active, onSelect }: { value: "light" | "dark"; active: boolean; onSelect: () => void }) {
  const label = { light: "Светлая", dark: "Тёмная" }[value];
  return (
    <button type="button" onClick={onSelect} aria-pressed={active} className="group flex flex-col gap-2.5 text-left outline-none">
      <span
        data-theme={value}
        className={`relative block aspect-[16/10] w-full overflow-hidden rounded-panel bg-bg transition-[outline-color,transform] duration-200 group-hover:-translate-y-0.5 ${
          active ? "outline-2 outline-offset-[3px] outline-ink" : "outline-0"
        }`}
        style={{ outlineStyle: active ? "solid" : "none", boxShadow: "inset 0 0 0 1px var(--border)" }}
      >
        <span className="absolute bottom-3 left-3 right-3 top-9 grid grid-cols-3 gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className="block rounded-small"
              style={{
                background: i % 3 === 1 ? "var(--fg-subtle)" : "var(--bg-elevated)",
                opacity: i % 3 === 1 ? 0.5 : 1,
                boxShadow: "var(--panel-edge)",
              }}
            />
          ))}
        </span>
        <span className="control absolute left-3 right-3 top-2.5 flex h-5 items-center rounded-full px-2">
          <span className="h-1 w-1/3 rounded-full bg-fg opacity-70" />
        </span>
      </span>
      <span className={`px-0.5 text-[13px] ${active ? "font-medium text-fg" : "text-muted"}`}>{label}</span>
    </button>
  );
}
