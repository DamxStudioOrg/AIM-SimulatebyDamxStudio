import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const failed = [];
page.on("requestfailed", (r) => {
  const failure = r.failure();
  failed.push(r.url().slice(0, 110) + " :: " + (failure ? failure.errorText : "?"));
});
page.on("response", (r) => {
  if (r.status() >= 400) failed.push(r.status() + " " + r.url().slice(0, 110));
});
const errs = [];
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text().slice(0, 220));
});
page.on("pageerror", (e) => {
  errs.push("PAGEERROR: " + String(e).slice(0, 220));
});
await page
  .goto("http://localhost:3007/console", { waitUntil: "load", timeout: 60000 })
  .catch((e) => console.log("goto: " + String(e).split("\n")[0]));
await page.waitForTimeout(8000);
console.log("--- failed/bad requests:", failed.length);
for (const f of failed.slice(0, 12)) console.log(" *", f);
console.log("--- console/page errors:", errs.length);
for (const e of errs.slice(0, 8)) console.log(" *", e);
const state = await page.evaluate(() => {
  const canvas = document.querySelector("canvas.site-bg");
  const gate = document.body.innerText.includes("Sign in to run") ? "gated" : "open";
  return { canvas: canvas ? "present" : "absent", gate };
});
console.log("state:", JSON.stringify(state));
try {
  await page.getByRole("button", { name: "Create account" }).click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() =>
    document.body.innerText.includes("Sign in to run") ? "still-gated" : "changed",
  );
  console.log("after-click:", after);
} catch (e) {
  console.log("click failed: " + String(e).split("\n")[0]);
}
await page.screenshot({ path: "/tmp/prod-probe.png" });
await browser.close();
