import { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "md" | "lg";
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-inverse text-inverse-ink hover:opacity-90 disabled:opacity-40",
  secondary:
    "border border-line bg-surface text-foreground hover:bg-fill-2 disabled:text-subtle",
  outline:
    "border border-foreground text-foreground hover:bg-fill-2 disabled:border-line disabled:text-subtle",
  ghost: "text-foreground hover:bg-fill-2 disabled:text-subtle",
  danger: "text-danger hover:bg-fill-2 disabled:opacity-50",
};

const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
  md: "min-h-11 px-5 text-[15px]",
  lg: "min-h-[52px] px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
