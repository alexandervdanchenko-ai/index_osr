//! Unigram (SentencePiece) tokenizer for multilingual static embeddings.
//!
//! index_osr: `potion-multilingual-128M` (model2vec, tokenizer from
//! `BAAI/bge-m3`) uses a HuggingFace `Unigram` model whose vocab is a list of
//! `[piece, log_prob]` pairs, a normalizer made of `Precompiled`, `Replace`
//! and `Strip` steps, and a `Metaspace` pre-tokenizer. The upstream loader only
//! understood BERT WordPiece, so Russian text could not be embedded at all.
//!
//! This is a dependency-light reimplementation of the parts that model uses:
//!
//! * `Precompiled` (SentencePiece charsmap) is approximated by Unicode NFKC
//!   plus SentencePiece's whitespace/control handling. For Cyrillic and Latin
//!   legal text the two agree; the CI probe checks the full pipeline against
//!   the reference `tokenizers` library.
//! * `Replace` (literal or regex), `Strip`, `NFKC`, `Lowercase`.
//! * `Metaspace` with `prepend_scheme: always` and `split: false`.
//! * Viterbi decoding over piece log-probabilities, with SentencePiece's unknown
//!   penalty (`min_score - 10`) and fused consecutive unknowns.

use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;

/// Metaspace replacement character (U+2581).
const META: char = '\u{2581}';
/// SentencePiece's penalty for an unknown piece, relative to the lowest score.
const UNK_PENALTY: f64 = 10.0;
/// Hard cap on characters fed to the lattice; units are short windows anyway.
const MAX_INPUT_CHARS: usize = 16_384;

#[derive(Debug)]
enum NormStep {
    /// `Precompiled` charsmap (approximated) or explicit `NFKC`.
    Nfkc { sentencepiece_spaces: bool },
    Replace { pattern: Pattern, content: String },
    Strip { left: bool, right: bool },
    Lowercase,
}

#[derive(Debug)]
enum Pattern {
    Literal(String),
    Regex(Regex),
}

/// A loaded Unigram tokenizer.
#[derive(Debug)]
pub struct UnigramTokenizer {
    pieces: HashMap<String, (u32, f32)>,
    max_piece_chars: usize,
    unk_id: u32,
    unk_score: f64,
    normalizer: Vec<NormStep>,
    prepend_meta: bool,
}

impl UnigramTokenizer {
    /// Builds the tokenizer from a parsed `tokenizer.json`. Returns `None` when
    /// the model is not Unigram or uses a component this module cannot
    /// reproduce, so the caller can refuse the model instead of producing
    /// silently wrong embeddings.
    pub fn from_json(value: &Value, vocab_size: usize) -> Option<Self> {
        let model = value.get("model")?;
        if model.get("type")?.as_str()? != "Unigram" {
            return None;
        }
        if model.get("byte_fallback").and_then(Value::as_bool) == Some(true) {
            return None;
        }
        let vocab = model.get("vocab")?.as_array()?;
        let mut pieces = HashMap::with_capacity(vocab.len());
        let mut max_piece_chars = 1usize;
        let mut min_score = f64::INFINITY;
        for (id, entry) in vocab.iter().enumerate() {
            if id >= vocab_size {
                break;
            }
            let pair = entry.as_array()?;
            let piece = pair.first()?.as_str()?;
            let score = pair.get(1)?.as_f64()?;
            min_score = min_score.min(score);
            max_piece_chars = max_piece_chars.max(piece.chars().count());
            pieces.insert(piece.to_string(), (id as u32, score as f32));
        }
        if pieces.is_empty() {
            return None;
        }
        let unk_id = model.get("unk_id").and_then(Value::as_u64).unwrap_or(0) as u32;
        if unk_id as usize >= vocab_size {
            return None;
        }

        let mut normalizer = Vec::new();
        if let Some(node) = value.get("normalizer")
            && !node.is_null()
        {
            parse_normalizer(node, &mut normalizer)?;
        }

        let prepend_meta = match value.get("pre_tokenizer") {
            None | Some(Value::Null) => false,
            Some(pre) => parse_metaspace(pre)?,
        };

        Some(Self {
            pieces,
            max_piece_chars,
            unk_id,
            unk_score: min_score - UNK_PENALTY,
            normalizer,
            prepend_meta,
        })
    }

    pub fn unk_id(&self) -> u32 {
        self.unk_id
    }

