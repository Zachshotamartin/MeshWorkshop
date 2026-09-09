import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { topology } from "../src/mesh.js";
import { connectedChannel, signedVolume } from "./fixtures/connected-channel.js";

const server = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  cacheDir: ".vite/connected-extrusion",
  plugins: [{
    name: "connected-extrusion-fixture",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/src/index.js")) return;
      assert.equal(code.split("let mesh = cube()").length, 2);
      return code.replace("let mesh = cube()", "let mesh = window.channelSource");
    },
  }],
});
await server.listen();
const browser = await chromium.launch({ channel: "chromium" });
function parseOBJ(text) {
  const lines = text.split("\n");
  return {
    vertices: lines.filter(l => l.startsWith("v ")).map(l => l.split(" ").slice(1).map(Number)),
    faces: lines.filter(l => l.startsWith("f ")).map(l => l.split(" ").slice(1).map(id => Number(id) - 1)),
  };
}
try {
  const errors = [], results = [];
  for (const [name, options, scenario] of [
    ["one touching wall", { left: false }],
    ["middle of two raised blocks", {}],
    ["twenty wall sections", { wallSegments: 20 }],
  ].flatMap(([name, options]) => ["roof heights", "successive joins"].map(scenario => [name, options, scenario]))) {
    const { mesh: source, face, capArea } = connectedChannel(options);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(mesh => { window.channelSource = mesh; }, source);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/lifecycle.html`);
    await page.waitForFunction(() => window.fixture);
    const canvas = page.locator(".graphics-workbench__viewport canvas");
    const center = [0, 1, 2].map(k => source.faces[face].reduce((sum, id) => sum + source.vertices[id][k], 0) / 4);
    await page.evaluate(center => {
      const { camera, controls } = window.fixture.ctx;
      controls.target.set(...center);
      camera.position.set(center[0], center[1] + 5, center[2] + 7);
      camera.lookAt(...center);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      controls.update();
      window.fixture.ctx.invalidate();
    }, center);
    await canvas.scrollIntoViewIfNeeded();
    async function downloadMesh() {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export OBJ", exact: true }).click();
      return readFile(await (await download).path(), "utf8");
    }
    const original = await downloadMesh();
    async function drag(depth, cancel = false, baseLift = 0) {
      const points = await page.evaluate(({ center, depth, baseLift }) => {
        const { THREE, camera, canvas } = window.fixture.ctx, rect = canvas.getBoundingClientRect();
        return [0, depth].map(d => {
          const p = new THREE.Vector3(center[0], center[1] + baseLift + d, center[2]).project(camera);
          return [rect.x + (p.x + 1) * rect.width / 2, rect.y + (1 - p.y) * rect.height / 2];
        });
      }, { center, depth, baseLift });
      await page.mouse.move(...points[0]);
      await page.mouse.down();
      assert.equal(await canvas.getAttribute("data-selected-face"), String(face));
      await page.mouse.move(...points[1], { steps: 12 });
      assert.doesNotMatch(await page.locator(".mesh-drag-feedback").textContent(), /blocked/i,
        `${name}, depth ${depth}: ${await page.locator(".graphics-workbench__note").allTextContents()}`);
      if (cancel) await page.keyboard.press("Escape");
      await page.mouse.up();
    }
    if (scenario === "roof heights") {
      // Below both neighbors, level with each roof, and above both roofs.
      for (const depth of [0.3, 0.5, 0.85, 1.1]) {
        await drag(depth);
        const mesh = parseOBJ(await downloadMesh()), stats = topology(mesh);
        assert.equal(stats.boundary, 0, `${name}: no open seams at ${depth}`);
        assert.equal(stats.nonManifold, 0, `${name}: no duplicate walls at ${depth}`);
        assert.equal(stats.euler, 2, `${name}: one closed solid at ${depth}`);
        assert.ok(Math.abs(signedVolume(mesh) - signedVolume(source) - capArea * depth) < 0.00001, `${name}: correct added volume at ${depth}`);
        assert.equal(await canvas.getAttribute("data-undo-count"), "1");
        await page.getByRole("button", { name: "Undo edit", exact: true }).click();
        assert.equal(await downloadMesh(), original, `${name}: exact undo`);
      }
      await drag(0.3, true);
      assert.equal(await downloadMesh(), original, `${name}: Escape restores source`);
    } else {
      await drag(0.3);
      const firstJoin = await downloadMesh();
      await drag(0.2, false, 0.3);
      const twice = parseOBJ(await downloadMesh());
      assert.equal(topology(twice).boundary, 0);
      assert.equal(topology(twice).nonManifold, 0);
      assert.ok(Math.abs(signedVolume(twice) - signedVolume(source) - capArea * 0.5) < 0.00001);
      assert.equal(await canvas.getAttribute("data-undo-count"), "2");
      await page.getByRole("button", { name: "Undo edit", exact: true }).click();
      assert.equal(await downloadMesh(), firstJoin, `${name}: undo second joined extrusion`);
      await page.getByRole("button", { name: "Undo edit", exact: true }).click();
      assert.equal(await downloadMesh(), original, `${name}: undo first joined extrusion`);
    }
    results.push({ name, scenario, watertight: true, exactUndo: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors }));
} finally {
  await browser.close();
  await server.close();
}
