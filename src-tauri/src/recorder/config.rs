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
    }

    #[test]
    fn test_config_roundtrip() {
        let config = RecorderConfig {
            sample_rate: 96000,
            bit_depth: 32,
            channels: 1,
            output_dir: "/tmp/test".to_string(),
            default_device: Some("TestDevice".to_string()),
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: RecorderConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.sample_rate, 96000);
        assert_eq!(parsed.bit_depth, 32);
        assert_eq!(parsed.channels, 1);
        assert_eq!(parsed.output_dir, "/tmp/test");
        assert_eq!(parsed.default_device.as_deref(), Some("TestDevice"));
    }

    #[test]
    fn test_config_file_path() {
        let state = RecorderConfigState::new();
        let path_str = state.config_path.to_string_lossy().to_string();
        assert!(path_str.contains(".music-hub-data"));
        assert!(path_str.contains("sample-recorder-config.json"));
    }
}
