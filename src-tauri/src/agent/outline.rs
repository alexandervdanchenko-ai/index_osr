//! index_osr: document outline (table of contents) for agents.
//!
//! The idea of PageIndex (navigate a long document through its structure
//! instead of reading it front to back), done locally and without a model:
//! the structure is recognised by rules from the document's own text, and the
//! agent (Claude) does the reasoning about which section to open.
//!
//! Recognised, in order of precedence on a line:
//! * page markers produced by extraction (`--- Page N ---`), used for page
//!   ranges, never as sections;
//! * Markdown headings (`#`, `##`, ...);
//! * parts of legislation: `Раздел`, `Подраздел`, `Глава`, `Статья`, `§`;
//! * document kinds of Russian procedure and practice (РЕШЕНИЕ, ОПРЕДЕЛЕНИЕ,
//!   ИСКОВОЕ ЗАЯВЛЕНИЕ, ДОГОВОР, ПРИКАЗ, ...), including letter-spaced
//!   «Р Е Ш Е Н И Е»;
//! * the operative markers of court acts and pleadings (УСТАНОВИЛ,
//!   РЕШИЛ, ОПРЕДЕЛИЛ, ПОСТАНОВИЛ, ПРОШУ, Приложение ...);
//! * numbered headings (`I.`, `1.`, `1.1.`) and short ALL-CAPS lines.
//!
//! Without any heading the document is divided by pages, or into fixed parts.

use serde::Serialize;

/// Longest line still treated as a heading.
const MAX_HEADING_CHARS: usize = 90;
/// Size of fallback parts when a document has neither headings nor pages.
const FALLBACK_PART_CHARS: usize = 8_000;
/// Characters of section text shown as a preview in the outline.
const PREVIEW_CHARS: usize = 160;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Section {
    /// Stable id within this text: "1", "2", ... in document order.
    pub id: String,
    /// 1 = document / part, 2 = chapter / operative part, 3 = article / item.
    pub level: u8,
    pub title: String,
    /// Character offsets (not bytes) of the section, including subsections.
    pub start: usize,
    pub end: usize,
    pub page_start: Option<u32>,
    pub page_end: Option<u32>,
    pub chars: usize,
    pub preview: String,
}

/// Builds the outline of `text`.
pub fn outline(text: &str) -> Vec<Section> {
    let chars: Vec<char> = text.chars().collect();
    let total = chars.len();
    let lines = lines_with_offsets(&chars);
    let pages = page_marks(&lines);

    let mut heads: Vec<(usize, u8, String)> = Vec::new(); // (start char, level, title)
    for (start, line) in &lines {
        if page_number(line).is_some() {
            continue;
        }
        if let Some((level, title)) = classify(line) {
            heads.push((*start, level, title));
        }
    }

    let mut sections: Vec<Section> = if heads.is_empty() {
        fallback_parts(&chars, &pages)
    } else {
        // Text before the first heading (court name, parties, a header block).
        let mut list = Vec::new();
        if heads[0].0 > 0 && !blank(&chars[..heads[0].0]) {
            list.push((0usize, 1u8, "Начало документа".to_string()));
        }
        list.extend(heads);
        let mut out = Vec::with_capacity(list.len());
        for (i, (start, level, title)) in list.iter().enumerate() {
            let end = list[i + 1..]
                .iter()
                .find(|(_, l, _)| l <= level)
                .map(|(s, _, _)| *s)
                .unwrap_or(total);
            out.push(make_section(&chars, &pages, *start, end, *level, title.clone()));
        }
        out
    };
    for (index, section) in sections.iter_mut().enumerate() {
        section.id = (index + 1).to_string();
    }
    sections
}

/// The text of one section (with its subsections), by id.
pub fn section_text(text: &str, id: &str) -> Option<(Section, String)> {
    let section = outline(text).into_iter().find(|s| s.id == id.trim())?;
    let body: String = text.chars().skip(section.start).take(section.end - section.start).collect();
    Some((section, body))
}

