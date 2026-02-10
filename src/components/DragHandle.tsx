import { useCallback, type MouseEvent as ReactMouseEvent } from "react";

export function DragHandle({
  direction,
  onDrag,
}: {
  direction: "horizontal" | "vertical";
  onDrag: (delta: number) => void;
}) {
  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      document.body.style.userSelect = "none";
      document.body.style.cursor =
        direction === "vertical" ? "col-resize" : "row-resize";

      let lastPos = direction === "vertical" ? e.clientX : e.clientY;

      const onMouseMove = (ev: MouseEvent) => {
        const current = direction === "vertical" ? ev.clientX : ev.clientY;
        onDrag(current - lastPos);
        lastPos = current;
      };

      const onMouseUp = () => {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [direction, onDrag]
  );

  const isVertical = direction === "vertical";

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`flex-shrink-0 ${
        isVertical
          ? "w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent/60"
          : "h-1 cursor-row-resize hover:bg-accent/40 active:bg-accent/60"
      } bg-surface-border transition-colors group relative`}
    >
      {/* Wider invisible hit area */}
      <div
        className={`absolute ${
          isVertical
            ? "inset-y-0 -left-1 -right-1"
            : "inset-x-0 -top-1 -bottom-1"
        }`}
      />
    </div>
  );
}
