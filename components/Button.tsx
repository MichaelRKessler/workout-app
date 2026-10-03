import { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-accent text-accent-ink hover:brightness-105 disabled:bg-panel-2 disabled:text-muted",
  secondary:
    "border border-line bg-panel text-foreground hover:bg-panel-2 disabled:text-muted",
  ghost: "text-muted hover:bg-panel hover:text-foreground disabled:text-muted",
  danger: "text-danger hover:bg-panel disabled:text-muted",
};

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-base font-semibold transition disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
