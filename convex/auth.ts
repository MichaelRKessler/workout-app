import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { recordSignInAccess } from "./lib/accessControl";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
  callbacks: {
    // Keep the sign-in itself. Someone who is not allow-listed still needs a
    // session so they can request access. Workout functions and /api/voice
    // reject them until the admin approves the email.
    async afterUserCreatedOrUpdated(ctx, args) {
      const email = typeof args.profile.email === "string" ? args.profile.email : null;
      await recordSignInAccess(ctx as unknown as MutationCtx, {
        userId: args.userId as Id<"users">,
        email,
      });
    },
  },
});
