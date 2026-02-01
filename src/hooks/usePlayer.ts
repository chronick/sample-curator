/**
 * Hook for audio playback.
 */

import { useState, useRef, useCallback, useEffect } from "react";

interface PlayerState {
  currentSample: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayerState>({
    currentSample: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
  });

  // Initialize audio element
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";

    audio.addEventListener("timeupdate", () => {
      setState((s) => ({ ...s, currentTime: audio.currentTime }));
    });

    audio.addEventListener("loadedmetadata", () => {
      setState((s) => ({ ...s, duration: audio.duration }));
    });

    audio.addEventListener("ended", () => {
      setState((s) => ({ ...s, isPlaying: false, currentTime: 0 }));
    });

    audio.addEventListener("play", () => {
      setState((s) => ({ ...s, isPlaying: true }));
    });

    audio.addEventListener("pause", () => {
      setState((s) => ({ ...s, isPlaying: false }));
    });

    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  // Play a sample
  const play = useCallback(async (path: string) => {
    const audio = audioRef.current;
    if (!audio) return;

    // If same sample, just resume
    if (state.currentSample === path) {
      if (audio.paused) {
        await audio.play();
      }
      return;
    }

    // Load and play new sample
    // Convert path to file:// URL for local files
    const url = path.startsWith("file://") ? path : `file://${path}`;
    audio.src = url;
    setState((s) => ({ ...s, currentSample: path, currentTime: 0 }));

    try {
      await audio.play();
    } catch (err) {
      console.error("Failed to play audio:", err);
    }
  }, [state.currentSample]);

  // Pause playback
  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  // Toggle play/pause
  const toggle = useCallback(() => {
    if (state.isPlaying) {
      pause();
    } else if (state.currentSample) {
      play(state.currentSample);
    }
  }, [state.isPlaying, state.currentSample, play, pause]);

  // Stop playback
  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      setState((s) => ({ ...s, isPlaying: false, currentTime: 0 }));
    }
  }, []);

  // Seek to position (0-1)
  const seek = useCallback((position: number) => {
    const audio = audioRef.current;
    if (audio && audio.duration) {
      audio.currentTime = position * audio.duration;
    }
  }, []);

  // Set volume (0-1)
  const setVolume = useCallback((volume: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = Math.max(0, Math.min(1, volume));
    }
  }, []);

  return {
    currentSample: state.currentSample,
    isPlaying: state.isPlaying,
    currentTime: state.currentTime,
    duration: state.duration,
    progress: state.duration > 0 ? state.currentTime / state.duration : 0,
    play,
    pause,
    toggle,
    stop,
    seek,
    setVolume,
  };
}

export default usePlayer;
