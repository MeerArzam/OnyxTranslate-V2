import { Hono } from "hono";
import { serveStatic } from "hono/deno";

const app = new Hono();

// 1) Serve vendor files — strip query params (?import) that browsers add for
//    dynamic ESM imports so the file lookup succeeds.
app.get("/vendor/*", (c) => {
  const url = new URL(c.req.url);
  return serveStatic({ path: `./dist${url.pathname}` })(c);
});

// 2) Serve anything in /assets/**
app.use("/assets/*", serveStatic({ root: "./dist/assets" }));

// 3) Catch *all* other files in dist (CSS, JS, images, etc.)
app.use("*", serveStatic({ root: "./dist" }));

// 4) Fallback to index.html for the SPA
app.get("*", serveStatic({ path: "./dist/index.html" }));

Deno.serve(app.fetch);
