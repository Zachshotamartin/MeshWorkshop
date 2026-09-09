import test from "node:test";
import assert from "node:assert/strict";
import {
  cube,
  extrude,
  bevelFace,
  cloneMesh,
  faceNormal,
  topology,
} from "../src/mesh.js";
import { assertSafeEdit, constrainEdit } from "../src/intersections.js";
import { previewExtrusion, inwardLimit } from "../src/drag.js";
import {
  diagonalCorner,
  perpendicularCorner,
  lastCorner,
  signedVolume,
} from "./fixtures/connected-channel.js";

function combine(obstacle) {
  const source = cube(),
    offset = source.vertices.length;
  source.vertices.push(...obstacle.vertices);
  source.faces.push(
    ...obstacle.faces.map((face) => face.map((id) => id + offset)),
  );
  return source;
}

function outward(vertices, faces) {
  const mesh = { vertices, faces },
    center = [0, 1, 2].map(
      (k) => vertices.reduce((sum, p) => sum + p[k], 0) / vertices.length,
    );
  mesh.faces = faces.map((face) => {
    const n = faceNormal(mesh, face),
      p = vertices[face[0]];
    return n.reduce((sum, v, k) => sum + v * (p[k] - center[k]), 0) < 0
      ? [...face].reverse()
      : face;
  });
  return mesh;
}

function diagonalPrism(offset = 0) {
  const footprint = [
      [0.9 + offset, 1.1 + offset],
      [1.1 + offset, 0.9 + offset],
      [1.5 + offset, 1.5 + offset],
    ],
    vertices = [1.3, 2.1].flatMap((y) => footprint.map(([x, z]) => [x, y, z]));
  return outward(vertices, [
    [0, 1, 2],
    [3, 4, 5],
    [0, 1, 4, 3],
    [1, 2, 5, 4],
    [2, 0, 3, 5],
  ]);
}

function assertClosed(mesh, euler) {
  const stats = topology(mesh);
  assert.equal(stats.boundary, 0);
  assert.equal(stats.nonManifold, 0);
  assert.equal(stats.euler, euler);
  const windings = new Map();
  for (const face of mesh.faces)
    for (let i = 0; i < face.length; i++) {
      const a = face[i],
        b = face[(i + 1) % face.length],
        key = a < b ? `${a}/${b}` : `${b}/${a}`;
      windings.set(key, (windings.get(key) || 0) + (a < b ? 1 : -1));
    }
  assert.ok(
    [...windings.values()].every((sum) => sum === 0),
    "Every shared edge has opposite face windings.",
  );
}

function cornerVertices(mesh, height) {
  return [...new Set(mesh.faces.flat())].filter((id) =>
    mesh.vertices[id].every((v, k) => Math.abs(v - [1, height, 1][k]) < 1e-7),
  );
}

test("a cap can graze a connected diagonal column's vertical edge without welding its surface sheets", () => {
  const { mesh, face, capArea } = diagonalCorner(),
    original = structuredClone(mesh);
  for (const depth of [0.2, 0.8, 1.1]) {
    const result = assertSafeEdit(mesh, extrude(mesh, face, depth), face);
    assertClosed(result, 2);
    assert.ok(
      Math.abs(signedVolume(result) - signedVolume(mesh) - capArea * depth) <
        1e-10,
    );
    if (depth === 0.8) {
      const coincident = [...new Set(result.faces.flat())].filter((id) =>
        result.vertices[id].every(
          (v, k) => Math.abs(v - [1, 1.8, 1][k]) < 1e-7,
        ),
      );
      assert.equal(
        coincident.length,
        2,
        "Contacting edge endpoints remain separate topological vertices.",
      );
    }
  }
  assert.deepEqual(mesh, original);
  const limited = constrainEdit(
    ([depth]) =>
      assertSafeEdit(mesh, previewExtrusion(mesh, face, depth), face),
    [0],
    [1.1],
  );
  assert.equal(limited.blocked, null);
  assert.deepEqual(limited.values, [1.1]);
});

