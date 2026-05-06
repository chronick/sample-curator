import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SearchStats } from "../../api/types";
import { Section, Row } from "./shared";

export function LibraryTab() {
  const [stats, setStats] = useState<SearchStats | null>(null);

  useEffect(() => {
    invoke<SearchStats>("get_search_stats")
      .then(setStats)
      .catch((err) => console.error("Failed to load stats:", err));
  }, []);

  return (
    <div className="space-y-6">
      <Section title="Library">
        {stats ? (
          <div className="space-y-1">
            <Row label="Total samples" value={stats.total_samples.toLocaleString()} />
            <Row label="Embeddings" value={stats.total_embeddings.toLocaleString()} />
            <Row label="Index loaded" value={stats.index_loaded ? "Yes" : "No"} />
          </div>
        ) : (
          <p className="text-xs text-gray-500">Loading…</p>
        )}
      </Section>
    </div>
  );
}