fn make_section(
    chars: &[char],
    pages: &[(usize, u32)],
    start: usize,
    end: usize,
    level: u8,
    title: String,
) -> Section {
    let body: String = chars[start..end].iter().collect();
    let first_line_len = body.find('\n').map(|i| body[..i].chars().count()).unwrap_or(0);
    let preview: String = body
        .chars()
        .skip(first_line_len)
        .collect::<String>()
        .split_whitespace()
        .filter(|w| !w.starts_with("---") && *w != "Page")
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(PREVIEW_CHARS)
        .collect();
    Section {
        id: String::new(),
        level,
        title,
        start,
        end,
        page_start: page_at(pages, start),
        page_end: page_at(pages, end.saturating_sub(1).max(start)),
        chars: end - start,
        preview,
    }
}

fn blank(chars: &[char]) -> bool {
    chars.iter().all(|c| c.is_whitespace())
}

fn lines_with_offsets(chars: &[char]) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut current = String::new();
    for (i, ch) in chars.iter().enumerate() {
        if *ch == '\n' {
            out.push((start, std::mem::take(&mut current)));
            start = i + 1;
        } else {
            current.push(*ch);
        }
    }
    if !current.is_empty() {
        out.push((start, current));
    }
    out
}

/// `--- Page N ---` markers written by PDF extraction and OCR.
fn page_number(line: &str) -> Option<u32> {
    let t = line.trim();
    let inner = t.strip_prefix("--- Page ")?.strip_suffix(" ---")?;
    inner.trim().parse().ok()
}

/// (char offset where the page starts, page number). The text before the
/// first marker is page 1 when markers exist.
fn page_marks(lines: &[(usize, String)]) -> Vec<(usize, u32)> {
    let mut marks: Vec<(usize, u32)> = lines
        .iter()
        .filter_map(|(start, line)| page_number(line).map(|n| (*start, n)))
        .collect();
    if !marks.is_empty() && marks[0].0 > 0 {
        marks.insert(0, (0, 1));
    }
    marks
}

fn page_at(pages: &[(usize, u32)], offset: usize) -> Option<u32> {
    pages.iter().rev().find(|(start, _)| *start <= offset).map(|(_, n)| *n)
}

fn fallback_parts(chars: &[char], pages: &[(usize, u32)]) -> Vec<Section> {
    let total = chars.len();
    if total == 0 {
        return Vec::new();
    }
    if pages.len() > 1 {
        return pages
            .iter()
            .enumerate()
            .map(|(i, (start, page))| {
                let end = pages.get(i + 1).map(|(s, _)| *s).unwrap_or(total);
                make_section(chars, pages, *start, end, 1, format!("Страница {page}"))
            })
            .collect();
    }
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut part = 1usize;
    while start < total {
        let mut end = (start + FALLBACK_PART_CHARS).min(total);
        // Prefer to cut at a paragraph or line break near the boundary.
        if end < total
            && let Some(cut) = (start + FALLBACK_PART_CHARS / 2..end).rev().find(|&i| chars[i] == '\n')
        {
            end = cut + 1;
        }
        out.push(make_section(chars, pages, start, end, 1, format!("Часть {part}")));
        start = end;
        part += 1;
    }
    out
}

/// Decides whether a line is a heading and at which level.
fn classify(raw: &str) -> Option<(u8, String)> {
    let line = raw.trim();
    if line.is_empty() || line.chars().count() > MAX_HEADING_CHARS {
        return None;
    }
    let title = || line.trim_end_matches(':').trim().to_string();

    // Markdown.
    if let Some(rest) = line.strip_prefix('#') {
        let hashes = 1 + rest.chars().take_while(|c| *c == '#').count();
        let text = line.trim_start_matches('#').trim();
        if !text.is_empty() && hashes <= 6 && line.chars().nth(hashes) == Some(' ') {
            return Some(((hashes as u8).min(3), text.to_string()));
        }
    }

    let lower = line.to_lowercase();
    // Legislation and long structured documents.
    for (prefix, level) in [("раздел ", 1u8), ("подраздел ", 1), ("глава ", 2), ("статья ", 3), ("§ ", 3)] {
        if let Some(rest) = lower.strip_prefix(prefix)
            && rest.chars().next().is_some_and(|c| c.is_ascii_digit() || "ivxlcm".contains(c))
        {
            return Some((level, title()));
        }
    }

    let compact = compact_upper(line);
    // A document title is the bare kind («РЕШЕНИЕ»), a capitalised title
    // («ТРУДОВОЙ ДОГОВОР № 15», «ИСКОВОЕ ЗАЯВЛЕНИЕ О ВОССТАНОВЛЕНИИ НА РАБОТЕ»)
    // or the kind with a number («Приказ № 47-к»), never a sentence that
    // merely starts with the word («Решение может быть обжаловано ...»).
    let no_lowercase = !line.chars().any(|c| c.is_lowercase());
    if DOCUMENT_KINDS.iter().any(|kind| {
        compact == *kind
            || (no_lowercase && compact.starts_with(&format!("{kind} ")))
            || compact.starts_with(&format!("{kind} №"))
    }) {
        return Some((1, title()));
    }
    if OPERATIVE.iter().any(|word| compact == *word) {
        return Some((2, title()));
    }
    if lower.starts_with("приложени") && line.chars().count() <= 40 {
        return Some((2, title()));
    }

    if let Some(level) = numbered_heading(line) {
        return Some((level, title()));
    }
    if all_caps_heading(line) {
        return Some((2, title()));
    }
    None
}

