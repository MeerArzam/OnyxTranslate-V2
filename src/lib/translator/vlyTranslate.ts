/**
 * vlyTranslate.ts — GUTTED.
 *
 * All VLY/DeepSeek translation logic has been moved to the Convex server
 * action at convex/translate.ts ("use node"), where the VLY_INTEGRATION_KEY
 * is read from process.env on the server and never exposed to the browser.
 *
 * This file is intentionally empty. Do NOT re-add @vly-ai/integrations
 * imports here — the browser bundle must never contain the VLY SDK.
 */
