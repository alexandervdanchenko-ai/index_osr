//! Deterministic natural-language intent compilation.
//!
//! Small, local, explainable rules map common phrasings ("latest resume",
//! "screenshots from last week", "big videos in Projects") onto the existing
//! query grammar plus an explicit sort. No model, no network, no silent
//! rewrites: every emitted filter is returned as a removable chip.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterpretationChip {
    /// "type" | "time" | "size" | "sort" | "place"
    pub kind: String,
    pub label: String,
    /// The filter token appended to the query, e.g. `type:image`.
    pub raw: String,
    /// The words in the user's input that produced this chip.
    pub source: String,
}

#[derive(Debug, Clone, Default)]
pub struct Intent {
    /// Query with intent phrases removed and filters appended.
    pub query: String,
    /// Explicit sort requested by language, if any.
    pub sort: Option<String>,
    pub chips: Vec<InterpretationChip>,
}

fn take(
    work: &mut String,
    re: &Regex,
    kind: &str,
    label: &str,
    raw: &str,
    appends: &mut Vec<String>,
    chips: &mut Vec<InterpretationChip>,
) {
    if let Some(m) = re.find(work) {
        let source = m.as_str().trim().to_string();
        *work = format!("{} {}", &work[..m.start()], &work[m.end()..]);
        appends.push(raw.to_string());
        chips.push(InterpretationChip {
            kind: kind.to_string(),
            label: label.to_string(),
            raw: raw.to_string(),
            source,
        });
    }
}

/// Compiles natural language into the existing query grammar.
pub fn compile(raw: &str) -> Intent {
    compile_with_aliases(raw, &[])
}

