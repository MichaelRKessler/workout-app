import { env } from "./_generated/server";

const authConfig = {
  providers: [
    {
      domain: env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