/// Upper-cases and collapses letter-spacing: «Р Е Ш Е Н И Е» -> «РЕШЕНИЕ»,
/// «У С Т А Н О В И Л :» -> «УСТАНОВИЛ».
fn compact_upper(line: &str) -> String {
    let upper = line.trim().trim_end_matches([':', '.', ';']).trim().to_uppercase();
    let tokens: Vec<&str> = upper.split_whitespace().collect();
    if tokens.len() >= 4 && tokens.iter().all(|t| t.chars().count() == 1) {
        return tokens.concat();
    }
    tokens.join(" ")
}

const DOCUMENT_KINDS: &[&str] = &[
    "РЕШЕНИЕ", "ЗАОЧНОЕ РЕШЕНИЕ", "ОПРЕДЕЛЕНИЕ", "АПЕЛЛЯЦИОННОЕ ОПРЕДЕЛЕНИЕ", "КАССАЦИОННОЕ ОПРЕДЕЛЕНИЕ",
    "ПОСТАНОВЛЕНИЕ", "ПРИГОВОР", "СУДЕБНЫЙ ПРИКАЗ", "ИСКОВОЕ ЗАЯВЛЕНИЕ", "АДМИНИСТРАТИВНОЕ ИСКОВОЕ ЗАЯВЛЕНИЕ",
    "ЗАЯВЛЕНИЕ", "АПЕЛЛЯЦИОННАЯ ЖАЛОБА", "КАССАЦИОННАЯ ЖАЛОБА", "ЧАСТНАЯ ЖАЛОБА", "ЖАЛОБА", "ХОДАТАЙСТВО",
    "ВОЗРАЖЕНИЯ", "ОТЗЫВ", "ПРЕТЕНЗИЯ", "ПРИКАЗ", "РАСПОРЯЖЕНИЕ", "ДОГОВОР", "ТРУДОВОЙ ДОГОВОР",
    "ДОПОЛНИТЕЛЬНОЕ СОГЛАШЕНИЕ", "СОГЛАШЕНИЕ", "ПРОТОКОЛ", "ПРОТОКОЛ СУДЕБНОГО ЗАСЕДАНИЯ", "ЗАКЛЮЧЕНИЕ",
    "ЗАКЛЮЧЕНИЕ ЭКСПЕРТА", "АКТ", "СПРАВКА", "ДОВЕРЕННОСТЬ", "ПОЛОЖЕНИЕ", "ИНСТРУКЦИЯ", "ПРАВИЛА",
    "УВЕДОМЛЕНИЕ", "ТРЕБОВАНИЕ", "ОБЪЯСНЕНИЕ", "ОБЪЯСНИТЕЛЬНАЯ", "СЛУЖЕБНАЯ ЗАПИСКА", "ДОКЛАДНАЯ ЗАПИСКА",
    "ИСПОЛНИТЕЛЬНЫЙ ЛИСТ", "РАСЧЕТ", "РАСЧЁТ",
];

const OPERATIVE: &[&str] = &[
    "УСТАНОВИЛ", "УСТАНОВИЛА", "РЕШИЛ", "РЕШИЛА", "ОПРЕДЕЛИЛ", "ОПРЕДЕЛИЛА", "ПОСТАНОВИЛ", "ПОСТАНОВИЛА",
    "ПРИГОВОРИЛ", "ПРИГОВОРИЛА", "ОПРЕДЕЛИЛА СУДЕБНАЯ КОЛЛЕГИЯ", "ПРОШУ", "ПРОСИМ", "ПРОШУ СУД", "ПРИКАЗЫВАЮ",
    "УСТАНОВИЛ СУД", "ОПИСАТЕЛЬНАЯ ЧАСТЬ", "МОТИВИРОВОЧНАЯ ЧАСТЬ", "РЕЗОЛЮТИВНАЯ ЧАСТЬ",
    "МОТИВИРОВАННОЕ РЕШЕНИЕ", "ОБСТОЯТЕЛЬСТВА ДЕЛА", "ВЫВОДЫ", "ПРЕДМЕТ ДОГОВОРА",
];

