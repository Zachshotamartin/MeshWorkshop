import test from "node:test";
import assert from "node:assert/strict";
import { cube, inset, extrude, topology, editFaceIndex } from "../src/mesh.js";
import { extrusionJoinInfo } from "../src/extrusionJoins.js";
import { assertSafeEdit } from "../src/intersections.js";
import { signedVolume } from "./fixtures/connected-channel.js";

function branch(face = 3) {
  return extrude(inset(cube(), face, 0.6), face, 0.5);
}

function closed(mesh) {
  const stats = topology(mesh);
  assert.equal(stats.boundary, 0);
  assert.equal(stats.nonManifold, 0);
  assert.equal(stats.euler, 2);
}

function area(mesh, face) {
  const points = face.map((id) => mesh.vertices[id]),
    sum = [0, 0, 0];
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i].map((v, k) => v - points[0][k]),
      b = points[i + 1].map((v, k) => v - points[0][k]);
    sum[0] += a[1] * b[2] - a[2] * b[1];
    sum[1] += a[2] * b[0] - a[0] * b[2];
    sum[2] += a[0] * b[1] - a[1] * b[0];
  }
  return Math.hypot(...sum) / 2;
}

test("a narrow wall join preserves neighboring outlines in every cube orientation", () => {
  for (let parent = 0; parent < 6; parent++) {
    const source = branch(parent),
      original = structuredClone(source),
      result = assertSafeEdit(source, extrude(source, 11, 0.3), 11),
      info = extrusionJoinInfo(result);
    closed(result);
    assert.equal(editFaceIndex(result, 11), 11);
    assert.equal(
      topology(result).vertices,
      20,
      "Only the four new cap corners are needed; no distant construction cuts.",
    );
    for (let origin = 0; origin < source.faces.length; origin++) {
      if (origin === 7 || origin === 11) continue;
      const index = info.origins.indexOf(origin);
      assert.ok(
        info.unchanged.has(origin),
        `Original face ${origin} retains its boundary.`,
      );
      assert.deepEqual(result.faces[index], source.faces[origin]);
    }
    const wall = result.faces.filter((_, index) => info.origins[index] === 7);
    assert.equal(wall.length, 3, "The wall notch needs three convex pieces.");
    assert.ok(
      Math.abs(
        wall.reduce((sum, face) => sum + area(result, face), 0) -
          area(source, source.faces[7]) +
          0.24,
      ) < 1e-10,
    );
    assert.ok(
      Math.abs(signedVolume(result) - signedVolume(source) - 0.12) < 1e-10,
    );
    assert.deepEqual(source, original);
  }
});

test("successive narrow joins retain untouched roof and side outlines", () => {
  const initial = branch(),
    roof = initial.faces[5],
    side = initial.faces[6];
  let source = initial,
    face = 11;
  for (const depth of [0.3, 0.1, 0.1]) {
    const result = assertSafeEdit(source, extrude(source, face, depth), face),
      info = extrusionJoinInfo(result);
    closed(result);
    assert.deepEqual(result.faces[info.origins.indexOf(5)], roof);
    assert.deepEqual(result.faces[info.origins.indexOf(6)], side);
    assert.ok(
      Math.abs(signedVolume(result) - signedVolume(source) - 0.4 * depth) <
        1e-10,
    );
    source = result;
    face = editFaceIndex(result, face);
  }
});

test("removing distant construction cuts does not let a joined cap enter a head-on obstacle", () => {
  const source = branch(),
    obstacle = cube(),
    offset = source.vertices.length;
  source.vertices.push(
    ...obstacle.vertices.map(([x, y, z]) => [
      1.25 + x * 0.1,
      0.85 + y * 0.1,
      z * 0.1,
    ]),
  );
  source.faces.push(
    ...obstacle.faces.map((face) => face.map((id) => id + offset)),
  );
  for (const depth of [0.35, 0.45, 1.1])
    assert.throws(
      () => assertSafeEdit(source, extrude(source, 11, depth), 11),
      /surface|intersect|geometry/,
    );
});
