import "server-only";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { LengthUnit } from "@/convex/lib/bodyMeasures";
import { defaultLengthUnit } from "@/convex/lib/bodyMeasures";
import type { WeightUnit } from "@/convex/lib/units";
import { readVoiceAccess } from "./access";

export type RouteUser = {
  token: string | undefined;
  signedIn: boolean;
  allowed: boolean;
};

/** The signed-in person behind an API route request, and whether they are on the allow list. */
export async function loadRouteUser(): Promise<RouteUser> {
  const token = await convexAuthNextjsToken();
  let status: { allowed: boolean } | null = null;
  if (token && process.env.NEXT_PUBLIC_CONVEX_URL) {
    try {
      const access = await fetchQuery(api.access.myStatus, {}, { token });
      status = { allowed: access.allowed };
    } catch {
      status = null;
    }
  }
  return { token, ...readVoiceAccess({ token, status }) };
}

/** Their saved units, or pounds and inches when they can't be read. */
export async function loadRoutePreferences(
  user: RouteUser,
): Promise<{ weightUnit: WeightUnit; lengthUnit: LengthUnit }> {
  if (!user.signedIn || !user.allowed || !user.token || !process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { weightUnit: "lb", lengthUnit: "in" };
  }
  try {
    const row = await fetchQuery(api.users.preferences, {}, { token: user.token });
    const weightUnit = row.weightUnit === "kg" ? "kg" : "lb";
    const lengthUnit =
      row.lengthUnit === "cm" || row.lengthUnit === "in" ? row.lengthUnit : defaultLengthUnit(weightUnit);
    return { weightUnit, lengthUnit };
  } catch {
    return { weightUnit: "lb", lengthUnit: "in" };
  }
}