/// `I. Общие положения`, `1. Предмет договора`, `1.1. Работник обязуется`:
/// short, starts with a number, text starts with a capital letter, does not
/// end like a list item or a sentence in the middle of a pleading.
fn numbered_heading(line: &str) -> Option<u8> {
    let (num, rest) = line.split_once(' ')?;
    let rest = rest.trim();
    let first = rest.chars().next()?;
    if !first.is_uppercase() || rest.ends_with([';', ',']) || rest.chars().count() > 70 {
        return None;
    }
    let num = num.trim_end_matches(')');
    let roman = num.trim_end_matches('.');
    if num.ends_with('.') && !roman.is_empty() && roman.chars().all(|c| "IVXLC".contains(c)) {
        return Some(1);
    }
    let parts: Vec<&str> = num.trim_end_matches('.').split('.').collect();
    if parts.iter().all(|p| !p.is_empty() && p.len() <= 3 && p.chars().all(|c| c.is_ascii_digit()))
        && (num.ends_with('.') || parts.len() > 1)
    {
        // A numbered paragraph of a pleading is a long sentence; a heading
        // is short and has no final period inside it.
        if rest.chars().count() > 60 && rest.ends_with('.') {
            return None;
        }
        return Some(if parts.len() == 1 { 2 } else { 3 });
    }
    None
}

