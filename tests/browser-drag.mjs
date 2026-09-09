import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseURL = process.env.MESH_WORKSHOP_URL || "http://127.0.0.1:5351";
let server;
if (!process.env.MESH_WORKSHOP_URL) {
  server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "5351",
      "--strictPort",
    ],
    { cwd: repo, stdio: "ignore" },
  );
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(baseURL)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "The standalone Vite server starts.");
}
const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const errors = [],
  results = [];
page.on("pageerror", (e) => errors.push(e.message));
const canvas = page.locator(".graphics-workbench__viewport canvas");
const button = (name) => page.getByRole("button", { name, exact: true });
const status = () => page.locator("[role=status]").innerText();
const settle = () => page.waitForTimeout(100);
const count = async (key) => Number(await canvas.getAttribute(`data-${key}`));
const point = async (x, y) => {
  const r = await canvas.boundingBox();
  return [r.x + r.width * x, r.y + r.height * y];
};
async function reset() {
  await button("Reset to cube").click();
  await page.evaluate(() => scrollTo(0, 0));
  await settle();
}
async function down(x = 0.5, y = 0.32) {
  const p = await point(x, y);
  await page.mouse.move(...p);
  await page.mouse.down();
  return p;
}
async function exportMesh() {
  const wait = page.waitForEvent("download");
  await button("Export OBJ").click();
  const d = await wait;
  return fs.readFile(await d.path(), "utf8");
}
const parse = (text) => ({
  vertices: text
    .split("\n")
    .filter((l) => l.startsWith("v "))
    .map((l) => l.split(" ").slice(1).map(Number)),
  faces: text
    .split("\n")
    .filter((l) => l.startsWith("f "))
    .map((l) => l.split(" ").slice(1).map(Number)),
});
async function screenshot(name) {
  await fs.mkdir(path.join(repo, "examples"), { recursive: true });
  await page
    .locator(".graphics-workbench__viewport")
    .screenshot({ path: path.join(repo, "examples", name) });
}
try {
  await page.goto(baseURL);
  await page.evaluate(() => document.fonts.ready);
  await canvas.waitFor();
  await settle();
  assert.equal(
    await button("Extrude face").count(),
    0,
    "No button-based extrusion workflow remains.",
  );
  assert.equal(await count("face-count"), 6);
  const original = await exportMesh();
  assert.equal(parse(original).vertices.length, 8);
  await page.evaluate(() => scrollTo(0, 0));
  await settle();
  await down();
  await page.mouse.up();
  assert.equal(await count("selected-face"), 5);
  assert.equal(await count("face-count"), 6);
  assert.equal(await count("undo-count"), 0);
  await down(0.59, 0.55);
  await page.mouse.up();
  assert.equal(
    await count("selected-face"),
    3,
    "Nearest visible +X face wins over the occluded -X face.",
  );
  assert.equal(await count("undo-count"), 0);
  await reset();
  let start = await down();
  for (const dy of [-35, -100, -65]) {
    await page.mouse.move(start[0], start[1] + dy, { steps: 6 });
    assert.equal(await count("face-count"), 10);
    assert.equal(await count("undo-count"), 0);
  }
  await screenshot("01.png");
  await page.mouse.up();
  assert.equal(await count("undo-count"), 1);
  const first = parse(await exportMesh());
  assert.equal(first.faces.length, 10);
  assert.equal(first.vertices.length, 12);
  assert.deepEqual(first.vertices.slice(0, 8), parse(original).vertices);
  assert.ok(first.vertices.slice(8).every((v) => v[1] > 1.2 && v[1] < 3));
  await button("Undo edit").click();
  assert.equal(
    await exportMesh(),
    original,
    "One Undo restores the entire drag, byte for byte.",
  );
  results.push(
    "Actual front-face picks, topology preview, one-release history entry, and exported cap displacement.",
  );

  await reset();
  start = await down();
  await page.mouse.move(start[0], start[1] - 75, { steps: 8 });
  assert.equal(await count("face-count"), 10);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await count("face-count"), 6);
  assert.equal(await count("undo-count"), 0);
  assert.equal(await exportMesh(), original);
  await reset();
  start = await down();
  await page.mouse.move(start[0], start[1] - 70, { steps: 8 });
  await page.mouse.move(start[0], start[1], { steps: 10 });
  await page.mouse.up();
  assert.equal(await exportMesh(), original);
  assert.equal(await count("undo-count"), 0);
  await reset();
  start = await down();
  await page.mouse.move(start[0], start[1] - 60, { steps: 6 });
  await canvas.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  assert.equal(await exportMesh(), original);
  assert.equal(await count("undo-count"), 0);
  results.push(
    "Escape, pointer cancellation and returning exactly to the start all restore the original mesh without undo pollution.",
  );

  await reset();
  await page.getByLabel("Drag operation").selectOption("bevel");
  await page.evaluate(() => scrollTo(0, 0));
  start = await down();
  await page.mouse.move(start[0], start[1] - 85, { steps: 10 });
  await page.mouse.up();
  const beveled = parse(await exportMesh());
  assert.equal(beveled.faces.length, 10);
  assert.ok(
    beveled.vertices
      .slice(8)
      .every((v) => Math.abs(v[0]) < 1 && Math.abs(v[2]) < 1 && v[1] > 1),
  );
  await page.evaluate(() => scrollTo(0, 0));
  await screenshot("02.png");
  await reset();
  await page.getByLabel("Drag operation").selectOption("extrude");
  const keyboard = page.locator("input[type=range]").first();
  await keyboard.focus();
  await keyboard.fill("0.25");
  await keyboard.dispatchEvent("input");
  await page.keyboard.press("Enter");
  const typed = parse(await exportMesh());
  assert.equal(typed.faces.length, 10);
  assert.ok(typed.vertices.slice(8).every((v) => Math.abs(v[1] - 1.25) < 1e-6));
  results.push(
    "Bevel drag creates sloped shoulders; keyboard distance plus Enter provides an accessible equivalent.",
  );

  await reset();
  const beforeOrbit = await canvas.evaluate((c) => c.toDataURL());
  let p = await point(0.12, 0.7);
  await page.mouse.move(...p);
  await page.mouse.down();
  await page.mouse.move(p[0] + 100, p[1] - 30, { steps: 10 });
  await page.mouse.up();
  await settle();
  assert.notEqual(await canvas.evaluate((c) => c.toDataURL()), beforeOrbit);
  assert.equal(await exportMesh(), original);
  await reset();
  const beforeRight = await canvas.evaluate((c) => c.toDataURL());
  p = await point(0.5, 0.45);
  await page.mouse.move(...p);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(p[0] + 110, p[1] - 15, { steps: 10 });
  await page.mouse.up({ button: "right" });
  await settle();
  assert.notEqual(await canvas.evaluate((c) => c.toDataURL()), beforeRight);
  assert.equal(await exportMesh(), original);
  results.push(
    "Background dragging and right-dragging orbit the view without editing geometry.",
  );

  await page.goto(`${baseURL}/tests/fixtures/lifecycle.html`);
  await canvas.waitFor();
  await settle();
  const cameraBefore = await page.evaluate(() =>
    window.fixture.ctx.camera.position.toArray(),
  );
  let orbitStart = await point(0.12, 0.7);
  await page.mouse.move(...orbitStart);
  await page.mouse.down();
  await page.mouse.move(orbitStart[0] + 100, orbitStart[1] - 30, { steps: 10 });
  await page.mouse.up();
  await settle();
  assert.notDeepEqual(
    await page.evaluate(() => window.fixture.ctx.camera.position.toArray()),
    cameraBefore,
    "The actual camera position changes during a background orbit.",
  );
  await button("Reset view").click();
  await page.evaluate(() => scrollTo(0, 0));
  await settle();
  const cameraRightBefore = await page.evaluate(() =>
    window.fixture.ctx.camera.position.toArray(),
  );
  orbitStart = await point(0.5, 0.45);
  await page.mouse.move(...orbitStart);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(orbitStart[0] + 100, orbitStart[1], { steps: 10 });
  await page.mouse.up({ button: "right" });
  await settle();
  assert.notDeepEqual(
    await page.evaluate(() => window.fixture.ctx.camera.position.toArray()),
    cameraRightBefore,
    "Right-drag changes the actual camera instead of manipulating a face.",
  );
  await button("Reset view").click();
  await page.evaluate(() => scrollTo(0, 0));
  await settle();
  start = await down();
  await page.mouse.move(start[0], start[1] - 70, { steps: 8 });
  assert.equal(await count("face-count"), 10);
  await page.evaluate(() => window.tool.deactivate());
  await page.mouse.up();
  assert.equal(await exportMesh(), original);
  assert.equal(await count("undo-count"), 0);
  await page.evaluate(() => window.tool.activate());
  results.push(
    "Deactivation during a drag rolls back and releases pointer capture for cached tool switches.",
  );

  await page.goto(baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.fonts.ready);
  await settle();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const cdp = await page.context().newCDPSession(page);
  start = await point(0.5, 0.34);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: start[0], y: start[1], id: 1 }],
  });
  for (let dy = 10; dy <= 70; dy += 10)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: start[0], y: start[1] - dy, id: 1 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.equal(
    await count("face-count"),
    10,
    "A genuine touch gesture extrudes the face.",
  );
  assert.equal(await count("undo-count"), 1);
  await page.screenshot({
    path: path.join(repo, "examples", "mobile-drag.png"),
  });
  results.push(
    "390px mobile layout stays within the screen and real CDP touch dragging edits a face.",
  );
  assert.deepEqual(errors, []);
  await fs.mkdir(path.join(repo, "output"), { recursive: true });
  await fs.writeFile(
    path.join(repo, "output", "browser-drag-results.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(results.join("\n"));
} finally {
  await browser.close();
  if (server) server.kill("SIGTERM");
}
