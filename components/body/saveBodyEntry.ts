import type { BodySave } from "@/lib/bodyDraft";
import type { PendingBody } from "@/lib/offline/outbox";

export function newBodyClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function toPending(clientId: string, save: BodySave): Omit<PendingBody, "syncError" | "echoed"> {
  return {
    clientId,
    loggedAt: save.loggedAt,
    weightLb: save.weightLb ?? null,
    bodyFatPct: save.bodyFatPct ?? null,
    waistCm: save.waistCm ?? null,
    chestCm: save.chestCm ?? null,
    armCm: save.armCm ?? null,
    hipsCm: save.hipsCm ?? null,
    thighCm: save.thighCm ?? null,
    note: save.note ?? null,
  };
}
