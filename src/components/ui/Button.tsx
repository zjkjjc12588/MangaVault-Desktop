import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { cn } from "../../lib/cn";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "subtle" | "danger";
  size?: "sm" | "md" | "icon";
}

export function Button({
  className,
  variant = "subtle",
  size = "md",
  children,
  title,
  "aria-label": ariaLabel,
  ...props
}: PropsWithChildren<ButtonProps>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "border-transparent bg-accent text-accentText hover:bg-accent/90",
        variant === "ghost" && "border-transparent bg-transparent hover:bg-panelMuted",
        variant === "subtle" && "border-border bg-panelMuted hover:bg-border/60",
        variant === "danger" && "border-transparent bg-danger text-white hover:bg-danger/90",
        size === "sm" && "h-8 px-2.5 text-sm",
        size === "md" && "h-10 px-3 text-sm",
        size === "icon" && "h-9 w-9",
        className,
      )}
      title={title}
      aria-label={ariaLabel ?? title}
      {...props}
    >
      {children}
    </button>
  );
}
