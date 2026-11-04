import { useEffect } from "react";
import { X } from "lucide-react";

const KEYS: [string, string][] = [
  ["Alt+Space", "показать или скрыть окно"],
  ["↑ ↓", "перейти к результатам и по ним"],
  ["← →", "перемещение по строке результатов"],
  ["Space", "просмотр выбранного результата"],
  ["⌘/Ctrl+Y", "просмотр из любого места"],
  ["Enter", "открыть выбранный файл"],
  ["Shift+Enter", "показать в папке"],
  ["⌘/Ctrl+C", "скопировать путь (если не выделен текст)"],
  ["⌘/Ctrl+I", "сведения о выбранном файле"],
  ["⌘/Ctrl+,", "настройки"],
  ["?", "эта справка"],
  ["Esc", "закрыть окно, очистить поиск, затем скрыть"],
];

const FILTERS: [string, string][] = [
  ["type:pdf", "категория или расширение"],
  ["ext:rs", "точное расширение"],
  ["in:~/Projects", "искать в папке"],
  ["path:src", "часть пути"],
  ["modified:7d", "изменён за 7 дней (1h, 30d, 7d..30d)"],
  ["size:>2mb", "диапазон размера (kb, mb, gb)"],
  ["is:image, is:dir", "короткие имена категорий"],
  ["lang:rust", "язык программирования по расширению"],
  ["name:config", "только по имени файла"],
  ["content:timeout", "только по содержимому"],
  ["re:\"fn \\\\w+\"", "регулярное выражение"],
  ['"last Tuesday"', "фильтр по дате на естественном языке (по-английски)"],
  ["mouse near[5] button", "слова не дальше 5 слов друг от друга"],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6 backdrop-blur-[6px]">
      <div className="elevated overlay-in max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-sheet p-6">
        <div className="flex items-center justify-between pb-3">
          <h2 className="t-title text-fg">Как искать</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon h-8 !rounded-full"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <section className="pb-4">
          <h3 className="t-meta pb-2 pt-4 text-subtle">Клавиши</h3>
          <table className="w-full">
            <tbody>
              {KEYS.map(([k, v]) => (
                <tr key={k} className="border-t border-line">
                  <td className="t-meta py-2 pr-6 text-fg">{k}</td>
                  <td className="py-2 text-[13px] text-muted">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3 className="t-meta pb-2 pt-4 text-subtle">Фильтры</h3>
          <table className="w-full">
            <tbody>
              {FILTERS.map(([k, v]) => (
                <tr key={k} className="border-t border-line">
                  <td className="t-meta py-2 pr-6 text-fg">{k}</td>
                  <td className="py-2 text-[13px] text-muted">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
