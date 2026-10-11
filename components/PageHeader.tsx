import { ChevronLeftIcon } from "@/components/icons";
import Link from "next/link";
import { ReactNode } from "react";

export function PageHeader({
  backHref,
  backLabel = "Back",
  title,
  children,
}: {
  backHref: string;
  backLabel?: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header>
      <Link
        href={backHref}
        aria-label={backLabel}
        className="-ml-3 flex size-11 items-center justify-center rounded-full text-foreground hover:bg-fill-2"
      >
        <ChevronLeftIcon className="size-6" strokeWidth={1.8} />
      </Link>
      <h1 className="mt-1.5 text-title leading-tight font-semibold tracking-[-0.03em]">{title}</h1>
      {children}
    </header>
  );
}

export function SectionLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mb-1 text-xs font-medium tracking-[0.06em] text-subtle uppercase">
      {children}
    </h2>
  );
}
