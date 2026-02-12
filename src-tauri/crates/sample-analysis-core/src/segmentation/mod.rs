//! Audio segmentation algorithms.
//!
//! Provides various methods to split audio into chunks:
//! - `silence`: Split on silent regions
//! - `beat`: Split on beat boundaries
//! - `changepoint`: Split on spectral changes

pub mod beat;
pub mod changepoint;
pub mod silence;

pub use beat::segment_by_beats;
pub use changepoint::segment_by_changepoint;
pub use silence::segment_by_silence;
