/**
 * Renders /tmp/onyx/photo.png (an "ink-signature" style test image) using the
 * SAME Chromium build Playwright installed — no new deps.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const html = `<!doctype html><body style="margin:0;background:#fff">
<canvas id="c" width="640" height="360"></canvas>
<script>
  const c = document.getElementById("c");
  const g = c.getContext("2d");
  g.fillStyle = "#fdf6e3"; g.fillRect(0, 0, 640, 360);
  g.fillStyle = "#1a1a2e"; g.font = "600 42px Georgia, serif";
  g.fillText("The ember gates of Vaelthara", 30, 90);
  g.font = "28px Georgia, serif";
  g.fillText("opened only under a blood moon —", 30, 140);
  g.fillText("Kaelen had waited eleven years.", 30, 180);
  g.strokeStyle = "#8a2be2"; g.lineWidth = 3;
  g.beginPath(); g.moveTo(30, 220); g.bezierCurveTo(120, 180, 200, 260, 300, 220);
  g.bezierCurveTo(380, 190, 460, 250, 600, 210); g.stroke();
  document.title = "READY";
</script></body>`;

fs.writeFileSync("/tmp/onyx/photo.html", html);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file:///tmp/onyx/photo.html");
await page.waitForFunction(() => document.title === "READY");
const buf = await page.locator("#c").screenshot();
fs.writeFileSync("/tmp/onyx/photo.png", buf);
await browser.close();
console.log(`photo.png: ${(fs.statSync("/tmp/onyx/photo.png").size / 1024).toFixed(1)} KB`);
