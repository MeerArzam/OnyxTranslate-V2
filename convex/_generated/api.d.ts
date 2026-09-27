/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adaptiveDispatcher from "../adaptiveDispatcher.js";
import type * as adaptiveJobs from "../adaptiveJobs.js";
import type * as adaptivePdf from "../adaptivePdf.js";
import type * as adaptiveTestProbes from "../adaptiveTestProbes.js";
import type * as adaptiveWatchdog from "../adaptiveWatchdog.js";
import type * as artifactMutations from "../artifactMutations.js";
import type * as buildTranslationPrompt from "../buildTranslationPrompt.js";
import type * as crons from "../crons.js";
import type * as exportProject from "../exportProject.js";
import type * as forensicProbe from "../forensicProbe.js";
import type * as generatePdf from "../generatePdf.js";
import type * as history from "../history.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as importJob from "../importJob.js";
import type * as jobMutations from "../jobMutations.js";
import type * as jobProcessing from "../jobProcessing.js";
import type * as languageRules from "../languageRules.js";
import type * as liveTest from "../liveTest.js";
import type * as liveTestStore from "../liveTestStore.js";
import type * as mutations from "../mutations.js";
import type * as parsePdf from "../parsePdf.js";
import type * as pdfLayout from "../pdfLayout.js";
import type * as probes from "../probes.js";
import type * as queries from "../queries.js";
import type * as renderPdfCore from "../renderPdfCore.js";
import type * as resumeServerProject from "../resumeServerProject.js";
import type * as sourceData from "../sourceData.js";
import type * as textPdf from "../textPdf.js";
import type * as textPdfState from "../textPdfState.js";
import type * as translateContent from "../translateContent.js";
import type * as translateImage from "../translateImage.js";
import type * as translateQueue from "../translateQueue.js";
import type * as translationConfig from "../translationConfig.js";
import type * as translationContract from "../translationContract.js";
import type * as translationContractMutation from "../translationContractMutation.js";
import type * as upload from "../upload.js";
import type * as zipAssembly from "../zipAssembly.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adaptiveDispatcher: typeof adaptiveDispatcher;
  adaptiveJobs: typeof adaptiveJobs;
  adaptivePdf: typeof adaptivePdf;
  adaptiveTestProbes: typeof adaptiveTestProbes;
  adaptiveWatchdog: typeof adaptiveWatchdog;
  artifactMutations: typeof artifactMutations;
  buildTranslationPrompt: typeof buildTranslationPrompt;
  crons: typeof crons;
  exportProject: typeof exportProject;
  forensicProbe: typeof forensicProbe;
  generatePdf: typeof generatePdf;
  history: typeof history;
  http: typeof http;
  identity: typeof identity;
  importJob: typeof importJob;
  jobMutations: typeof jobMutations;
  jobProcessing: typeof jobProcessing;
  languageRules: typeof languageRules;
  liveTest: typeof liveTest;
  liveTestStore: typeof liveTestStore;
  mutations: typeof mutations;
  parsePdf: typeof parsePdf;
  pdfLayout: typeof pdfLayout;
  probes: typeof probes;
  queries: typeof queries;
  renderPdfCore: typeof renderPdfCore;
  resumeServerProject: typeof resumeServerProject;
  sourceData: typeof sourceData;
  textPdf: typeof textPdf;
  textPdfState: typeof textPdfState;
  translateContent: typeof translateContent;
  translateImage: typeof translateImage;
  translateQueue: typeof translateQueue;
  translationConfig: typeof translationConfig;
  translationContract: typeof translationContract;
  translationContractMutation: typeof translationContractMutation;
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