test("an oblique obstacle edge touching only the swept corner can be passed", () => {
  const source = combine(diagonalPrism());
  for (const depth of [0.3, 0.5, 1.6]) {
    const result = assertSafeEdit(source, extrude(source, 5, depth), 5);
    assertClosed(result, 4);
    assert.ok(
      Math.abs(signedVolume(result) - signedVolume(source) - 4 * depth) < 1e-10,
    );
  }
});

test("perpendicular wall fills join equal roof corners while preserving untouched diagonal sheets", () => {
  const depths = [0.3, 0.4, 0.5, 0.65, 0.8, 0.85, 0.95, 1.1];
  for (const initial of [0.5, 0.8]) {
    const source = diagonalCorner().mesh,
      raised = assertSafeEdit(source, extrude(source, 5, initial), 5),
      original = structuredClone(raised);
    for (const face of [7, 12])
      for (const depth of depths) {
        const result = assertSafeEdit(
            raised,
            extrude(raised, face, depth),
            face,
          ),
          beforeFourth = structuredClone(result);
        assertClosed(result, 2);
        assert.ok(
          Math.abs(signedVolume(result) - signedVolume(raised) - 4 * depth) <
            1e-10,
        );
        if (initial === 0.8)
          assert.equal(
            cornerVertices(result, 1.8).length,
            depth < 0.8 ? 2 : 1,
            "Existing coincident roof corners join only when the adjacent fill reaches them.",
          );
        const remaining = result.faces.findIndex(
          (polygon) =>
            faceNormal(result, polygon)[1] > 0.99 &&
            polygon.every((id) => Math.abs(result.vertices[id][1] - 1) < 1e-7),
        );
        assert.ok(remaining >= 0);
        for (const fourthDepth of depths) {
          const next = assertSafeEdit(
            result,
            extrude(result, remaining, fourthDepth),
            remaining,
          );
          assertClosed(next, 2);
          assert.ok(
            Math.abs(
              signedVolume(next) -
                signedVolume(raised) -
                4 * (depth + fourthDepth),
            ) < 1e-10,
          );
          if (depth === 1.1 && fourthDepth === 1.1)
            assert.equal(
              cornerVertices(next, 2.1).length,
              2,
              "The two newly tallest diagonal caps still have separate edge-contact endpoints.",
            );
        }
        assert.deepEqual(result, beforeFourth);
      }
    assert.deepEqual(raised, original);
  }
});

test("the final corner crosses each neighboring roof and all intervening heights without welding the taller edge", () => {
  const { mesh, face } = lastCorner();
  for (const roof of [0.5, 0.8, 1.1])
    for (const delta of [
      -1e-6, -2e-7, -1.1e-7, -0.9e-7, -1e-14, 0, 1e-14, 0.9e-7, 1.1e-7, 2e-7,
      1e-6,
    ]) {
      const depth = roof + delta,
        result = assertSafeEdit(mesh, extrude(mesh, face, depth), face);
      assertClosed(result, 2);
      assert.ok(
        Math.abs(signedVolume(result) - signedVolume(mesh) - 4 * depth) < 5e-7,
      );
    }
  const limited = constrainEdit(
    ([depth]) =>
      assertSafeEdit(mesh, previewExtrusion(mesh, face, depth), face),
    [0],
    [0.85],
  );
  assert.equal(limited.blocked, null);
  assert.deepEqual(limited.values, [0.85]);
});

test("an isolated obstacle vertex may touch the swept corner without entering its interior", () => {
  const source = combine(
    outward(
      [
        [1, 1.5, 1],
        [1.2, 1.8, 1.1],
        [1.1, 1.6, 1.4],
        [1.4, 1.3, 1.2],
      ],
      [
        [0, 1, 2],
        [0, 3, 1],
        [0, 2, 3],
        [1, 3, 2],
      ],
    ),
  );
  for (const depth of [0.5, 0.8]) {
    const result = assertSafeEdit(source, extrude(source, 5, depth), 5);
    assertClosed(result, 4);
    assert.ok(
      Math.abs(signedVolume(result) - signedVolume(source) - 4 * depth) < 1e-10,
    );
  }
});

