//! Benchmarks for audio analyzers.

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use sample_analysis_core::analyzers::{
    bpm::analyze_bpm,
    quality::analyze_quality,
    spectral::analyze_spectral,
    spectrogram::analyze_spectrogram,
};

/// Generate test audio data (sine wave).
fn generate_test_audio(sample_rate: u32, duration_secs: f32) -> Vec<f32> {
    let n_samples = (sample_rate as f32 * duration_secs) as usize;
    let freq = 440.0;

    (0..n_samples)
        .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sample_rate as f32).sin())
        .collect()
}

fn bench_quality_analysis(c: &mut Criterion) {
    let samples = generate_test_audio(44100, 5.0);

    c.bench_function("quality_analyze_5s", |b| {
        b.iter(|| {
            analyze_quality(
                black_box(&samples),
                black_box(44100),
                black_box(&Default::default()),
            )
        })
    });
}

fn bench_spectral_analysis(c: &mut Criterion) {
    let samples = generate_test_audio(22050, 5.0);

    c.bench_function("spectral_analyze_5s", |b| {
        b.iter(|| {
            analyze_spectral(
                black_box(&samples),
                black_box(22050),
                black_box(&Default::default()),
            )
        })
    });
}

fn bench_spectrogram_generation(c: &mut Criterion) {
    let samples = generate_test_audio(22050, 5.0);

    c.bench_function("spectrogram_analyze_5s", |b| {
        b.iter(|| {
            analyze_spectrogram(
                black_box(&samples),
                black_box(22050),
                black_box(&Default::default()),
            )
        })
    });
}

fn bench_bpm_analysis(c: &mut Criterion) {
    let samples = generate_test_audio(22050, 10.0);

    c.bench_function("bpm_analyze_10s", |b| {
        b.iter(|| {
            analyze_bpm(
                black_box(&samples),
                black_box(22050),
                black_box(&Default::default()),
            )
        })
    });
}

criterion_group!(
    benches,
    bench_quality_analysis,
    bench_spectral_analysis,
    bench_spectrogram_generation,
    bench_bpm_analysis
);
criterion_main!(benches);
