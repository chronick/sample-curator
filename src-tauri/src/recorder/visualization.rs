use rustfft::num_complex::Complex;
use rustfft::FftPlanner;

/// Downsample waveform data to target length.
pub fn downsample_waveform(samples: &[f32], target_len: usize) -> Vec<f32> {
    if samples.len() <= target_len || target_len == 0 {
        return samples.to_vec();
    }
    let step = samples.len() as f64 / target_len as f64;
    (0..target_len)
        .map(|i| {
            let idx = (i as f64 * step) as usize;
            samples[idx.min(samples.len() - 1)]
        })
        .collect()
}

/// Calculate FFT spectrum from audio samples.
/// Returns magnitude bins (linear scale, not dB).
pub fn calculate_spectrum(samples: &[f32], num_bins: usize) -> Vec<f32> {
    if samples.is_empty() || num_bins == 0 {
        return vec![0.0; num_bins];
    }

    // Use power-of-2 FFT size
    let fft_size = samples.len().next_power_of_two();

    // Apply Hann window and convert to complex
    let mut buffer: Vec<Complex<f32>> = (0..fft_size)
        .map(|i| {
            if i < samples.len() {
                let window = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (samples.len() - 1).max(1) as f32).cos());
                Complex::new(samples[i] * window, 0.0)
            } else {
                Complex::new(0.0, 0.0)
            }
        })
        .collect();

    // Perform FFT
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(fft_size);
    fft.process(&mut buffer);

    // Take first half (positive frequencies) and compute magnitudes
    let half = fft_size / 2;
    let magnitudes: Vec<f32> = buffer[..half]
        .iter()
        .map(|c| c.norm() / fft_size as f32)
        .collect();

    // Bin into num_bins using logarithmic frequency spacing
    if half <= num_bins {
        let mut result = magnitudes;
        result.resize(num_bins, 0.0);
        return result;
    }

    let mut bins = vec![0.0_f32; num_bins];
    for (bin_idx, bin) in bins.iter_mut().enumerate() {
        // Logarithmic mapping: low freqs get more bins
        let lo = ((bin_idx as f64 / num_bins as f64).powf(2.0) * half as f64) as usize;
        let hi = (((bin_idx + 1) as f64 / num_bins as f64).powf(2.0) * half as f64) as usize;
        let lo = lo.min(half - 1);
        let hi = hi.max(lo + 1).min(half);

        let mut max_val = 0.0_f32;
        for &m in &magnitudes[lo..hi] {
            max_val = max_val.max(m);
        }
        *bin = max_val;
    }

    bins
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_waveform_downsample() {
        let samples: Vec<f32> = (0..1000).map(|i| i as f32 / 1000.0).collect();
        let result = downsample_waveform(&samples, 100);
        assert_eq!(result.len(), 100);
    }

    #[test]
    fn test_waveform_downsample_passthrough() {
        let samples = vec![1.0, 2.0, 3.0];
        let result = downsample_waveform(&samples, 10);
        assert_eq!(result.len(), 3); // shorter than target, pass through
    }

    #[test]
    fn test_spectrum_bins() {
        let samples: Vec<f32> = (0..2048)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48000.0).sin())
            .collect();
        let result = calculate_spectrum(&samples, 128);
        assert_eq!(result.len(), 128);
        // At least some bin should be non-zero (440Hz tone)
        let max_val = result.iter().copied().fold(0.0_f32, f32::max);
        assert!(max_val > 0.0, "Spectrum should have non-zero values for a sine wave");
    }

    #[test]
    fn test_spectrum_empty() {
        let result = calculate_spectrum(&[], 64);
        assert_eq!(result.len(), 64);
        assert!(result.iter().all(|&v| v == 0.0));
    }

    #[test]
    fn test_spectrum_hann_window() {
        // Verify windowing: a DC signal with Hann window should concentrate energy
        // in the low-frequency bins rather than being uniform
        let dc_signal = vec![1.0_f32; 1024];
        let spectrum = calculate_spectrum(&dc_signal, 64);
        // Low-frequency bins (first quarter) should have more energy than high-frequency bins (last quarter)
        let low_energy: f32 = spectrum[..16].iter().sum();
        let high_energy: f32 = spectrum[48..].iter().sum();
        assert!(low_energy > high_energy, "Low frequencies should dominate for DC signal");
    }
}
