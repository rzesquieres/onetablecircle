import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white active:bg-brand-strong disabled:opacity-50",
  secondary:
    "border border-line bg-surface text-ink active:bg-muted disabled:opacity-50",
  ghost: "text-ink active:bg-muted disabled:opacity-50",
  danger: "text-danger active:bg-danger/10 disabled:opacity-50",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition-colors ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 ${className}`}
      {...props}
    />
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink-soft">
      {children}
    </label>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" | "warn" }) {
  const tones = {
    info: "border-line bg-muted text-ink",
    error: "border-danger/30 bg-danger/10 text-danger",
    warn: "border-warn/40 bg-warn/10 text-ink",
  };
  return (
    <p role={tone === "error" ? "alert" : undefined} className={`rounded-xl border px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </p>
  );
}

export function Chip({
  selected,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${
        selected ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink active:bg-muted"
      } ${className}`}
      {...props}
    />
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-ink-soft" role="status">
      {label}
    </div>
  );
}
