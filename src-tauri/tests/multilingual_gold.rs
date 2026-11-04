//! index_osr: the multilingual static table against the reference
//! HuggingFace `tokenizers` + model2vec pipeline.
//!
//! The model files (530 MB) are not in the repository, so this test is
//! ignored by default. CI downloads the pinned revision and runs it with
//! `KENSAKU_MULTILINGUAL_DIR=<dir> cargo test --test multilingual_gold -- --ignored`.
//! Reference values come from `.github/workflows/model-probe.yml`.

use kensaku_lib::embed::StaticTable;
use std::path::PathBuf;

/// (text, reference token ids, first 8 dims of the reference embedding).
const GOLD: &[(&str, &[u32], &[f32])] = &[
    ("Приказ об увольнении работника за прогул", &[113668, 1084, 82, 36684, 334, 13699, 148109, 59, 154939], &[-0.116878, 0.198044, -0.053573, -0.178891, 0.004346, 0.057562, 0.067632, 0.050233]),
    ("Работодатель не выплатил заработную плату", &[61157, 42054, 15277, 75, 100623, 3871, 59, 18952, 3793, 271109], &[-0.111438, 0.103958, 0.028189, -0.107939, 0.007508, -0.01657, 0.149843, 0.025671]),
    ("восстановление на работе и оплата вынужденного прогула", &[275314, 27, 22154, 33, 256897, 148575, 1268, 154939, 57], &[0.177247, 0.24051, -0.185734, -0.172811, -0.065644, 0.06912, 0.020599, 0.079303]),
    ("Ёлкин подал исковое заявление в Тушинский районный суд г. Москвы", &[4, 57496, 35413, 301, 350060, 204674, 13473, 62413, 47, 16796, 734, 203711, 326105, 4058, 1068, 4, 3, 80044], &[-0.212836, 0.069053, 0.058749, 0.145324, 0.14465, -0.006452, -0.019402, -0.065052]),
    ("ст. 81 ТК РФ, п. 6 ч. 1", &[6714, 4, 3, 16501, 4, 95023, 9401, 4, 2, 3705, 4, 3, 303, 2388, 4, 3, 104], &[-0.078033, -0.078815, 0.101204, 0.062172, 0.145427, -0.023299, 0.070987, 0.020944]),
    ("The quick brown fox", &[579, 63771, 119453, 250559], &[0.01867, -0.169693, -0.009279, -0.026764, -0.056864, -0.061343, -0.098375, 0.053435]),
    ("ИНЖСИСТЕМС  ООО «Будвар»", &[76435, 5786, 1558, 103339, 38451, 1558, 86021, 92, 201953, 7177, 165], &[-0.395599, -0.133492, 0.020033, 0.075662, 0.07063, -0.043064, -0.034643, -0.251527]),
];

fn model_dir() -> PathBuf {
    PathBuf::from(std::env::var("KENSAKU_MULTILINGUAL_DIR").expect("KENSAKU_MULTILINGUAL_DIR"))
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    dot / (na * nb)
}

#[test]
#[ignore = "needs the downloaded multilingual model (CI job multilingual-gold)"]
fn token_ids_match_reference_tokenizer() {
    let table = StaticTable::load_with_f32(&model_dir(), true).expect("load multilingual table");
    assert_eq!(table.model_id, kensaku_lib::embed::model::MULTILINGUAL_MODEL_ID);
    for (text, ids, _) in GOLD {
        assert_eq!(table.token_ids(text), ids.to_vec(), "{text}");
    }
}

#[test]
#[ignore = "needs the downloaded multilingual model (CI job multilingual-gold)"]
fn embeddings_match_reference_model2vec() {
    let exact = StaticTable::load_with_f32(&model_dir(), true).expect("f32 table");
    let quantized = StaticTable::load(&model_dir()).expect("i8 table");
    assert!(quantized.is_quantized());
    for (text, _, head) in GOLD {
        let vector = exact.embed(text);
        for (got, want) in vector.iter().zip(head.iter()) {
            assert!((got - want).abs() < 1e-4, "{text}: {got} vs {want}");
        }
        let q = quantized.embed(text);
        assert!(cosine(&vector, &q) > 0.995, "{text}: i8 drifted");
    }
}

#[test]
#[ignore = "needs the downloaded multilingual model (CI job multilingual-gold)"]
fn russian_meaning_ranks_related_text_higher() {
    let table = StaticTable::load(&model_dir()).expect("i8 table");
    let query = table.embed("увольнение работника за прогул");
    let related = table.embed("работник уволен за отсутствие на рабочем месте");
    let unrelated = table.embed("договор купли-продажи квартиры");
    assert!(cosine(&query, &related) > cosine(&query, &unrelated) + 0.3);
}
