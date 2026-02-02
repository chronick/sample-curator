/**
 * Hook for audio playback using native Rust backend.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";

interface PlayerState {
  currentSample: string | null;
  isPlaying: boolean;
  duration: number;
}

export function usePlayer() {
  const [state, setState] = useState<PlayerState>({
    currentSample: null,
    isPlaying: false,
    duration: 0,
  });

  // Poll for playback status
  const pollRef = useRef<number | null>(null);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;

    pollRef.current = window.setInterval(async () => {
      try {
        const [isPlaying, isPaused, duration] = await invoke<[boolean, boolean, number]>("audio_get_status");

        // Stop polling if playback finished
        if (!isPlaying && !isPaused) {
          if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setState((s) => ({ ...s, isPlaying: false }));
        }
      } catch (err) {
        // Ignore errors during polling
      }
    }, 500); // Poll less frequently
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // Play a sample
  const play = useCallback(async (path: string) => {
    console.log("Playing audio via Rust:", path);
    setState((s) => ({ ...s, currentSample: path }));

    try {
      const duration = await invoke<number>("audio_play", { path });
      console.log("Audio playing, duration:", duration);
      setState((s) => ({ ...s, isPlaying: true, duration }));
      startPolling();
    } catch (err) {
      console.error("Failed to play audio:", err);
      setState((s) => ({ ...s, isPlaying: false }));
    }
  }, [startPolling]);

  // Pause playback
  const pause = useCallback(async () => {
    try {
      await invoke("audio_pause");
      setState((s) => ({ ...s, isPlaying: false }));
    } catch (err) {
      console.error("Failed to pause audio:", err);
    }
  }, []);

  // Resume playback
  const resume = useCallback(async () => {
    try {
      await invoke("audio_resume");
      setState((s) => ({ ...s, isPlaying: true }));
      startPolling();
    } catch (err) {
      console.error("Failed to resume audio:", err);
    }
  }, [startPolling]);

  // Toggle play/pause
  const toggle = useCallback(async () => {
    if (state.isPlaying) {
      await pause();
    } else if (state.currentSample) {
      await resume();
    }
  }, [state.isPlaying, state.currentSample, pause, resume]);

  // Stop playback
  const stop = useCallback(async () => {
    try {
      await invoke("audio_stop");
      setState((s) => ({ ...s, isPlaying: false }));
      stopPolling();
    } catch (err) {
      console.error("Failed to stop audio:", err);
    }
  }, [stopPolling]);

  // Seek is not supported by rodio sink, so this is a no-op for now
  const seek = useCallback((_position: number) => {
    // rodio Sink doesn't support seeking - would need to reload the file
    console.log("Seek not supported in native audio");
  }, []);

  // Set volume (0-1)
  const setVolume = useCallback(async (volume: number) => {
    try {
      await invoke("audio_set_volume", { volume: Math.max(0, Math.min(1, volume)) });
    } catch (err) {
      console.error("Failed to set volume:", err);
    }
  }, []);

  return {
    currentSample: state.currentSample,
    isPlaying: state.isPlaying,
    currentTime: 0, // Not available with rodio sink
    duration: state.duration,
    progress: 0, // Not available with rodio sink
    play,
    pause,
    toggle,
    stop,
    seek,
    setVolume,
  };
}

export default usePlayer;