/// A short line of capitals (at least two words of letters): «ОБСТОЯТЕЛЬСТВА
/// ДЕЛА», «ПРАВА И ОБЯЗАННОСТИ СТОРОН». Organisation names in quotes and lines
/// with many digits are not headings.
fn all_caps_heading(line: &str) -> bool {
    if line.contains(['«', '"', '»']) {
        return false;
    }
    let letters: Vec<char> = line.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.len() < 8 || letters.iter().any(|c| c.is_lowercase()) {
        return false;
    }
    let digits = line.chars().filter(|c| c.is_ascii_digit()).count();
    let words = line.split_whitespace().filter(|w| w.chars().filter(|c| c.is_alphabetic()).count() >= 2).count();
    words >= 2 && digits * 3 < letters.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DECISION: &str = "Дело № 2-1234/2026\n\
Тушинский районный суд г. Москвы\n\
\n\
Р Е Ш Е Н И Е\n\
Именем Российской Федерации\n\
\n\
12 марта 2026 года суд в составе председательствующего судьи Иванова И.И. рассмотрел дело.\n\
\n\
У С Т А Н О В И Л :\n\
\n\
Истец обратился в суд с иском о восстановлении на работе. Приказом № 47-к он уволен за прогул.\n\
--- Page 2 ---\n\
Суд, выслушав стороны, исследовав материалы дела, приходит к выводу, что иск подлежит удовлетворению.\n\
\n\
Р Е Ш И Л :\n\
\n\
Восстановить истца на работе в должности инженера.\n\
Решение может быть обжаловано в течение месяца.\n";

    #[test]
    fn court_decision_parts_are_recognised() {
        let toc = outline(DECISION);
        let titles: Vec<(&str, u8)> = toc.iter().map(|s| (s.title.as_str(), s.level)).collect();
        assert_eq!(
            titles,
            vec![
                ("Начало документа", 1),
                ("Р Е Ш Е Н И Е", 1),
                ("У С Т А Н О В И Л", 2),
                ("Р Е Ш И Л", 2),
            ]
        );
        // РЕШЕНИЕ spans to the end, including its operative parts.
        let decision = &toc[1];
        assert_eq!(decision.end, DECISION.chars().count());
        assert_eq!(decision.page_start, Some(1));
        assert_eq!(decision.page_end, Some(2));
        let (_, body) = section_text(DECISION, &toc[2].id).unwrap();
        assert!(body.contains("уволен за прогул") && body.contains("подлежит удовлетворению"));
        assert!(!body.contains("Восстановить истца"));
        let (s, body) = section_text(DECISION, "4").unwrap();
        assert!(body.contains("Восстановить истца") && s.page_start == Some(2));
    }

    #[test]
    fn labour_code_chapters_and_articles_nest() {
        let text = "Глава 13. Прекращение трудового договора\n\
Статья 77. Общие основания прекращения трудового договора\n\
Основаниями прекращения трудового договора являются:\n\
1) соглашение сторон;\n\
Статья 81. Расторжение трудового договора по инициативе работодателя\n\
Трудовой договор может быть расторгнут работодателем в случаях:\n\
6) однократного грубого нарушения работником трудовых обязанностей:\n\
а) прогула;\n\
Глава 14. Защита персональных данных работника\n\
Статья 85. Понятие персональных данных работника\n";
        let toc = outline(text);
        let levels: Vec<u8> = toc.iter().map(|s| s.level).collect();
        assert_eq!(levels, vec![2, 3, 3, 2, 3]);
        let (_, art81) = section_text(text, &toc[2].id).unwrap();
        assert!(art81.contains("прогула") && !art81.contains("Глава 14"));
        let (_, ch13) = section_text(text, &toc[0].id).unwrap();
        assert!(ch13.contains("Статья 77") && ch13.contains("Статья 81") && !ch13.contains("Статья 85"));
    }

    #[test]
    fn contract_numbered_headings_but_not_pleading_items() {
        let text = "ТРУДОВОЙ ДОГОВОР № 15\n\
1. Предмет договора\n\
1.1. Работник принимается на должность менеджера.\n\
2. Права и обязанности сторон\n\
2.1. Работник обязан добросовестно исполнять обязанности.\n\
ПРОШУ:\n\
1. Признать увольнение незаконным и восстановить истца на работе в прежней должности с 12 марта 2026 года.\n\
2. Взыскать с ответчика средний заработок за время вынужденного прогула;\n";
        let titles: Vec<String> = outline(text).into_iter().map(|s| s.title).collect();
        assert!(titles.contains(&"1. Предмет договора".to_string()));
        assert!(titles.contains(&"2. Права и обязанности сторон".to_string()));
        assert!(titles.contains(&"ПРОШУ".to_string()));
        assert!(!titles.iter().any(|t| t.contains("Признать увольнение")));
        assert!(!titles.iter().any(|t| t.contains("Взыскать")));
    }

    #[test]
    fn organisation_names_in_capitals_are_not_headings() {
        assert!(!all_caps_heading("ООО «ИНЖСИСТЕМС»"));
        assert!(!all_caps_heading("ИНН 7701234567 ОГРН 1027700132195"));
        assert!(all_caps_heading("ОБСТОЯТЕЛЬСТВА ДЕЛА"));
    }

    #[test]
    fn scans_without_headings_are_split_by_page() {
        let text = "текст первой страницы\n--- Page 2 ---\nтекст второй\n--- Page 3 ---\nтекст третьей";
        let toc = outline(text);
        let titles: Vec<&str> = toc.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["Страница 1", "Страница 2", "Страница 3"]);
        assert_eq!(section_text(text, "2").unwrap().1.trim(), "--- Page 2 ---\nтекст второй");
    }

    #[test]
    fn long_plain_text_is_split_into_parts_at_line_breaks() {
        let line = "обычный абзац без заголовков и без страниц.\n";
        let text = line.repeat(500);
        let toc = outline(&text);
        assert!(toc.len() >= 2 && toc[0].title == "Часть 1");
        assert_eq!(toc.last().unwrap().end, text.chars().count());
        assert!(toc.windows(2).all(|w| w[0].end == w[1].start));
        let body = section_text(&text, "1").unwrap().1;
        assert!(body.ends_with('\n'));
    }

    #[test]
    fn markdown_headings() {
        let toc = outline("# Анализ дела\nвступление\n## Позиция истца\nтекст\n## Риски\nтекст");
        let t: Vec<(&str, u8)> = toc.iter().map(|s| (s.title.as_str(), s.level)).collect();
        assert_eq!(t, vec![("Анализ дела", 1), ("Позиция истца", 2), ("Риски", 2)]);
    }

    #[test]
    fn unknown_section_is_none() {
        assert!(section_text(DECISION, "99").is_none());
        assert!(outline("").is_empty());
    }
}
