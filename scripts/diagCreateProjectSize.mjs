// Measures fullText vs pageData size for the newest projects — identifies the
// value that exceeded Convex's 1MiB document limit at createProject.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const c = new ConvexHttpClient("https://successful-iguana-419.convex.cloud");
const all = await c.query(api.queries.getAllProjectsForWatchdog, {});
const sorted = [...all].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 4);
for (const p of sorted) {
  const ft = p.fullText ?? "";
  const pd = JSON.stringify(p.pageData ?? []);
  console.log(
    `${p._id} file=${p.fileName} status=${p.status} created=${new Date(p.createdAt).toISOString()}\n` +
    `  fullText=${(Buffer.byteLength(ft) / 1048576).toFixed(2)}MiB (${ft.length.toLocaleString()}ch)\n` +
    `  pageData=${(Buffer.byteLength(pd) / 1048576).toFixed(2)}MiB pages=${(p.pageData ?? []).length}\n` +
    `  pageDataStorageId=${p.pageDataStorageId ?? "—"}`
  );
}
process.exit(0);
