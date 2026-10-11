import type { ExerciseIconKind } from "@/lib/exerciseIcon";
import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  strokeWidth?: number;
};

function Icon({
  strokeWidth = 1.75,
  className = "size-5",
  children,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {children}
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 6l6 6-6 6" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 6l-6 6 6 6" />
    </Icon>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4v4.5H8" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.4-4.4" />
    </Icon>
  );
}

export function RetryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4v5h5" />
      <path d="M4.6 15a8 8 0 1 0 1.9-8.3L4 9" />
    </Icon>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Icon>
  );
}

/** The app's tilted dumbbell, from public/icons/icon.svg. */
export function BrandMark({ className = "size-[22px]" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 512 512" className={className}>
      <g fill="currentColor" transform="rotate(35 256 256)">
        <rect x="174" y="222" width="164" height="68" rx="34" />
        <rect x="86" y="166" width="48" height="180" rx="24" />
        <rect x="158" y="166" width="48" height="180" rx="24" />
        <rect x="306" y="166" width="48" height="180" rx="24" />
        <rect x="378" y="166" width="48" height="180" rx="24" />
      </g>
    </svg>
  );
}

export function ExerciseGlyph({
  kind,
  className = "size-6",
  strokeWidth = 1.6,
}: {
  kind: ExerciseIconKind;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <Icon className={className} strokeWidth={strokeWidth}>
      {kind === "barbell" ? (
        <>
          <path d="M2 12h2M9 12h6M20 12h2" />
          <rect x="4" y="6" width="3" height="12" rx="1" />
          <rect x="7" y="8.5" width="2" height="7" rx="0.8" />
          <rect x="17" y="6" width="3" height="12" rx="1" />
          <rect x="15" y="8.5" width="2" height="7" rx="0.8" />
        </>
      ) : kind === "dumbbell" ? (
        <>
          <rect x="3" y="8" width="5" height="8" rx="1.5" />
          <rect x="16" y="8" width="5" height="8" rx="1.5" />
          <path d="M8 12h8" />
        </>
      ) : kind === "kettlebell" ? (
        <>
          <path d="M8.5 9.2V7.5a3.5 3.5 0 0 1 7 0v1.7" />
          <path d="M6 14.5a6 6 0 0 1 12 0c0 2.4-.9 4.2-1.8 5.5H7.8C6.9 18.7 6 16.9 6 14.5z" />
        </>
      ) : kind === "bodyweight" ? (
        <>
          <circle cx="12" cy="4.5" r="2" />
          <path d="M6 9.5l6 1 6-1" />
          <path d="M12 10.5V15" />
          <path d="M12 15l-3 5.5M12 15l3 5.5" />
        </>
      ) : kind === "machine" ? (
        <>
          <path d="M5 3h14" />
          <path d="M12 3v9" />
          <rect x="8" y="12" width="8" height="9" rx="1.5" />
          <path d="M8 15h8M8 18h8" />
        </>
      ) : (
        <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
      )}
    </Icon>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`animate-spin ${className}`}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
