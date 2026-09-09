import test from "node:test";
import assert from "node:assert/strict";
import { cube, extrude, cloneMesh } from "../src/mesh.js";
import { inwardLimit, previewExtrusion } from "../src/drag.js";
import {
  assertSafeEdit,
  constrainEdit,
  trianglesConflict,
} from "../src/intersections.js";
import { parallelBlock, overheadBlock } from "./fixtures/collision-meshes.js";

function triangle(ids, points) {
  return {
    ids,
    points,
    box: {
      min: [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k]))),
      max: [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k]))),
    },
  };
}

test("short coplanar edges do not inflate the clearance around a shared vertex", () => {
  const a = triangle([0, 1, 2], [[0, 0, 0], [0.002, 0, 0], [0, -1, 0]]),
    b = triangle([0, 3, 4], [[0, 0, 0], [0.002, 0.00002, 0], [0, 1, 0]]);
  // The triangles lie on opposite sides of y=0 and meet only at vertex 0.
  // Their other short-edge endpoints are 200 distance epsilons apart.
  assert.equal(trianglesConflict(a, b), false);
  assert.equal(trianglesConflict(b, a), false);
});

test("an extrusion clears a nearby parallel block even when their AABBs overlap", () => {
  const source = parallelBlock(0.00002),
    original = cloneMesh(source),
    make = ([distance]) => assertSafeEdit(
      source,
      previewExtrusion(source, 5, distance),
      5,
    );
  for (const distance of [0.002, 0.01, 0.5]) make([distance]);
  const limited = constrainEdit(make, [0], [0.002]);
  assert.equal(limited.blocked, null);
  assert.deepEqual(limited.values, [0.002]);
  assert.deepEqual(source, original);
});

test("parallel block contact and penetration still stop an extrusion", () => {
  for (const gap of [0, -0.00002, -0.1]) {
    const source = parallelBlock(gap);
    assert.throws(
      () => assertSafeEdit(source, extrude(source, 5, 0.002), 5),
      /surface|intersect|geometry/,
    );
  }
});

test("a large pull stops before a blocker and leaves adjacent edits usable", () => {
  const source = overheadBlock();
  const limited = constrainEdit(
    ([distance]) => assertSafeEdit(
      source,
      previewExtrusion(source, 5, distance),
      5,
    ),
    [0],
    [1.6],
  );
  assert.ok(limited.blocked);
  assert.ok(limited.values[0] > 0.399 && limited.values[0] < 0.4);
  const capHeight = limited.mesh.vertices[limited.mesh.faces[5][0]][1];
  assert.ok(capHeight < 1.4);
  assertSafeEdit(source, limited.mesh, 5);
  // A committed cap close to the obstacle must not prevent the left wall
  // from extending away from it, or a subsequent push away from the blocker.
  const leftWall = source.faces.length;
  assertSafeEdit(limited.mesh, extrude(limited.mesh, leftWall, 0.2), leftWall);
  assertSafeEdit(limited.mesh, previewExtrusion(limited.mesh, 5, -0.2), 5);
});

test("connected towers can extend and shorten beside a separated parallel branch", () => {
  for (const gap of [0.03, 0.4, 1.3]) {
    let source = cube();
    for (const [face, depth] of [[3, gap], [3, 0.7], [5, 1.2], [11, 0.8]]) {
      const next = extrude(source, face, depth);
      assertSafeEdit(source, next, face);
      source = next;
    }
    // Face 15 faces +Z on the left tower; the right tower is separated on X.
    const extended = assertSafeEdit(source, extrude(source, 15, 0.6), 15);
    assert.ok(inwardLimit(extended, 15) < -0.5);
    assertSafeEdit(extended, previewExtrusion(extended, 15, -0.5), 15);
  }
});
