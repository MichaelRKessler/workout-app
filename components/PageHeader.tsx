import { ChevronLeftIcon } from "@/components/icons";
import Link from "next/link";
import { ReactNode } from "react";

export function PageHeader({
  backHref,
  backLabel = "Back",
  title,
  action,
  children,
}: {
  /** Left out on the tab bar's own pages, which need no way back. */
  backHref?: string;
  backLabel?: string;
  title: ReactNode;
  /** A small button on the title's line, such as Edit. */
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header>
      {backHref ? (
        <Link
          href={backHref}
          aria-label={backLabel}
          className="-ml-3 flex size-11 items-center justify-center rounded-full text-foreground hover:bg-fill-2"
        >
          <ChevronLeftIcon className="size-6" strokeWidth={1.8} />
        </Link>
      ) : null}
      {action ? (
        <div className={`${backHref ? "mt-1.5" : "mt-3"} flex items-center justify-between gap-3`}>
          <h1 className="min-w-0 text-title leading-tight font-semibold tracking-[-0.03em]">{title}</h1>
          <div className="shrink-0">{action}</div>
        </div>
      ) : (
        <h1 className={`${backHref ? "mt-1.5" : "mt-3"} text-title leading-tight font-semibold tracking-[-0.03em]`}>{title}</h1>
      )}
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
