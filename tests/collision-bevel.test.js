import test from "node:test";
import assert from "node:assert/strict";
import {
  cube,
  extrude,
  bevelFace,
  cloneMesh,
  topology,
  toOBJ,
  faceNormal,
} from "../src/mesh.js";
import { inwardLimit, previewExtrusion } from "../src/drag.js";
import { assertSafeEdit, constrainEdit } from "../src/intersections.js";
import { bevelFeature, meshEdges, featurePlane } from "../src/featureBevel.js";
const volume = (m) =>
  m.faces.reduce((sum, f) => {
    const a = m.vertices[f[0]];
    for (let j = 1; j < f.length - 1; j++) {
      const b = m.vertices[f[j]],
        c = m.vertices[f[j + 1]];
      sum +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) +
          a[1] * (b[2] * c[0] - b[0] * c[2]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6;
    }
    return sum;
  }, 0);
function obstacle(size = 0.3, y = 1.7, x = 0) {
  const a = cube(),
    b = cube(),
    offset = a.vertices.length;
  return {
    vertices: [
      ...a.vertices,
      ...b.vertices.map((p) =>
        p.map((v, k) => v * size + (k === 1 ? y : k === 0 ? x : 0)),
      ),
    ],
    faces: [...a.faces, ...b.faces.map((f) => f.map((id) => id + offset))],
  };
}
test("shortening a parent extrusion with a side branch is blocked on every cube face", () => {
  for (let face = 0; face < 6; face++) {
    const raised = extrude(cube(), face, 0.8);
    for (let side = 6; side < 10; side++) {
      const branched = extrude(raised, side, 0.45),
        original = toOBJ(branched);
      assert.equal(inwardLimit(branched, face), 0);
      assert.throws(() => previewExtrusion(branched, face, -0.2));
      assert.equal(toOBJ(branched), original);
      assert.ok(inwardLimit(branched, side) < 0);
      assertSafeEdit(branched, previewExtrusion(branched, side, -0.15), side);
    }
  }
});
test("valid cube extrusion, inward movement, and face bevel retain nonintersecting faces", () => {
  for (let face = 0; face < 6; face++) {
    const source = cube();
    for (const next of [
      extrude(source, face, 0.5),
      previewExtrusion(source, face, -0.5),
      bevelFace(source, face, 0.3, 0.5),
      bevelFace(source, face, 0.3, 0),
    ])
      assertSafeEdit(source, next, face);
  }
});
test("extrusion and bevel cannot cross or enclose another solid, even in a single large drag", () => {
  for (const source of [obstacle(), obstacle(0.05, 1.4)]) {
    assertSafeEdit(source, extrude(source, 5, 0.1), 5);
    for (const next of [
      extrude(source, 5, 1.6),
      bevelFace(source, 5, 0.2, 1.6),
    ])
      assert.throws(
        () => assertSafeEdit(source, next, 5),
        /surface|intersect|geometry/,
      );
    const limited = constrainEdit(
      ([d]) =>
        d < 0.002
          ? cloneMesh(source)
          : assertSafeEdit(source, extrude(source, 5, d), 5),
      [0],
      [1.6],
    );
    assert.ok(limited.blocked);
    assert.ok(limited.values[0] > 0.1 && limited.values[0] < 0.41);
    assertSafeEdit(source, limited.mesh, 5);
  }
});
test("all 12 edge and 8 vertex bevels cut inward with closed topology and exact source preservation", () => {
  const source = cube(),
    text = toOBJ(source);
  for (const [kind, items] of [
    ["edge", meshEdges(source).map((e) => e.ids)],
    ["vertex", source.vertices.map((_, i) => i)],
  ])
    for (const id of items) {
      const next = bevelFeature(source, kind, id, 0.2),
        stats = topology(next);
      assert.equal(stats.boundary, 0);
      assert.equal(stats.nonManifold, 0);
      assert.equal(stats.euler, 2);
      assert.equal(stats.faces, 7);
      assert.ok(volume(next) < 8 && volume(next) > 7);
      assert.ok(
        next.vertices.every((p) => p.every((v) => Math.abs(v) <= 1 + 1e-7)),
      );
      assert.equal(toOBJ(source), text);
      assert.throws(() => bevelFeature(source, kind, id, -0.1));
      assert.throws(() =>
        bevelFeature(
          source,
          kind,
          id,
          featurePlane(source, kind, id).maxDepth + 0.1,
        ),
      );
    }
});
test("feature bevels support repeated cuts and preserve the supporting face planes", () => {
  let m = bevelFeature(cube(), "edge", [2, 6], 0.2);
  m = bevelFeature(m, "vertex", 0, 0.12);
  assert.equal(topology(m).boundary, 0);
  assert.equal(topology(m).euler, 2);
  for (const f of m.faces) {
    const n = faceNormal(m, f),
      a = m.vertices[f[0]];
    for (const id of f)
      assert.ok(
        Math.abs(m.vertices[id].reduce((s, v, k) => s + (v - a[k]) * n[k], 0)) <
          1e-6,
      );
  }
});
test("nonplanar connected polygons and folded faces reject before committing", () => {
  const source = cube(),
    bad = cloneMesh(source);
  bad.vertices[6][1] -= 0.5;
  assert.throws(() => assertSafeEdit(source, bad, 5), /twist|fold/);
});
