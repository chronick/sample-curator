/** Emoji for sample types */
export const TYPE_EMOJI: Record<string, string> = {
  kick: "🥁",
  snare: "🪘",
  hihat: "🔔",
  clap: "👏",
  percussion: "🪇",
  bass: "🎸",
  synth: "🎹",
  vocal: "🎤",
  fx: "✨",
  loop: "🔄",
};

/** Emoji for acoustic tags */
export const ACOUSTIC_EMOJI: Record<string, string> = {
  bright: "☀️",
  dark: "🌙",
  punchy: "👊",
  sustained: "🌊",
  tonal: "🎵",
  noisy: "📻",
  warm: "🔥",
  cold: "❄️",
  sharp: "⚡",
  smooth: "🧈",
};

/** Color classes for acoustic tags */
export const ACOUSTIC_COLORS: Record<string, string> = {
  bright: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  dark: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  punchy: "bg-red-500/20 text-red-300 border-red-500/30",
  sustained: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  tonal: "bg-green-500/20 text-green-300 border-green-500/30",
  noisy: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  warm: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  cold: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  sharp: "bg-lime-500/20 text-lime-300 border-lime-500/30",
  smooth: "bg-teal-500/20 text-teal-300 border-teal-500/30",
};

/** Get emoji for a sample type, with fallback */
export function getTypeEmoji(sampleType: string | null | undefined): string {
  if (!sampleType) return "";
  return TYPE_EMOJI[sampleType.toLowerCase()] ?? "";
}

/** Emoji for tags (best-effort mapping) */
export const TAG_EMOJI: Record<string, string> = {
  kick: "\u{1F941}",
  snare: "\u{1FA98}",
  hihat: "\u{1F514}",
  clap: "\u{1F44F}",
  percussion: "\u{1FA87}",
  bass: "\u{1F3B8}",
  synth: "\u{1F3B9}",
  vocal: "\u{1F3A4}",
  fx: "\u{2728}",
  loop: "\u{1F504}",
  pad: "\u{1F3B6}",
  lead: "\u{1F3B5}",
  ambient: "\u{1F30A}",
  noise: "\u{1F4FB}",
  foley: "\u{1F3AC}",
};

/** Get emoji for a tag (best-effort mapping) */
export function getTagEmoji(tag: string): string {
  return TAG_EMOJI[tag.toLowerCase()] ?? ACOUSTIC_EMOJI[tag.toLowerCase()] ?? "";
}

/** Get emoji for an acoustic tag */
export function getAcousticEmoji(tag: string): string {
  return ACOUSTIC_EMOJI[tag.toLowerCase()] ?? "";
}

/** Get color class for an acoustic tag */
export function getAcousticColor(tag: string): string {
  return ACOUSTIC_COLORS[tag.toLowerCase()] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30";
}