/// Compiles natural language, expanding personal vocabulary aliases into an
/// OR-regex term (e.g. `resume` → `re:"(?i)(resume|cv)"`).
pub fn compile_with_aliases(raw: &str, aliases: &[(String, Vec<String>)]) -> Intent {
    // Explicit grammar is authoritative: never reinterpret a query that
    // already contains a filter token.
    let has_explicit_filter = raw
        .split_whitespace()
        .any(|t| t.contains(':') && !t.starts_with("http") && !t.starts_with("https"));

    let mut work = raw.to_string();
    let mut appends: Vec<String> = Vec::new();
    let mut chips: Vec<InterpretationChip> = Vec::new();
    let mut sort: Option<String> = None;

    if !has_explicit_filter {
        // --- Sort words -------------------------------------------------
        for (pat, order, label) in [
            (r"(?i)\b(?:latest|newest|most recent)\b", "newest", "сначала новые"),
            (r"(?i)\boldest\b", "oldest", "сначала старые"),
            (r"(?i)\b(?:biggest|largest)\b", "largest", "сначала крупные"),
        ] {
            if sort.is_none()
                && let Ok(re) = Regex::new(pat)
                && re.is_match(&work)
            {
                let source = re
                    .find(&work)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
                work = re.replace(&work, " ").to_string();
                sort = Some(order.to_string());
                chips.push(InterpretationChip {
                    kind: "sort".to_string(),
                    label: format!("Сортировка: {}", label),
                    raw: format!("sort:{}", order),
                    source,
                });
            }
        }

        // --- Time windows ----------------------------------------------
        for (pat, filter, label) in [
            (r"(?i)\btoday\b", "modified:<1d", "Изменён: сегодня"),
            (
                r"(?i)\byesterday\b",
                "modified:1d..2d",
                "Изменён: вчера",
            ),
            (
                r"(?i)\b(?:this|last|past) week\b",
                "modified:<7d",
                "Изменён: за 7 дней",
            ),
            (
                r"(?i)\b(?:this|last|past) month\b",
                "modified:<30d",
                "Изменён: за 30 дней",
            ),
            (
                r"(?i)\b(?:this|last|past) year\b",
                "modified:<365d",
                "Изменён: за год",
            ),
        ] {
            if let Ok(re) = Regex::new(pat) {
                take(
                    &mut work,
                    &re,
                    "time",
                    label,
                    filter,
                    &mut appends,
                    &mut chips,
                );
            }
        }

        // --- Time travel: weekday and "N days ago" ---------------------
        // "last Tuesday" is the most recent Tuesday before today. "N days ago"
        // is that day. Both become a one-day window and a removable chip.
        for (pat, days_fn, label) in [
            (
                r"(?i)\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
                weekday_days_back as fn(&str, u32) -> Option<u32>,
                "weekday",
            ),
            (
                r"(?i)\b(\d{1,3})\s+days?\s+ago\b",
                days_ago_days as fn(&str, u32) -> Option<u32>,
                "days_ago",
            ),
        ] {
            if let Ok(re) = Regex::new(pat)
                && let Some(m) = re.captures(&work)
            {
                let whole = m.get(0).map(|x| x.as_str().to_string()).unwrap_or_default();
                let arg = m.get(1).map(|x| x.as_str()).unwrap_or("");
                let weekday_today = chrono_weekday_today();
                if let Some(back) = days_fn(arg, weekday_today) {
                    let filter = format!("modified:{}d..{}d", back, back + 1);
                    let shown = if label == "weekday" {
                        format!("Изменён: {}", weekday_ru(arg))
                    } else {
                        format!("Изменён: {} дн. назад", arg)
                    };
                    work = work.replacen(&whole, " ", 1);
                    appends.push(filter.clone());
                    chips.push(InterpretationChip {
                        kind: "time".to_string(),
                        label: shown,
                        raw: filter,
                        source: whole,
                    });
                }
            }
        }

        // --- Size -------------------------------------------------------
        if let Ok(re) =
            Regex::new(r"(?i)\b(?:under|less than|smaller than)\s+(\d+(?:\.\d+)?)\s*(kb|mb|gb)\b")
            && let Some(c) = re.captures(&work)
        {
            let number = c[1].to_string();
            let unit = c[2].to_string();
            let raw = format!("size:<{}{}", number, unit.to_lowercase());
            let source = c.get(0).map(|m| m.as_str().to_string()).unwrap_or_default();
            work = re.replace(&work, " ").to_string();
            appends.push(raw.clone());
            chips.push(InterpretationChip {
                kind: "size".to_string(),
                label: format!("Размер: меньше {} {}", number, size_unit_ru(&unit)),
                raw,
                source,
            });
        }
        if let Ok(re) = Regex::new(
            r"(?i)\b(?:over|more than|larger than|bigger than)\s+(\d+(?:\.\d+)?)\s*(kb|mb|gb)\b",
        ) && let Some(c) = re.captures(&work)
        {
            let number = c[1].to_string();
            let unit = c[2].to_string();
            let raw = format!("size:>{}{}", number, unit.to_lowercase());
            let source = c.get(0).map(|m| m.as_str().to_string()).unwrap_or_default();
            work = re.replace(&work, " ").to_string();
            appends.push(raw.clone());
            chips.push(InterpretationChip {
                kind: "size".to_string(),
                label: format!("Размер: больше {} {}", number, size_unit_ru(&unit)),
                raw,
                source,
            });
        }
        for (pat, filter, label) in [
            (
                r"(?i)\b(?:huge|big|large)\b",
                "size:>100mb",
                "Размер: больше 100 МБ",
            ),
            (r"(?i)\b(?:tiny|small)\b", "size:<1mb", "Размер: меньше 1 МБ"),
        ] {
            if let Ok(re) = Regex::new(pat) {
                take(
                    &mut work,
                    &re,
                    "size",
                    label,
                    filter,
                    &mut appends,
                    &mut chips,
                );
            }
        }

        // --- Visual search intent --------------------------------------
        for pat in [r"(?i)\b(?:visual search|search visually for|visually)\b"] {
            if let Ok(re) = Regex::new(pat)
                && re.is_match(&work)
            {
                let source = re
                    .find(&work)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
                work = re.replace(&work, " ").to_string();
                appends.push("type:image".to_string());
                chips.push(InterpretationChip {
                    kind: "visual".to_string(),
                    label: "Поиск по виду: изображения".to_string(),
                    raw: "type:image".to_string(),
                    source,
                });
                break;
            }
        }

        // --- Media / document nouns ------------------------------------
        for (pat, filter, label) in [
            (
                r"(?i)\b(?:screenshots?|images?|photos?|pictures?)\b",
                "type:image",
                "Тип: изображения",
            ),
            (r"(?i)\bpdfs?\b", "ext:pdf", "Тип: PDF"),
            (
                r"(?i)\b(?:videos?|movies?|clips?)\b",
                "type:media",
                "Тип: видео и аудио",
            ),
            (
                r"(?i)\b(?:audio|music|songs?)\b",
                "type:media",
                "Тип: видео и аудио",
            ),
            (r"(?i)\b(?:code|source)\b", "type:code", "Тип: исходный код"),
            (
                r"(?i)\b(?:documents?|docs?)\b",
                "type:doc",
                "Тип: документы",
            ),
            (
                r"(?i)\b(?:spreadsheets?|excel)\b",
                "type:doc",
                "Тип: документы",
            ),
            (
                r"(?i)\b(?:presentations?|slides?)\b",
                "type:doc",
                "Тип: документы",
            ),
            (
                r"(?i)\b(?:folders?|directories|directory)\b",
                "type:dir",
                "Тип: папки",
            ),
            (
                r"(?i)\b(?:archives?|zips?)\b",
                "type:archive",
                "Тип: архивы",
            ),
            (r"(?i)\blogs?\b", "ext:log", "Тип: журналы"),
        ] {
            if let Ok(re) = Regex::new(pat) {
                take(
                    &mut work,
                    &re,
                    "type",
                    label,
                    filter,
                    &mut appends,
                    &mut chips,
                );
            }
        }

        // --- Place ------------------------------------------------------
        if let Ok(re) = Regex::new(
            r"(?i)\bin\s+(?:my\s+)?(projects|downloads|documents|desktop|pictures|videos|music|work)\b",
        ) {
            // --- Personal vocabulary ----------------------------------
            for (term, expansions) in aliases {
                let term = term.trim();
                if term.is_empty() {
                    continue;
                }
                let Ok(re) = Regex::new(&format!(r"(?i)\b{}\b", regex::escape(term))) else {
                    continue;
                };
                if !re.is_match(&work) {
                    continue;
                }
                let mut words = vec![term.to_lowercase()];
                for exp in expansions {
                    let exp = exp.trim().to_lowercase();
                    if !exp.is_empty() && !words.contains(&exp) {
                        words.push(exp);
                    }
                }
                let alternation = words
                    .iter()
                    .map(|w| regex::escape(w))
                    .collect::<Vec<_>>()
                    .join("|");
                let raw = format!("re:\"(?i)({})\"", alternation);
                work = re.replace(&work, " ").to_string();
                appends.push(raw.clone());
                chips.push(InterpretationChip {
                    kind: "alias".to_string(),
                    label: format!("Синоним: {}", term),
                    raw,
                    source: term.to_string(),
                });
            }
            if let Some(c) = re.captures(&work) {
                let place = c[1].to_string();
                let raw = format!("in:{}", place);
                let source = c.get(0).map(|m| m.as_str().to_string()).unwrap_or_default();
                work = re.replace(&work, " ").to_string();
                appends.push(raw.clone());
                chips.push(InterpretationChip {
                    kind: "place".to_string(),
                    label: format!("В папке: {}", place),
                    raw,
                    source,
                });
            }
        }
    }

    if chips.is_empty() {
        return Intent {
            query: raw.to_string(),
            sort: None,
            chips: Vec::new(),
        };
    }

    // Drop connective filler left behind once the intent words are removed.
    if let Ok(re) = Regex::new(r"(?i)\b(?:from|the|a|an|my|me|show|find|get|give|all|some|of)\b") {
        work = re.replace_all(&work, " ").to_string();
    }

    let mut query = work.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut seen = HashSet::new();
    for token in appends {
        if seen.insert(token.clone()) {
            if !query.is_empty() {
                query.push(' ');
            }
            query.push_str(&token);
        }
    }

    if query.trim().is_empty() {
        query = raw.to_string();
    }

    Intent { query, sort, chips }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latest_resume_becomes_newest_sort() {
        let intent = compile("latest resume");
        assert_eq!(intent.sort.as_deref(), Some("newest"));
        assert_eq!(intent.query, "resume");
        assert!(intent.chips.iter().any(|c| c.raw == "sort:newest"));
    }

    #[test]
    fn screenshots_from_last_week_adds_type_and_time() {
        let intent = compile("screenshots from last week");
        assert!(intent.query.contains("type:image"));
        assert!(intent.query.contains("modified:<7d"));
    }

    #[test]
    fn big_videos_in_projects_composes_filters() {
        let intent = compile("big videos in Projects");
        assert!(intent.sort.is_none());
        assert!(intent.query.contains("size:>100mb"));
        assert!(intent.query.contains("type:media"));
        assert!(intent.query.contains("in:Projects"));
    }

    #[test]
    fn explicit_grammar_is_not_reinterpreted() {
        let intent = compile("type:pdf latest");
        assert!(intent.chips.is_empty());
        assert_eq!(intent.query, "type:pdf latest");
    }

    #[test]
    fn alias_expands_into_or_regex() {
        let aliases = vec![("resume".to_string(), vec!["cv".to_string()])];
        let intent = compile_with_aliases("resume", &aliases);
        assert!(intent.query.contains("re:\"(?i)(resume|cv)\""));
        assert!(intent.chips.iter().any(|c| c.kind == "alias"));
    }

    #[test]
    fn plain_query_is_untouched() {
        let intent = compile("docker error");
        assert!(intent.chips.is_empty());
        assert_eq!(intent.query, "docker error");
    }
}

