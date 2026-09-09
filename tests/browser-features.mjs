import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
const server = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  cacheDir: ".vite/features",
});
await server.listen();
const browser = await chromium.launch({ channel: "chromium" });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/lifecycle.html`,
  );
  await page.waitForFunction(() => window.fixture);
  const canvas = page.locator(".graphics-workbench__viewport canvas"),
    button = (name) => page.getByRole("button", { name, exact: true }),
    selection = page.getByRole("combobox", { name: "Selection", exact: true });
  const dump = async () => {
    const pending = page.waitForEvent("download");
    await button("Export OBJ").click();
    const file = await pending,
      text = await readFile(await file.path(), "utf8");
    return {
      text,
      vertices: text
        .split("\n")
        .filter((l) => l.startsWith("v "))
        .map((l) => l.split(" ").slice(1).map(Number)),
      faces: text
        .split("\n")
        .filter((l) => l.startsWith("f "))
        .map((l) => l.split(" ").slice(1).map(Number)),
    };
  };
  async function point(world) {
    await canvas.scrollIntoViewIfNeeded();
    return page.evaluate((world) => {
      const { THREE: T, camera, canvas } = window.fixture.ctx;
      camera.updateMatrixWorld();
      const p = new T.Vector3(...world).project(camera),
        r = canvas.getBoundingClientRect();
      return [
        r.x + ((p.x + 1) * r.width) / 2,
        r.y + ((1 - p.y) * r.height) / 2,
      ];
    }, world);
  }
  async function faceDrag(mesh, face, pixels) {
    const world = mesh.faces[face].reduce(
        (a, id) =>
          a.map(
            (v, i) => v + mesh.vertices[id - 1][i] / mesh.faces[face].length,
          ),
        [0, 0, 0],
      ),
      start = await point(world);
    await page.mouse.move(...start);
    await page.mouse.down();
    const n = await page
      .locator("svg[data-normal]")
      .evaluate((e) => e.dataset.normal.split(",").map(Number));
    await page.mouse.move(start[0] + n[0] * pixels, start[1] + n[1] * pixels, {
      steps: 12,
    });
    await page.mouse.up();
    return dump();
  }
  await button("Reset to cube").click();
  const original = await dump();
  const raised = await faceDrag(original, 5, 65),
    branched = await faceDrag(raised, 7, 50);
  assert.equal(branched.faces.length, 14);
  const blocked = await faceDrag(branched, 5, -45);
  assert.equal(blocked.text, branched.text);
  assert.match(
    await page.locator(".graphics-workbench__status").textContent(),
    /attached/,
  );
  assert.equal(await canvas.getAttribute("data-undo-count"), "2");
  for (const [mode, world] of [
    ["edge", [1, 1, 0]],
    ["vertex", [1, 1, 1]],
  ]) {
    await button("Reset to cube").click();
    await selection.selectOption(mode);
    let start = await point(world);
    await page.mouse.click(...start);
    assert.equal((await dump()).text, original.text);
    start = await point(world);
    await page.mouse.move(...start);
    await page.mouse.down();
    await page.mouse.move(start[0] + 45, start[1], { steps: 12 });
    await page.mouse.up();
    const beveled = await dump();
    assert.equal(beveled.faces.length, 7);
    assert.equal(beveled.vertices.length, 10);
    assert.equal(await canvas.getAttribute("data-undo-count"), "1");
    assert.notEqual(beveled.text, original.text);
    await button("Undo edit").click();
    assert.equal((await dump()).text, original.text);
    start = await point(world);
    await page.mouse.move(...start);
    await page.mouse.down();
    await page.mouse.move(start[0] + 50, start[1], { steps: 8 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal((await dump()).text, original.text);
    start = await point(world);
    await page.mouse.move(...start);
    await page.mouse.down();
    await page.mouse.move(start[0] - 50, start[1], { steps: 8 });
    await page.mouse.up();
    assert.equal((await dump()).text, original.text);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await button("Reset to cube").click();
  await selection.selectOption("vertex");
  const start = await point([1, 1, 1]);
  await page.mouse.click(...start);
  const depth = page.getByRole("slider", {
    name: "Keyboard bevel depth",
    exact: true,
  });
  await depth.fill("0.15");
  await depth.dispatchEvent("input");
  await depth.press("Enter");
  assert.equal((await dump()).faces.length, 7);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= 390),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: parent branch blocks, actual edge/vertex clicks and inward drags, unchanged source, exact undo, Escape, outward rejection, and mobile keyboard bevel.",
  );
} finally {
  await browser.close();
  await server.close();
}
