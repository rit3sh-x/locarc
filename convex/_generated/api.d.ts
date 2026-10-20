/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as auth from "../auth.js";
import type * as calibration from "../calibration.js";
import type * as control from "../control.js";
import type * as crons from "../crons.js";
import type * as emitters from "../emitters.js";
import type * as errors from "../errors.js";
import type * as fieldTests from "../fieldTests.js";
import type * as fixes from "../fixes.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as lib_alertRules from "../lib/alertRules.js";
import type * as lib_boardCodec from "../lib/boardCodec.js";
import type * as lib_calibration from "../lib/calibration.js";
import type * as lib_channelMath from "../lib/channelMath.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_errorFingerprint from "../lib/errorFingerprint.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_fieldTest from "../lib/fieldTest.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_guards from "../lib/guards.js";
import type * as lib_health from "../lib/health.js";
import type * as lib_heartbeat from "../lib/heartbeat.js";
import type * as lib_localization from "../lib/localization.js";
import type * as lib_pairing from "../lib/pairing.js";
import type * as lib_propagation from "../lib/propagation.js";
import type * as lib_readingCodec from "../lib/readingCodec.js";
import type * as lib_receiverJwt from "../lib/receiverJwt.js";
import type * as lib_retention from "../lib/retention.js";
import type * as lib_scanEmitters from "../lib/scanEmitters.js";
import type * as lib_schedule from "../lib/schedule.js";
import type * as lib_usage from "../lib/usage.js";
import type * as lib_webPush from "../lib/webPush.js";
import type * as live from "../live.js";
import type * as maintenance from "../maintenance.js";
import type * as operators from "../operators.js";
import type * as orgConfig from "../orgConfig.js";
import type * as push from "../push.js";
import type * as receiverAuth from "../receiverAuth.js";
import type * as receivers from "../receivers.js";
import type * as releases from "../releases.js";
import type * as runs from "../runs.js";
import type * as scans from "../scans.js";
import type * as setup from "../setup.js";
import type * as sync from "../sync.js";
import type * as team from "../team.js";
import type * as tests_seed from "../tests/seed.js";
import type * as watchlist from "../watchlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  auth: typeof auth;
  calibration: typeof calibration;
  control: typeof control;
  crons: typeof crons;
  emitters: typeof emitters;
  errors: typeof errors;
  fieldTests: typeof fieldTests;
  fixes: typeof fixes;
  health: typeof health;
  http: typeof http;
  "lib/alertRules": typeof lib_alertRules;
  "lib/boardCodec": typeof lib_boardCodec;
  "lib/calibration": typeof lib_calibration;
  "lib/channelMath": typeof lib_channelMath;
  "lib/config": typeof lib_config;
  "lib/crypto": typeof lib_crypto;
  "lib/errorFingerprint": typeof lib_errorFingerprint;
  "lib/errors": typeof lib_errors;
  "lib/fieldTest": typeof lib_fieldTest;
  "lib/geo": typeof lib_geo;
  "lib/guards": typeof lib_guards;
  "lib/health": typeof lib_health;
  "lib/heartbeat": typeof lib_heartbeat;
  "lib/localization": typeof lib_localization;
  "lib/pairing": typeof lib_pairing;
  "lib/propagation": typeof lib_propagation;
  "lib/readingCodec": typeof lib_readingCodec;
  "lib/receiverJwt": typeof lib_receiverJwt;
  "lib/retention": typeof lib_retention;
  "lib/scanEmitters": typeof lib_scanEmitters;
  "lib/schedule": typeof lib_schedule;
  "lib/usage": typeof lib_usage;
  "lib/webPush": typeof lib_webPush;
  live: typeof live;
  maintenance: typeof maintenance;
  operators: typeof operators;
  orgConfig: typeof orgConfig;
  push: typeof push;
  receiverAuth: typeof receiverAuth;
  receivers: typeof receivers;
  releases: typeof releases;
  runs: typeof runs;
  scans: typeof scans;
  setup: typeof setup;
  sync: typeof sync;
  team: typeof team;
  "tests/seed": typeof tests_seed;
  watchlist: typeof watchlist;
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

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
