import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
const server = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  cacheDir: ".vite/push-pull",
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
    button = (name) => page.getByRole("button", { name, exact: true });
  const dump = async () => {
    const pending = page.waitForEvent("download");
    await button("Export OBJ").click();
    const file = await pending;
    const text = await readFile(await file.path(), "utf8");
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
  const center = (mesh) =>
    mesh.faces[5].reduce(
      (a, id) =>
        a.map((v, i) => v + mesh.vertices[id - 1][i] / mesh.faces[5].length),
      [0, 0, 0],
    );
  async function drag(mesh, depth, side = 0, reverseDepth = null) {
    await canvas.scrollIntoViewIfNeeded();
    const start = await page.evaluate((world) => {
      const { THREE: T, camera, canvas } = window.fixture.ctx;
      camera.updateMatrixWorld();
      const p = new T.Vector3(...world).project(camera),
        r = canvas.getBoundingClientRect();
      return [
        r.x + ((p.x + 1) * r.width) / 2,
        r.y + ((1 - p.y) * r.height) / 2,
      ];
    }, center(mesh));
    await page.mouse.move(...start);
    await page.mouse.down();
    const n = await page
      .locator("svg[data-normal]")
      .evaluate((e) => e.dataset.normal.split(",").map(Number));
    let t = [-n[1], n[0]];
    if (t[0] < -1e-8 || (Math.abs(t[0]) < 1e-8 && t[1] > 0))
      t = t.map((v) => -v);
    await page.mouse.move(start[0] + n[0] * depth, start[1] + n[1] * depth, {
      steps: 12,
    });
    if (side)
      await page.mouse.move(
        start[0] + n[0] * depth + t[0] * side,
        start[1] + n[1] * depth + t[1] * side,
        { steps: 12 },
      );
    if (reverseDepth !== null)
      await page.mouse.move(start[0] + n[0] * reverseDepth, start[1] + n[1] * reverseDepth, { steps: 16 });
    await page.mouse.up();
    return dump();
  }
  await button("Reset to cube").click();
  const original = await dump();
  const raised = await drag(original, 70);
  assert.equal(raised.faces.length, 10);
  const shortened = await drag(raised, -40);
  assert.deepEqual(shortened.faces, raised.faces);
  assert.equal(shortened.vertices.length, 12);
  assert.ok(center(shortened)[1] < center(raised)[1] - 0.1);
  assert.ok(center(shortened)[1] > 1);
  assert.deepEqual(shortened.vertices.slice(0, 8), raised.vertices.slice(0, 8));
  await button("Undo edit").click();
  assert.equal((await dump()).text, raised.text);
  await page.getByLabel("Drag operation").selectOption("bevel");
  const reversedBevel = await drag(raised, 65, 0, -100);
  assert.equal(reversedBevel.text, raised.text, "Reversing a bevel must preserve the earlier extrusion");
  await page.getByLabel("Keyboard pull distance", { exact: true }).fill("-0.6");
  await canvas.press("Enter");
  assert.equal((await dump()).text, raised.text, "A negative keyboard bevel must preserve the earlier extrusion");
  await button("Undo edit").click();
  assert.equal((await dump()).text, original.text, "A canceled bevel must not add an undo step");
  async function bevel(side) {
    await button("Reset to cube").click();
    await page.getByLabel("Drag operation").selectOption("bevel");
    return drag(original, 65, side);
  }
  const straight = await bevel(0),
    narrow = await bevel(90),
    wide = await bevel(-45);
  const span = (m) => {
    const values = m.faces[5].map((id) => m.vertices[id - 1][0]);
    return Math.max(...values) - Math.min(...values);
  };
  assert.ok(span(narrow) < span(straight) - 0.2);
  assert.ok(span(wide) > span(straight) + 0.1);
  assert.ok(Math.abs(center(narrow)[1] - center(straight)[1]) < 1e-6);
  assert.ok(Math.abs(center(wide)[1] - center(straight)[1]) < 1e-6);
  assert.equal(narrow.faces.length, 10);
  assert.equal(wide.faces.length, 10);
  await button("Undo edit").click();
  assert.equal((await dump()).text, original.text);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      raisedHeight: center(raised)[1],
      shortenedHeight: center(shortened)[1],
      facesRetained: shortened.faces.length,
      bevelWidths: {
        straight: span(straight),
        narrow: span(narrow),
        wide: span(wide),
      },
      heightUnchanged: true,
      undo: "exact",
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
