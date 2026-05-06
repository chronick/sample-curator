import { type ReactNode } from "react";

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, value, hint, mono }: { label: string; value: ReactNode; hint?: string; mono?: boolean }) {
  return (
    <>
      <div className="flex justify-between items-center text-sm text-gray-400">
        <span>{label}</span>
        <span className={`text-gray-300 ${mono ? "font-mono text-xs" : "tabular-nums"}`}>{value}</span>
      </div>
      {hint && <p className="text-[10px] text-gray-500 -mt-1">{hint}</p>}
    </>
  );
}

export function PathRow({
  label,
  path,
  onReveal,
  hint,
  configurable = false,
}: {
  label: string;
  path: string;
  onReveal: () => void;
  hint?: string;
  configurable?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-gray-400 shrink-0">{label}</span>
        <div className="flex items-center gap-2 min-w-0">
          <code className="text-xs text-gray-300 bg-surface rounded px-2 py-1 truncate" title={path}>
            {prettifyHomePath(path)}
          </code>
          <button
            type="button"
            onClick={onReveal}
            className="text-xs px-2 py-1 bg-surface hover:bg-surface-hover border border-surface-border rounded shrink-0"
            title="Reveal in Finder"
          >
            Reveal
          </button>
        </div>
      </div>
      {hint && (
        <p className="text-[11px] text-gray-500">
          {hint}
          {!configurable && <span className="opacity-60"> · read-only in v1</span>}
        </p>
      )}
    </div>
  );
}

function prettifyHomePath(p: string): string {
  if (typeof window === "undefined") return p;
  return p.replace(/^\/Users\/[^/]+/, "~");
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  testId,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  testId?: string;
  title?: string;
}) {
  const cls =
    variant === "primary"
      ? "bg-accent hover:bg-accent-hover text-white"
      : variant === "danger"
      ? "bg-surface hover:bg-red-500/20 border border-surface-border text-red-400"
      : "bg-surface hover:bg-surface-hover border border-surface-border text-gray-200";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      title={title}
      className={`px-3 py-1.5 rounded text-sm transition-colors disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}
