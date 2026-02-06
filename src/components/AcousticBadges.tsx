import { getAcousticEmoji, getAcousticColor } from "../utils/emoji";

interface AcousticBadgesProps {
  tags: string[];
}

export function AcousticBadges({ tags }: AcousticBadgesProps) {
  if (!tags || tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-xs ${getAcousticColor(tag)}`}
        >
          {getAcousticEmoji(tag)} {tag}
        </span>
      ))}
    </div>
  );
}