/// Russian unit for a size chip label (`mb` -> `МБ`).
fn size_unit_ru(unit: &str) -> &'static str {
    match unit.to_ascii_lowercase().as_str() {
        "kb" => "КБ",
        "gb" => "ГБ",
        _ => "МБ",
    }
}

/// "last <weekday>" in Russian, with the adjective agreeing in gender.
fn weekday_ru(name: &str) -> &'static str {
    match name.to_ascii_lowercase().as_str() {
        "monday" => "в прошлый понедельник",
        "tuesday" => "в прошлый вторник",
        "wednesday" => "в прошлую среду",
        "thursday" => "в прошлый четверг",
        "friday" => "в прошлую пятницу",
        "saturday" => "в прошлую субботу",
        "sunday" => "в прошлое воскресенье",
        _ => "в прошлый раз",
    }
}

/// Today's weekday as 0=Monday..6=Sunday, from the system clock (UTC is
/// accurate enough for a one-day window).
fn chrono_weekday_today() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let days = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0);
    // 1970-01-01 was a Thursday (index 3 when Monday is 0).
    ((days + 3) % 7) as u32
}

/// Days back from today to the most recent given weekday, never today itself.
fn weekday_days_back(name: &str, today: u32) -> Option<u32> {
    let target = match name.to_ascii_lowercase().as_str() {
        "monday" => 0,
        "tuesday" => 1,
        "wednesday" => 2,
        "thursday" => 3,
        "friday" => 4,
        "saturday" => 5,
        "sunday" => 6,
        _ => return None,
    };
    let back = (today + 7 - target) % 7;
    Some(if back == 0 { 7 } else { back })
}

