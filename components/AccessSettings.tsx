"use client";

import { Button } from "@/components/Button";
import { SectionLabel } from "@/components/PageHeader";
import { api } from "@/convex/_generated/api";
import { readableError } from "@/lib/errors";
import { formatShortDate, formatTimeOfDay } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import { FormEvent, useState } from "react";

/** Allow list and pending requests. Renders nothing unless the viewer is the admin. */
export function AccessSettings() {
  const status = useQuery(api.access.myStatus);
  const isAdmin = status?.isAdmin === true;
  const allowed = useQuery(api.access.listAllowed, isAdmin ? {} : "skip");
  const pending = useQuery(api.access.listPending, isAdmin ? {} : "skip");
  const addEmail = useMutation(api.access.addEmail);
  const removeEmail = useMutation(api.access.removeEmail);
  const approve = useMutation(api.access.approve);
  const deny = useMutation(api.access.deny);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!isAdmin) {
    return null;
  }

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = email.trim();
    if (next.length === 0) {
      setError("Enter a valid email address");
      return;
    }
    await run("add", async () => {
      await addEmail({ email: next });
      setEmail("");
    });
  }

  return (
    <section aria-labelledby="settings-access" className="mt-7">
      <SectionLabel id="settings-access">Access</SectionLabel>
      <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
        <form onSubmit={(event) => void onAdd(event)} className="border-b border-line p-4">
          <label htmlFor="allow-email" className="text-[11px] font-medium tracking-[0.1em] text-subtle uppercase">
            Add an email
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="allow-email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              maxLength={320}
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-background px-3 text-[15px] outline-none focus:border-foreground"
            />
            <Button type="submit" disabled={busy !== null}>
              {busy === "add" ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>

        {allowed === undefined ? (
          <p className="px-4 py-4 text-[15px] text-muted">Loading the allow list…</p>
        ) : (
          <ul>
            {allowed.map((entry) => (
              <li
                key={entry.email}
                className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{entry.email}</span>
                  {entry.isAdmin ? (
                    <span className="block text-[13px] text-muted">Admin</span>
                  ) : null}
                </span>
                {entry.isAdmin ? null : (
                  <button
                    type="button"
                    className="shrink-0 text-[15px] font-medium text-danger disabled:opacity-50"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`remove:${entry.email}`, () => removeEmail({ email: entry.email }))
                    }
                  >
                    {busy === `remove:${entry.email}` ? "Removing…" : "Remove"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <h3 className="mt-5 mb-1 text-[11px] font-medium tracking-[0.1em] text-subtle uppercase">
        Pending requests
      </h3>
      <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
        {pending === undefined ? (
          <p className="px-4 py-4 text-[15px] text-muted">Loading requests…</p>
        ) : pending.length === 0 ? (
          <p className="px-4 py-4 text-[15px] text-muted">No one is waiting.</p>
        ) : (
          <ul>
            {pending.map((request) => (
              <li key={request._id} className="border-b border-line px-4 py-3.5 last:border-b-0">
                <p className="truncate text-[15px] font-medium">{request.email}</p>
                {request.note ? (
                  <p className="mt-1 text-[14px] leading-normal text-pretty text-muted">{request.note}</p>
                ) : null}
                <p className="mt-1 text-[13px] text-subtle">
                  <time dateTime={new Date(request.createdAt).toISOString()} suppressHydrationWarning>
                    {formatShortDate(request.createdAt)} · {formatTimeOfDay(request.createdAt)}
                  </time>
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`approve:${request._id}`, () => approve({ requestId: request._id }))
                    }
                  >
                    {busy === `approve:${request._id}` ? "Approving…" : "Approve"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`deny:${request._id}`, () => deny({ requestId: request._id }))
                    }
                  >
                    {busy === `deny:${request._id}` ? "Denying…" : "Deny"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm leading-5 text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
