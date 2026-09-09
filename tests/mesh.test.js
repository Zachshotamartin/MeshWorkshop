import test from "node:test";
import assert from "node:assert/strict";
import {
  faceNormal,
  cube,
  extrude,
  inset,
  subdivide,
  topology,
  toOBJ,
  preset,
} from "../src/mesh.js";
test("extrusion creates a connected watertight cap and side faces", () => {
  const input = cube(),
    m = extrude(input, 5, 0.75);
  assert.equal(m.vertices.length, 12);
  assert.equal(m.faces.length, 10);
  assert.equal(topology(m).euler, 2);
  assert.equal(topology(m).boundary, 0);
  assert.equal(topology(m).nonManifold, 0);
  for (const i of m.faces[5]) assert.equal(m.vertices[i][1], 1.75);
  assert.equal(input.vertices.length, 8);
});
test("inset adds a coplanar face ring without holes", () => {
  const m = inset(cube(), 5, 0.25);
  assert.deepEqual(topology(m), {
    vertices: 12,
    faces: 10,
    edges: 20,
    boundary: 0,
    nonManifold: 0,
    euler: 2,
  });
  for (const i of m.faces[5]) assert.equal(m.vertices[i][1], 1);
  assert.equal(Math.max(...m.faces[5].map((i) => m.vertices[i][0])), 0.75);
});
test("Catmull–Clark cube subdivision yields 26 vertices,24 quads and expected corner limit step", () => {
  const m = subdivide(cube());
  assert.equal(m.vertices.length, 26);
  assert.equal(m.faces.length, 24);
  assert.ok(m.faces.every((f) => f.length === 4));
  assert.ok(Math.abs(m.vertices[0][0] + 5 / 9) < 1e-10);
  assert.equal(topology(m).euler, 2);
  assert.equal(topology(m).boundary, 0);
});
test("presets contain actual edited topology and export one-indexed OBJ", () => {
  for (const name of ["Terraced tower", "Studio wing", "Rounded vessel"]) {
    const m = preset(name);
    assert.ok(m.faces.length > 6);
    assert.equal(topology(m).nonManifold, 0);
    assert.equal(topology(m).boundary, 0);
    const obj = toOBJ(m);
    assert.equal(
      obj.split("\n").filter((s) => s.startsWith("v ")).length,
      m.vertices.length,
    );
    assert.ok(!obj.includes("NaN"));
  }
});
test("invalid selection and unbounded edits reject without mutating", () => {
  const m = cube();
  assert.throws(() => extrude(m, -1, 0.5));
  assert.throws(() => extrude(m, 1, NaN));
  assert.throws(() => inset(m, 1, 1));
  assert.equal(m.faces.length, 6);
});
test("face bevel creates sloped connected shoulders and a smaller raised cap", async () => {
  const { bevelFace } = await import("../src/mesh.js");
  const m = bevelFace(cube(), 5, 0.25, 0.4);
  const t = topology(m);
  assert.equal(t.faces, 10);
  assert.equal(t.euler, 2);
  assert.equal(t.boundary, 0);
  assert.equal(t.nonManifold, 0);
  assert.ok(m.faces[5].every((v) => Math.abs(m.vertices[v][1] - 1.4) < 1e-9));
  const n = faceNormal(m, m.faces[6]);
  assert.ok(Math.abs(n[1]) > 0.1 && Math.abs(n[1]) < 0.99);
});
test("diagonal face split shares original vertices without a T junction", async () => {
  const { splitFace } = await import("../src/mesh.js");
  const m = splitFace(cube(), 5),
    t = topology(m);
  assert.equal(t.vertices, 8);
  assert.equal(t.faces, 7);
  assert.equal(t.edges, 13);
  assert.equal(t.euler, 2);
  assert.equal(t.boundary, 0);
  assert.equal(t.nonManifold, 0);
  assert.equal(m.faces[5].length, 3);
  assert.throws(() => splitFace(m, 5), /already a triangle/);
});
