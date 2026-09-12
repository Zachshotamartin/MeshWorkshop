import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  makeDragAxis,
  dragDistance,
  previewExtrusion,
  previewBevel,
  inwardLimit,
  bevelWidth,
} from "../src/drag.js";
import { cube, topology } from "../src/mesh.js";

function setup(position, point, normal) {
  const camera = new THREE.PerspectiveCamera(38, 1.6, 0.01, 100);
  camera.position.set(...position);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const vp = camera.projectionMatrix
    .clone()
    .multiply(camera.matrixWorldInverse);
  const p = new THREE.Vector4(...point, 1).applyMatrix4(vp);
  const n = new THREE.Vector4(...normal, 0).applyMatrix4(vp);
  const screen = (v) => [(v.x / v.w + 1) * 800, (1 - v.y / v.w) * 500];
  const distance = new THREE.Vector3(...point).applyMatrix4(
    camera.matrixWorldInverse,
  ).z;
  return {
    axis: makeDragAxis({
      clipOrigin: p.toArray(),
      clipNormal: n.toArray(),
      width: 1600,
      height: 1000,
      fallbackUnitsPerPixel:
        (-2 * distance * Math.tan(THREE.MathUtils.degToRad(19))) / 1000,
    }),
    start: screen(p),
    project: (d) => screen(p.clone().addScaledVector(n, d)),
  };
}

test("dragging in perspective recovers normal distance for top and side faces at different camera scales", () => {
  for (const position of [
    [6, 4, 7],
    [3, 2, 3.5],
    [-7, 5, 3],
  ])
    for (const [point, normal] of [
      [
        [0, 1, 0],
        [0, 1, 0],
      ],
      [
        [1, 0, 0],
        [1, 0, 0],
      ],
      [
        [0, 0, 1],
        [0, 0, 1],
      ],
    ]) {
      const { axis, start, project } = setup(position, point, normal);
      assert.equal(axis.fallback, false);
      for (const d of [0.05, 0.4, 1.2])
        assert.ok(Math.abs(dragDistance(axis, start, project(d)) - d) < 1e-8);
    }
});
test("an end-on face has a predictable upward depth gesture instead of unstable division", () => {
  const { axis, start } = setup([0, 0, 8], [0, 0, 1], [0, 0, 1]);
  assert.equal(axis.fallback, true);
  assert.deepEqual(axis.direction, [0, -1]);
  assert.ok(dragDistance(axis, start, [start[0], start[1] - 100]) > 0);
  assert.equal(dragDistance(axis, start, [start[0], start[1] + 100]), 0);
});
test("inward and perpendicular drags cannot build inverted or zero-area side walls; distance and snapping are bounded", () => {
  const axis = { direction: [1, 0], pixelsPerUnit: 100, perspective: 0 };
  assert.equal(dragDistance(axis, [0, 0], [-30, 0]), 0);
  assert.equal(dragDistance(axis, [0, 0], [0, 80]), 0);
  assert.equal(dragDistance(axis, [0, 0], [10000, 0]), 3);
  assert.equal(dragDistance(axis, [0, 0], [54, 0], { snap: true }), 0.5);
  assert.deepEqual(previewExtrusion(cube(), 5, 0.001), cube());
  assert.throws(() => previewExtrusion(cube(), 5, -3), /supporting/);
});
test("preview updates use one source topology and rollback leaves the source unchanged", () => {
  const original = cube(),
    expected = structuredClone(original);
  for (const d of [0.2, 0.8, 0.4, 1.2]) {
    const preview = previewExtrusion(original, 5, d),
      stats = topology(preview);
    assert.equal(stats.faces, 10);
    assert.equal(stats.vertices, 12);
    assert.equal(stats.boundary, 0);
    assert.equal(stats.nonManifold, 0);
    assert.ok(
      preview.faces[5].every(
        (i) => Math.abs(preview.vertices[i][1] - (1 + d)) < 1e-9,
      ),
    );
  }
  assert.deepEqual(original, expected);
  assert.deepEqual(previewExtrusion(original, 5, 0), expected);
});

test("pushing an existing extrusion shortens its cap without adding vertices or side walls", () => {
  const raised = previewExtrusion(cube(), 5, 1.2),
    shorter = previewExtrusion(raised, 5, -0.8);
  assert.equal(shorter.faces.length, raised.faces.length);
  assert.equal(shorter.vertices.length, raised.vertices.length);
  assert.deepEqual(shorter.faces, raised.faces);
  assert.deepEqual(shorter.vertices.slice(0, 8), raised.vertices.slice(0, 8));
  assert.ok(
    shorter.faces[5].every(
      (id) => Math.abs(shorter.vertices[id][1] - 1.4) < 1e-9,
    ),
  );
  assert.ok(inwardLimit(raised, 5) > -1.2);
  const limit = previewExtrusion(raised, 5, inwardLimit(raised, 5));
  assert.ok(limit.faces[5].every((id) => limit.vertices[id][1] > 1));
  assert.equal(topology(shorter).boundary, 0);
  assert.equal(topology(shorter).nonManifold, 0);
});
test("signed depth and perpendicular cap width are independent and bounded", () => {
  const axis = { direction: [0, -1], pixelsPerUnit: 100, perspective: 0 };
  assert.equal(dragDistance(axis, [0, 0], [80, 50], { minDistance: -1 }), -0.5);
  assert.equal(dragDistance(axis, [0, 0], [0, 500], { minDistance: -1 }), -1);
  const narrow = bevelWidth(axis, [0, 0], [80, -50], 0.22, 500),
    wide = bevelWidth(axis, [0, 0], [-40, -50], 0.22, 500);
  assert.ok(narrow.fraction > 0.22);
  assert.ok(wide.fraction < 0.22);
  assert.equal(bevelWidth(axis, [0, 0], [0, -50], 0.22, 500).fraction, 0.22);
  assert.equal(bevelWidth(axis, [0, 0], [10000, 0], 0.22, 500).fraction, 0.78);
});

test("reversing a bevel preserves every earlier extrusion and its undo baseline", () => {
  const raised = previewExtrusion(previewExtrusion(cube(), 5, 1), 5, .5);
  const original = structuredClone(raised);
  for (const distance of [1, .4, 0, -.5, -3]) {
    const next = previewBevel(raised, 5, distance, .22);
    assert.deepEqual(next.vertices.slice(0, raised.vertices.length), raised.vertices);
    if (distance <= 0) assert.deepEqual(next, raised);
    assert.equal(topology(next).boundary, 0);
    assert.equal(topology(next).nonManifold, 0);
  }
  const flat = previewBevel(raised, 5, -.5, .3, true);
  assert.deepEqual(flat.vertices.slice(0, raised.vertices.length), raised.vertices);
  assert.ok(flat.faces[5].every(id => Math.abs(flat.vertices[id][1] - 2.5) < 1e-9));
  assert.deepEqual(raised, original);
});
