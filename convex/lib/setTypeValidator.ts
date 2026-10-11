import { v } from "convex/values";

export const setTypeValidator = v.union(
  v.literal("warmup"),
  v.literal("working"),
  v.literal("drop"),
  v.literal("failure"),
);
