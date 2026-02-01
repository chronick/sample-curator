/**
 * Score indicator with color coding.
 */

interface ScoreIndicatorProps {
  score: number | null;
  showNumber?: boolean;
}

export function ScoreIndicator({ score, showNumber = true }: ScoreIndicatorProps) {
  if (score === null) {
    return <span className="text-xs text-gray-500">-</span>;
  }

  const getColor = (score: number) => {
    if (score >= 70) return "text-score-high";
    if (score >= 40) return "text-score-medium";
    return "text-score-low";
  };

  const getBarColor = (score: number) => {
    if (score >= 70) return "bg-score-high";
    if (score >= 40) return "bg-score-medium";
    return "bg-score-low";
  };

  return (
    <div className="flex items-center gap-1">
      {showNumber && (
        <span className={`text-xs font-medium ${getColor(score)}`}>
          {Math.round(score)}
        </span>
      )}
      <div className="w-12 h-1.5 bg-surface-border rounded-full overflow-hidden">
        <div
          className={`h-full ${getBarColor(score)} transition-all`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

export default ScoreIndicator;