    /// Applies the normalizer chain and the Metaspace pre-tokenizer.
    pub fn normalize(&self, text: &str) -> String {
        let mut s = text.to_string();
        for step in &self.normalizer {
            s = match step {
                NormStep::Nfkc { sentencepiece_spaces } => {
                    let nfkc: String = s.nfkc().collect();
                    if *sentencepiece_spaces {
                        sentencepiece_whitespace(&nfkc)
                    } else {
                        nfkc
                    }
                }
                NormStep::Replace { pattern, content } => match pattern {
                    Pattern::Literal(lit) => s.replace(lit.as_str(), content),
                    Pattern::Regex(re) => re.replace_all(&s, content.as_str()).into_owned(),
                },
                NormStep::Strip { left, right } => match (left, right) {
                    (true, true) => s.trim().to_string(),
                    (true, false) => s.trim_start().to_string(),
                    (false, true) => s.trim_end().to_string(),
                    (false, false) => s,
                },
                NormStep::Lowercase => s.to_lowercase(),
            };
        }
        let mut out = String::with_capacity(s.len() + 3);
        if self.prepend_meta && !s.starts_with(META) && !s.is_empty() {
            out.push(META);
        }
        out.extend(s.chars().map(|ch| if ch == ' ' { META } else { ch }));
        out
    }

    /// Token ids for `text`, including the unknown id where nothing matched.
    pub fn encode(&self, text: &str) -> Vec<u32> {
        let normalized = self.normalize(text);
        let mut bounds: Vec<usize> = normalized.char_indices().map(|(i, _)| i).collect();
        bounds.truncate(MAX_INPUT_CHARS);
        let end_byte = if bounds.len() < MAX_INPUT_CHARS {
            normalized.len()
        } else {
            normalized
                .char_indices()
                .nth(MAX_INPUT_CHARS)
                .map(|(i, _)| i)
                .unwrap_or(normalized.len())
        };
        bounds.push(end_byte);
        let n = bounds.len() - 1;
        if n == 0 {
            return Vec::new();
        }

        // best[i]: best score of a segmentation of the first i characters.
        let mut best = vec![f64::NEG_INFINITY; n + 1];
        // back[i]: (start char, token id) of the last piece of that segmentation.
        let mut back = vec![(0usize, 0u32); n + 1];
        best[0] = 0.0;
        for start in 0..n {
            if best[start] == f64::NEG_INFINITY {
                continue;
            }
            let mut has_single = false;
            let max_end = (start + self.max_piece_chars).min(n);
            for end in start + 1..=max_end {
                let piece = &normalized[bounds[start]..bounds[end]];
                if let Some(&(id, score)) = self.pieces.get(piece) {
                    if end == start + 1 {
                        has_single = true;
                    }
                    let candidate = best[start] + score as f64;
                    if candidate > best[end] {
                        best[end] = candidate;
                        back[end] = (start, id);
                    }
                }
            }
            if !has_single {
                let candidate = best[start] + self.unk_score;
                if candidate > best[start + 1] {
                    best[start + 1] = candidate;
                    back[start + 1] = (start, self.unk_id);
                }
            }
        }

        let mut ids = Vec::new();
        let mut pos = n;
        while pos > 0 {
            let (start, id) = back[pos];
            ids.push(id);
            pos = start;
        }
        ids.reverse();
        // Fuse runs of unknowns into one, as `tokenizers` does by default.
        ids.dedup_by(|a, b| *a == self.unk_id && *b == self.unk_id);
        ids
    }
}

/// SentencePiece normalization around NFKC: format characters such as
/// zero-width spaces become a space, other control characters are dropped,
/// and tab/newline/carriage return are spaces.
fn sentencepiece_whitespace(text: &str) -> String {
    text.chars()
        .filter_map(|ch| match ch {
            '\t' | '\n' | '\r' => Some(' '),
            '\u{200B}'..='\u{200F}' | '\u{2028}'..='\u{202F}' | '\u{2060}' | '\u{FEFF}' => {
                Some(' ')
            }
            c if c.is_control() => None,
            c => Some(c),
        })
        .collect()
}

fn parse_normalizer(node: &Value, out: &mut Vec<NormStep>) -> Option<()> {
    match node.get("type")?.as_str()? {
        "Sequence" => {
            for child in node.get("normalizers")?.as_array()? {
                parse_normalizer(child, out)?;
            }
        }
        "Precompiled" => out.push(NormStep::Nfkc {
            sentencepiece_spaces: true,
        }),
        "NFKC" => out.push(NormStep::Nfkc {
            sentencepiece_spaces: false,
        }),
        "Lowercase" => out.push(NormStep::Lowercase),
        "Strip" => out.push(NormStep::Strip {
            left: node.get("strip_left").and_then(Value::as_bool).unwrap_or(true),
            right: node.get("strip_right").and_then(Value::as_bool).unwrap_or(true),
        }),
        "Replace" => {
            let pattern = node.get("pattern")?;
            let content = node.get("content")?.as_str()?.to_string();
            let pattern = if let Some(lit) = pattern.get("String").and_then(Value::as_str) {
                Pattern::Literal(lit.to_string())
            } else {
                let re = pattern.get("Regex")?.as_str()?;
                Pattern::Regex(Regex::new(re).ok()?)
            };
            out.push(NormStep::Replace { pattern, content });
        }
        // Anything else would change tokens in ways we cannot reproduce.
        _ => return None,
    }
    Some(())
}

