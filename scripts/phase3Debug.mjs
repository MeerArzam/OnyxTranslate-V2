import { chromium } from "playwright";
import { spawn } from "node:child_process";
import http from "node:http";

const BASE = "http://127.0.0.1:4199";
const server = spawn("bunx", ["vite", "preview", "--port", "4199", "--strictPort"], { stdio: "ignore" });
await new Promise((res, rej) => {
  const t0 = Date.now();
  const probe = () => {
    const req = http.get(BASE, res);
    req.on("error", () => Date.now() - t0 < 30000 ? setTimeout(probe, 500) : rej(new Error("no server")));
    req.setTimeout(2000, () => { req.destroy(); });
  };
  probe();
});
const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[PAGEERROR] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[REQFAIL] ${r.method()} ${r.url().slice(0, 90)} :: ${r.failure()?.errorText}`));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.getByText("Drop PDF here or click to browse").waitFor({ timeout: 20000 });
await page.setInputFiles('input[type="file"][accept=".pdf,application/pdf"]', "/tmp/onyx/image-1p.pdf");
await page.waitForTimeout(8000);
console.log("--- BODY ---");
console.log((await page.locator("body").innerText()).slice(0, 1800));
console.log("--- LOGS ---");
console.log(logs.slice(-30).join("\n"));
await page.screenshot({ path: "/tmp/onyx/shots/debug-upload.png" });
await browser.close();
server.kill("SIGTERM");
process.exit(0);
