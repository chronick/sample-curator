use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecorderConfig {
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub channels: u16,
    pub output_dir: String,
    pub default_device: Option<String>,

    /// Peak level (in dBFS) above which arm mode triggers recording.
    /// Defaults to -40 dBFS — below most room tone, above typical noise floor.
    #[serde(default = "default_arm_threshold_db")]
    pub arm_threshold_db: f32,

    /// Duration of continuous silence (below threshold) before arm mode
    /// auto-stops the recording. Defaults to 2000 ms.
    #[serde(default = "default_arm_silence_ms")]
    pub arm_silence_ms: u32,

    /// When true, vocal samples trigger both the mechanical-transcript naming
    /// path (Whisper → first content words) and the LLM-refinement path
    /// (ollama). Whichever path becomes the primary name, the other is
    /// returned as an alternative so the UI can show both for comparison.
    /// Default false (LLM is still used as the primary when available; A/B
    /// mode is a deliberate opt-in for auditing naming quality).
    #[serde(default)]
    pub llm_ab_test: bool,
}

fn default_arm_threshold_db() -> f32 {
    -40.0
}

fn default_arm_silence_ms() -> u32 {
    2000
}

impl Default for RecorderConfig {
    fn default() -> Self {
        let output_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".music-hub-data")
            .join("recordings")
            .to_string_lossy()
            .to_string();
        Self {
            sample_rate: 48000,
            bit_depth: 24,
            channels: 2,
            output_dir,
            default_device: None,
            arm_threshold_db: default_arm_threshold_db(),
            arm_silence_ms: default_arm_silence_ms(),
            llm_ab_test: false,
        }
    }
}

pub struct RecorderConfigState {
    config: Mutex<RecorderConfig>,
    config_path: PathBuf,
}

impl RecorderConfigState {
    pub fn new() -> Self {
        let config_path = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".music-hub-data")
            .join("sample-recorder-config.json");

        let config = if config_path.exists() {
            std::fs::read_to_string(&config_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            RecorderConfig::default()
        };

        Self {
            config: Mutex::new(config),
            config_path,
        }
    }

    fn save(&self, config: &RecorderConfig) -> Result<(), String> {
        if let Some(parent) = self.config_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        std::fs::write(&self.config_path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get(&self) -> Result<RecorderConfig, String> {
        let config = self.config.lock().map_err(|e| e.to_string())?;
        Ok(config.clone())
    }

    pub fn set(&self, config: RecorderConfig) -> Result<(), String> {
        self.save(&config)?;
        let mut current = self.config.lock().map_err(|e| e.to_string())?;
        *current = config;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = RecorderConfig::default();
        assert_eq!(config.sample_rate, 48000);
        assert_eq!(config.bit_depth, 24);
        assert_eq!(config.channels, 2);
        assert!(config.output_dir.contains("recordings"));
        assert!(config.default_device.is_none());
        assert_eq!(config.arm_threshold_db, -40.0);
        assert_eq!(config.arm_silence_ms, 2000);
        assert!(!config.llm_ab_test);
    }

    #[test]
    fn test_config_roundtrip() {
        let config = RecorderConfig {
            sample_rate: 96000,
            bit_depth: 32,
            channels: 1,
            output_dir: "/tmp/test".to_string(),
            default_device: Some("TestDevice".to_string()),
            arm_threshold_db: -32.5,
            arm_silence_ms: 1500,
            llm_ab_test: true,
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: RecorderConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.sample_rate, 96000);
        assert_eq!(parsed.bit_depth, 32);
        assert_eq!(parsed.channels, 1);
        assert_eq!(parsed.output_dir, "/tmp/test");
        assert_eq!(parsed.default_device.as_deref(), Some("TestDevice"));
        assert_eq!(parsed.arm_threshold_db, -32.5);
        assert_eq!(parsed.arm_silence_ms, 1500);
        assert!(parsed.llm_ab_test);
    }

    #[test]
    fn test_config_backfills_arm_defaults_for_old_configs() {
        // Old config JSON without arm_* / llm_ab_test fields should load with defaults.
        let old_json = r#"{
            "sample_rate": 48000,
            "bit_depth": 24,
            "channels": 2,
            "output_dir": "/tmp",
            "default_device": null
        }"#;
        let parsed: RecorderConfig = serde_json::from_str(old_json).unwrap();
        assert_eq!(parsed.arm_threshold_db, -40.0);
        assert_eq!(parsed.arm_silence_ms, 2000);
        assert!(!parsed.llm_ab_test);
    }

    #[test]
    fn test_config_file_path() {
        let state = RecorderConfigState::new();
        let path_str = state.config_path.to_string_lossy().to_string();
        assert!(path_str.contains(".music-hub-data"));
        assert!(path_str.contains("sample-recorder-config.json"));
    }
}