/// Accepts a `Metaspace` pre-tokenizer that keeps the text whole and returns
/// whether a leading meta symbol is prepended.
fn parse_metaspace(node: &Value) -> Option<bool> {
    if node.get("type")?.as_str()? != "Metaspace" {
        return None;
    }
    if node.get("split").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let replacement = node.get("replacement").and_then(Value::as_str).unwrap_or("\u{2581}");
    if replacement != "\u{2581}" {
        return None;
    }
    Some(match node.get("prepend_scheme").and_then(Value::as_str) {
        Some("never") => false,
        // "first" equals "always" when the whole text is one sequence.
        _ => true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A miniature tokenizer.json with the same structure as bge-m3's.
    fn toy() -> UnigramTokenizer {
        let value = json!({
            "normalizer": {"type": "Sequence", "normalizers": [
                {"type": "Sequence", "normalizers": [
                    {"type": "Precompiled", "precompiled_charsmap": "AAAA"},
                    {"type": "Replace", "pattern": {"Regex": " {2,}"}, "content": " "}
                ]},
                {"type": "Replace", "pattern": {"String": "."}, "content": " . "},
                {"type": "Replace", "pattern": {"String": ","}, "content": " , "},
                {"type": "Replace", "pattern": {"Regex": "\\s+"}, "content": " "},
                {"type": "Strip", "strip_left": true, "strip_right": true}
            ]},
            "pre_tokenizer": {"type": "Metaspace", "replacement": "▁", "prepend_scheme": "always", "split": false},
            "model": {"type": "Unigram", "unk_id": 1, "byte_fallback": false, "vocab": [
                ["[PAD]", -13.5], ["[UNK]", -13.5], [",", -3.4], [".", -3.6], ["▁", -3.9],
                ["▁у", -6.0], ["воль", -8.0], ["не", -6.5], ["нии", -7.0],
                ["▁увольнении", -9.0], ["▁за", -5.0], ["▁прогул", -9.5],
                ["▁ст", -7.0], ["▁81", -8.0], ["а", -5.5], ["в", -5.6]
            ]}
        });
        UnigramTokenizer::from_json(&value, 16).expect("toy tokenizer")
    }

    #[test]
    fn normalizer_spaces_punctuation_and_prepends_meta() {
        let t = toy();
        assert_eq!(t.normalize("ст. 81,  прогул"), "▁ст▁.▁81▁,▁прогул");
        assert_eq!(t.normalize("a\u{200B}b"), "▁a▁b");
        assert_eq!(t.normalize("\u{FF12}"), "▁2"); // fullwidth digit -> NFKC
    }

    #[test]
    fn viterbi_prefers_the_most_probable_segmentation() {
        let t = toy();
        // Whole word (-9.0) beats у+воль+не+нии (-27.5).
        assert_eq!(t.encode("увольнении"), vec![9]);
        assert_eq!(t.encode("за прогул"), vec![10, 11]);
        assert_eq!(t.encode("ст. 81"), vec![12, 4, 3, 13]);
    }

    #[test]
    fn unknown_characters_are_fused_into_one_unk() {
        let t = toy();
        // "▁" is known; "ЖЖ" is not and becomes a single [UNK].
        assert_eq!(t.encode("ЖЖ"), vec![4, 1]);
        assert!(t.encode("").is_empty());
    }

    #[test]
    fn rejects_unsupported_components() {
        let mut value = json!({
            "model": {"type": "Unigram", "unk_id": 0, "vocab": [["[UNK]", 0.0]]},
            "normalizer": {"type": "BertNormalizer"}
        });
        assert!(UnigramTokenizer::from_json(&value, 1).is_none());
        value["normalizer"] = Value::Null;
        value["pre_tokenizer"] = json!({"type": "Metaspace", "split": true});
        assert!(UnigramTokenizer::from_json(&value, 1).is_none());
        value["pre_tokenizer"] = Value::Null;
        assert!(UnigramTokenizer::from_json(&value, 1).is_some());
        value["model"]["type"] = json!("WordPiece");
        assert!(UnigramTokenizer::from_json(&value, 1).is_none());
    }
}
