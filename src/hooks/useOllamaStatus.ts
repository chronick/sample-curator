import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../api/client";
import {
  INITIAL_OLLAMA_STATUS,
  type OllamaStatusDict,
} from "../types/ollama";

const FAST_POLL_MS = 1000;
const SLOW_POLL_MS = 10000;

interface UseOllamaStatusReturn {
  status: OllamaStatusDict;
  refresh: () => Promise<void>;
  setModel: (model: string | null) => Promise<void>;
}

/**
 * Single-source-of-truth hook for ollama status. Must be called ONCE per
 * app instance (in App.tsx) — never inside children. Return value is
 * passed down as props.
 *
 * Cadence: 1s while state === "loading", 10s otherwise.
 * Race guard: poll responses are dropped while a mutation is in flight;
 *             mutation wins.
 * Idempotency: concurrent refresh()/setModel(same) calls share one RPC.
 */
export function useOllamaStatus(): UseOllamaStatusReturn {
  const [status, setStatus] = useState<OllamaStatusDict>(INITIAL_OLLAMA_STATUS);

  const isMutatingRef = useRef(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const setModelInFlightRef = useRef<{
    model: string | null;
    promise: Promise<void>;
  } | null>(null);

  // Latest state for cadence selection — updated synchronously inside tick
  // (before the next setTimeout schedule) so cadence reflects the response
  // we just received, not a stale render.
  const stateRef = useRef(status.state);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tick = async () => {
      try {
        const fresh = await api.sidecarCall<OllamaStatusDict>(
          "get_ollama_status"
        );
        if (cancelled) return;
        if (isMutatingRef.current) return;
        setStatus(fresh);
        stateRef.current = fresh.state;
      } catch {
        // Swallow — sidecar may not be up yet; keep previous state.
      } finally {
        if (!cancelled) {
          const delay =
            stateRef.current === "loading" ? FAST_POLL_MS : SLOW_POLL_MS;
          timeoutId = setTimeout(tick, delay);
        }
      }
    };

    // First poll fires immediately (not after interval delay).
    tick();

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const p = (async () => {
      isMutatingRef.current = true;
      try {
        const fresh = await api.sidecarCall<OllamaStatusDict>(
          "refresh_ollama_status"
        );
        setStatus(fresh);
        stateRef.current = fresh.state;
      } finally {
        isMutatingRef.current = false;
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = p;
    return p;
  }, []);

  const setModel = useCallback(
    async (model: string | null): Promise<void> => {
      const existing = setModelInFlightRef.current;
      if (existing && existing.model === model) return existing.promise;
      let self: Promise<void>;
      const run = async () => {
        isMutatingRef.current = true;
        try {
          const fresh = await api.sidecarCall<OllamaStatusDict>(
            "set_ollama_model",
            { model }
          );
          setStatus(fresh);
          stateRef.current = fresh.state;
        } finally {
          isMutatingRef.current = false;
          if (setModelInFlightRef.current?.promise === self) {
            setModelInFlightRef.current = null;
          }
        }
      };
      self = run();
      setModelInFlightRef.current = { model, promise: self };
      return self;
    },
    []
  );

  return { status, refresh, setModel };
}
