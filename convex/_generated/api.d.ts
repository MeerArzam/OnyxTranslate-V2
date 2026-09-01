/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as exportImport from "../exportImport.js";
import type * as generatePdf from "../generatePdf.js";
import type * as health from "../health.js";
import type * as history from "../history.js";
import type * as mutations from "../mutations.js";
import type * as parsePdf from "../parsePdf.js";
import type * as queries from "../queries.js";
import type * as translate from "../translate.js";
import type * as translateContent from "../translateContent.js";
import type * as translateImage from "../translateImage.js";
import type * as translateQueue from "../translateQueue.js";
import type * as upload from "../upload.js";
import type * as zipAssembly from "../zipAssembly.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  exportImport: typeof exportImport;
  generatePdf: typeof generatePdf;
  health: typeof health;
  history: typeof history;
  mutations: typeof mutations;
  parsePdf: typeof parsePdf;
  queries: typeof queries;
  translate: typeof translate;
  translateContent: typeof translateContent;
  translateImage: typeof translateImage;
  translateQueue: typeof translateQueue;
  upload: typeof upload;
  zipAssembly: typeof zipAssembly;
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
