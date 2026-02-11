use sample_analysis_core::audio::load_audio;
use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: test_file <path>");
        return;
    }
    
    let path = &args[1];
    println!("Loading: {}", path);
    
    match load_audio(path, None, true) {
        Ok((samples, sr)) => {
            println!("SUCCESS: {} samples at {} Hz, duration: {:.2}s", 
                     samples.len(), sr, samples.len() as f64 / sr as f64);
        }
        Err(e) => {
            println!("ERROR: {:?}", e);
        }
    }
}
