import { useEffect, useRef } from "react";
import { api } from "../api/client";
import { useStore } from "../store";

/**
 * Hook to manage job polling and Tauri event listening.
 * Replaces the inline polling useEffect in AppContent.
 */
export function useJobs() {
  const setJobStats = useStore((s) => s.setJobStats);
  const jobStats = useStore((s) => s.jobStats);
  const listenerRef = useRef<(() => void) | null>(null);

  // Poll job stats periodically
  useEffect(() => {
    const poll = async () => {
      try {
        const status = await api.getJobStats();
        setJobStats(status.stats);
      } catch {
        // Job system might not be initialized yet
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [setJobStats]);

  // Listen for Tauri events for real-time updates
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("job:progress", async () => {
        // On any job progress event, immediately refresh stats
        try {
          const status = await api.getJobStats();
          setJobStats(status.stats);
        } catch {}
      }).then((unlisten) => {
        cleanup = unlisten;
        listenerRef.current = unlisten;
      });
    }).catch(() => {
      // Not in Tauri context
    });

    return () => {
      cleanup?.();
      listenerRef.current = null;
    };
  }, [setJobStats]);

  return { jobStats };
}
