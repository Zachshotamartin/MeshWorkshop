import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { faceNormal } from "../src/mesh.js";
import { parallelBlock, overheadBlock } from "./fixtures/collision-meshes.js";

const server = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  cacheDir: ".vite/collisions",
  plugins: [{
    name: "collision-fixture-source",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/src/index.js")) return;
      // Seed the real experiment in this test server only; pointer handling,
      // collision checks, rendering, history and OBJ export stay unmodified.
      assert.equal(code.split("let mesh = cube()").length, 2);
      return code.replace("let mesh = cube()", "let mesh = window.collisionSource");
    },
  }],
});
await server.listen();
const browser = await chromium.launch({ channel: "chromium" });
try {
  const errors = [], results = [];
  for (const [name, source, zoom, distances, expected] of [
    ["parallel clearance", parallelBlock(0.00002), 150, [0.0021, 0.004], 0.004],
    ["true blocker", overheadBlock(), 1, [1.6], 0.4],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((mesh) => { window.collisionSource = mesh; }, source);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/lifecycle.html`);
    await page.waitForFunction(() => window.fixture);
    const canvas = page.locator(".graphics-workbench__viewport canvas"),
      normal = faceNormal(source, source.faces[5]),
      center = [0, 1, 2].map((k) => source.faces[5].reduce(
        (sum, id) => sum + source.vertices[id][k], 0,
      ) / source.faces[5].length);
    await page.evaluate(({ center, normal, zoom }) => {
      const { camera, controls } = window.fixture.ctx;
      controls.target.set(...center);
      camera.position.set(...center.map((v, k) => v + normal[k] * 5 + (k === 2 ? 7 : 0)));
      camera.zoom = zoom;
      camera.lookAt(...center);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      controls.update();
      window.fixture.ctx.invalidate();
    }, { center, normal, zoom });
    await canvas.scrollIntoViewIfNeeded();
    const points = await page.evaluate(({ center, normal, distances }) => {
      const { THREE, camera, canvas } = window.fixture.ctx,
        rect = canvas.getBoundingClientRect();
      return [0, ...distances].map((distance) => {
        const p = new THREE.Vector3(...center.map((v, k) => v + normal[k] * distance)).project(camera);
        return [rect.x + (p.x + 1) * rect.width / 2, rect.y + (1 - p.y) * rect.height / 2];
      });
    }, { center, normal, distances });
    await page.mouse.move(...points[0]);
    await page.mouse.down();
    assert.equal(await canvas.getAttribute("data-selected-face"), "5");
    for (const point of points.slice(1)) {
      await page.mouse.move(...point);
      assert.equal(await canvas.getAttribute("data-face-count"), "16");
      if (name === "parallel clearance") {
        assert.doesNotMatch(await page.locator(".mesh-drag-feedback").textContent(), /blocked/i);
      }
    }
    await page.mouse.up();
    assert.equal(await canvas.getAttribute("data-undo-count"), "1");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export OBJ", exact: true }).click();
    const file = await download,
      obj = await readFile(await file.path(), "utf8"),
      vertices = obj.split("\n").filter((line) => line.startsWith("v "))
        .map((line) => line.split(" ").slice(1).map(Number)),
      cap = obj.split("\n").filter((line) => line.startsWith("f "))[5]
        .split(" ").slice(1).map((id) => vertices[Number(id) - 1]),
      depth = cap.reduce((sum, p) => sum + p.reduce(
        (d, v, k) => d + (v - center[k]) * normal[k], 0,
      ), 0) / cap.length;
    if (name === "parallel clearance") assert.ok(Math.abs(depth - expected) < 0.000002);
    else assert.ok(depth > 0.399 && depth < expected);
    results.push({ name, depth, committed: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors }));
} finally {
  await browser.close();
  await server.close();
}
