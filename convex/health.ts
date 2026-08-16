"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";

export const checkVlyKey = action({
  args: {},
  handler: async () => {
    const key = process.env.VLY_INTEGRATION_KEY;
    return {
      hasKey: !!key,
      keyPrefix: (key || "").slice(0, 5),
      length: (key || "").length,
    };
  },
});
