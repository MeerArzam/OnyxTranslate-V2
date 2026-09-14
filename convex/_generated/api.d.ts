/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as artifactMutations from "../artifactMutations.js";
import type * as exportProject from "../exportProject.js";
import type * as generatePdf from "../generatePdf.js";
import type * as history from "../history.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as importJob from "../importJob.js";
import type * as jobMutations from "../jobMutations.js";
import type * as jobProcessing from "../jobProcessing.js";
import type * as liveTest from "../liveTest.js";
import type * as liveTestStore from "../liveTestStore.js";
import type * as mutations from "../mutations.js";
import type * as parsePdf from "../parsePdf.js";
import type * as pdfLayout from "../pdfLayout.js";
import type * as queries from "../queries.js";
import type * as renderPdfCore from "../renderPdfCore.js";
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
  artifactMutations: typeof artifactMutations;
  exportProject: typeof exportProject;
  generatePdf: typeof generatePdf;
  history: typeof history;
  http: typeof http;
  identity: typeof identity;
  importJob: typeof importJob;
  jobMutations: typeof jobMutations;
  jobProcessing: typeof jobProcessing;
  liveTest: typeof liveTest;
  liveTestStore: typeof liveTestStore;
  mutations: typeof mutations;
  parsePdf: typeof parsePdf;
  pdfLayout: typeof pdfLayout;
  queries: typeof queries;
  renderPdfCore: typeof renderPdfCore;
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
