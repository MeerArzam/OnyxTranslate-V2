#!/usr/bin/env node
// TEMP rate/dispatcher diagnostic — deleted after report.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const c = new ConvexHttpClient("https://quixotic-tapir-141.convex.cloud");
const P = process.argv[2] ?? "kd7c7ya0eebxk74xq0qt7kbred8f71py";
const rate = await c.query(api.adaptiveTestProbes.probeRateSnapshot, { projectId: P }).catch((e) => ({ err: e.message.slice(0, 200) }));
console.log("RATE:", JSON.stringify(rate).slice(0, 400));
const proj = await c.query(api.queries.getProjectRaw, { projectId: P });
console.log("PROJ:", JSON.stringify({
  status: proj?.status, governorState: proj?.governorState,
  lastDispatcherAt: proj?.lastDispatcherAt, lastDispatcherError: proj?.lastDispatcherError,
  activeWorkerCount: proj?.activeWorkerCount, requestsToday: proj?.requestsToday,
  consecutive429Count: proj?.consecutive429Count,
}));
const jobs = await c.query(api.adaptiveTestProbes.probeJobsByProject, { projectId: P });
console.log("JOB:", JSON.stringify((jobs?.jobs ?? [])[0]));