test("lateral edge tangency remains valid after rotating the mesh in 3D", () => {
  const { mesh, face } = diagonalCorner(),
    angle = 0.73,
    c = Math.cos(angle),
    s = Math.sin(angle);
  mesh.vertices = mesh.vertices.map(([x, y, z]) => [
    x * c - y * s + 2.1,
    y * c + x * s - 0.8,
    z + 0.37,
  ]);
  const result = assertSafeEdit(mesh, extrude(mesh, face, 0.8), face);
  assertClosed(result, 2);
  assert.ok(Math.abs(signedVolume(result) - signedVolume(mesh) - 3.2) < 1e-10);
});

test("a corner-grazing cap can shorten past existing contacts on one or twenty wall levels", () => {
  for (const levels of [1, 20]) {
    let mesh = cube();
    for (const [face, depth] of [
      [3, 2],
      [1, 2],
      [8, 2],
    ])
      mesh = extrude(mesh, face, depth);
    const opposite = mesh.faces.findIndex((face) =>
      face.every((id) => {
        const [x, y, z] = mesh.vertices[id];
        return y === 1 && x >= 1 && z >= 1;
      }),
    );
    for (let i = 0; i < levels; i++)
      mesh = extrude(mesh, opposite, 0.8 / levels);
    const raised = assertSafeEdit(mesh, extrude(mesh, 5, 0.5), 5),
      original = structuredClone(raised),
      shorter = assertSafeEdit(raised, previewExtrusion(raised, 5, -0.2), 5);
    assertClosed(shorter, 2);
    assert.deepEqual(shorter.faces, raised.faces);
    assert.equal(shorter.vertices.length, raised.vertices.length);
    assert.ok(
      Math.abs(signedVolume(shorter) - signedVolume(mesh) - 1.2) < 1e-10,
    );
    assert.deepEqual(raised, original);
    const limited = constrainEdit(
      ([depth]) =>
        assertSafeEdit(raised, previewExtrusion(raised, 5, depth), 5),
      [0],
      [-0.2],
    );
    assert.equal(limited.blocked, null);
    assert.deepEqual(limited.values, [-0.2]);
    const branched = extrude(raised, mesh.faces.length, 0.1);
    assert.equal(inwardLimit(branched, 5), 0);
    assert.throws(() => previewExtrusion(branched, 5, -0.1), /supporting/);
  }
});

test("shortening a joined cap cannot drag a neighboring coplanar roof with it", () => {
  for (const face of [7, 12]) for (const depth of [0.5, 0.8]) {
    const { mesh } = perpendicularCorner(face),
      raised = assertSafeEdit(mesh, extrude(mesh, face, depth), face);
    assert.equal(inwardLimit(raised, face), 0);
    assert.throws(() => previewExtrusion(raised, face, -0.1), /supporting/);
    assertSafeEdit(raised, extrude(raised, face, 0.1), face);
  }
  for (const depth of [0.3, 1.1]) {
    const { mesh, face } = perpendicularCorner(),
      raised = assertSafeEdit(mesh, extrude(mesh, face, depth), face),
      shorter = assertSafeEdit(raised, previewExtrusion(raised, face, -0.1), face);
    assert.ok(Math.abs(signedVolume(shorter) - signedVolume(raised) + 0.4) < 1e-10);
  }
});

test("a triangle crossing the footprint still blocks even when none of its vertices lie inside", () => {
  const obstacle = diagonalPrism(-0.01),
    source = combine(obstacle);
  assert.ok(obstacle.vertices.every(([x, , z]) => x > 1 || z > 1));
  for (const depth of [0.3, 0.5, 1.6])
    assert.throws(
      () => assertSafeEdit(source, extrude(source, 5, depth), 5),
      /surface|intersect|geometry/,
    );
});

test("tangent permission belongs to extrusion, while generic edits and bevel first-contact remain guarded", () => {
  const { mesh, face } = diagonalCorner(),
    result = extrude(mesh, face, 0.5);
  assert.throws(
    () => assertSafeEdit(mesh, cloneMesh(result), face),
    /surface|intersect/,
  );
  const obstacle = cube();
  obstacle.vertices = obstacle.vertices.map(([x, y, z]) => [
    1 + 0.2 * x,
    1.7 + 0.2 * y,
    1 + 0.2 * z,
  ]);
  const source = combine(obstacle);
  assert.throws(
    () => assertSafeEdit(source, bevelFace(source, 5, 0.2, 0.5), 5),
    /surface|intersect/,
  );
});