/// "N days ago" is N days back, with a floor of one day.
fn days_ago_days(n: &str, _today: u32) -> Option<u32> {
    let n: u32 = n.parse().ok()?;
    (1..=365).contains(&n).then_some(n)
}

#[cfg(test)]
mod time_travel_tests {
    use super::*;

    #[test]
    fn last_weekday_is_never_today() {
        // Thursday (3) asking for "last Thursday" must go back a full week.
        assert_eq!(weekday_days_back("thursday", 3), Some(7));
        // Thursday asking for "last Monday" is three days back.
        assert_eq!(weekday_days_back("monday", 3), Some(3));
        // Monday asking for "last Sunday" is one day back.
        assert_eq!(weekday_days_back("sunday", 0), Some(1));
        assert_eq!(weekday_days_back("noday", 0), None);
    }

    #[test]
    fn days_ago_is_bounded() {
        assert_eq!(days_ago_days("3", 0), Some(3));
        assert_eq!(days_ago_days("0", 0), None);
        assert_eq!(days_ago_days("9999", 0), None);
    }

    #[test]
    fn weekday_phrase_becomes_a_time_filter_chip() {
        let intent = compile("invoice from last tuesday");
        let chip = intent
            .chips
            .iter()
            .find(|c| c.kind == "time")
            .expect("time chip for last tuesday");
        assert!(chip.raw.starts_with("modified:"), "got {}", chip.raw);
        assert!(!intent.query.to_lowercase().contains("tuesday"));
    }

    #[test]
    fn days_ago_phrase_becomes_a_time_filter_chip() {
        let intent = compile("notes 3 days ago");
        assert!(intent.chips.iter().any(|c| c.kind == "time" && c.raw.contains("..")));
    }
}
