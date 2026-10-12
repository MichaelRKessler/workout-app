/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as auth from "../auth.js";
import type * as body from "../body.js";
import type * as exercises from "../exercises.js";
import type * as exerciseStats from "../exerciseStats.js";
import type * as exportData from "../exportData.js";
import type * as http from "../http.js";
import type * as lib_accessControl from "../lib/accessControl.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_clientIds from "../lib/clientIds.js";
import type * as lib_customFunctions from "../lib/customFunctions.js";
import type * as lib_exerciseName from "../lib/exerciseName.js";
import type * as lib_offlineSync from "../lib/offlineSync.js";
import type * as lib_workouts from "../lib/workouts.js";
import type * as offline from "../offline.js";
import type * as routines from "../routines.js";
import type * as sessions from "../sessions.js";
import type * as sets from "../sets.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  auth: typeof auth;
  body: typeof body;
  exerciseStats: typeof exerciseStats;
  exercises: typeof exercises;
  exportData: typeof exportData;
  http: typeof http;
  "lib/accessControl": typeof lib_accessControl;
  "lib/auth": typeof lib_auth;
  "lib/clientIds": typeof lib_clientIds;
  "lib/customFunctions": typeof lib_customFunctions;
  "lib/exerciseName": typeof lib_exerciseName;
  "lib/offlineSync": typeof lib_offlineSync;
  "lib/workouts": typeof lib_workouts;
  offline: typeof offline;
  routines: typeof routines;
  sessions: typeof sessions;
  sets: typeof sets;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
