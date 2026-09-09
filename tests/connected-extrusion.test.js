import test from "node:test";
import assert from "node:assert/strict";
import {
  cube,
  extrude,
  inset,
  bevelFace,
  cloneMesh,
  faceNormal,
  topology,
  editFaceIndex,
} from "../src/mesh.js";
import { assertSafeEdit, constrainEdit } from "../src/intersections.js";
import { previewExtrusion, inwardLimit } from "../src/drag.js";
import { triangulatePolygon } from "../src/extrusionJoins.js";
import {
  connectedChannel,
  signedVolume,
} from "./fixtures/connected-channel.js";

function closed(mesh) {
  const stats = topology(mesh);
  assert.equal(stats.boundary, 0);
  assert.equal(stats.nonManifold, 0);
  assert.equal(stats.euler, 2);
  const directed = new Map();
  for (const face of mesh.faces)
    for (let i = 0; i < face.length; i++) {
      const a = face[i],
        b = face[(i + 1) % face.length],
        key = a < b ? `${a}/${b}` : `${b}/${a}`;
      directed.set(key, (directed.get(key) || 0) + (a < b ? 1 : -1));
    }
  assert.ok([...directed.values()].every((winding) => winding === 0));
}

test("one or two connected walls, including twenty levels, join below, at and above their roofs", () => {
  for (const left of [false, true])
    for (const wallSegments of [1, 20]) {
      const { mesh, face, capArea } = connectedChannel({ left, wallSegments }),
        original = structuredClone(mesh);
      for (const depth of [0.002, 0.3, 0.5, 0.85, 1.1]) {
        const result = assertSafeEdit(mesh, extrude(mesh, face, depth), face);
        closed(result);
        assert.equal(editFaceIndex(result, face), face);
        assert.ok(
          Math.abs(
            signedVolume(result) - signedVolume(mesh) - capArea * depth,
          ) < 1e-10,
        );
        assert.ok(
          result.faces[face].every(
            (id) => Math.abs(result.vertices[id][1] - 1 - depth) < 1e-7,
          ),
        );
      }
      assert.deepEqual(mesh, original);
    }
});

test("joined roof thresholds tolerate exact, near and real pointer-projected depths", () => {
  const { mesh, face } = connectedChannel();
  for (const roof of [0.5, 0.85])
    for (const offset of [
      -2e-7, -1.451414215e-7, -1e-8, 0, 1e-8, 1.451414215e-7, 2e-7,
    ]) {
      const depth = roof + offset,
        result = assertSafeEdit(mesh, extrude(mesh, face, depth), face);
      closed(result);
      assert.ok(
        Math.abs(signedVolume(result) - signedVolume(mesh) - 1.3 * depth) <
          2e-7,
      );
    }
});

test("a joined extrusion can continue through both roofs and its free cap can shorten", () => {
  const original = connectedChannel();
  let mesh = original.mesh,
    face = original.face,
    total = 0;
  for (const depth of [0.3, 0.2, 0.35, 0.25]) {
    const result = assertSafeEdit(mesh, extrude(mesh, face, depth), face);
    face = editFaceIndex(result, face);
    mesh = result;
    total += depth;
    closed(mesh);
    assert.ok(
      Math.abs(signedVolume(mesh) - signedVolume(original.mesh) - 1.3 * total) <
        1e-10,
    );
  }
  assert.ok(inwardLimit(mesh, face) < -0.1);
  closed(assertSafeEdit(mesh, previewExtrusion(mesh, face, -0.1), face));
});

test("joins use the face plane in arbitrary 3D orientations", () => {
  for (const angles of [
    [0.4, 0.8, -0.3],
    [1.7, -0.6, 2.4],
  ]) {
    const { mesh, face } = connectedChannel({ wallSegments: 20 });
    mesh.vertices = mesh.vertices.map((vertex) => {
      const p = [...vertex];
      angles.forEach((angle, axis) => {
        const a = (axis + 1) % 3,
          b = (axis + 2) % 3,
          c = Math.cos(angle),
          s = Math.sin(angle);
        [p[a], p[b]] = [p[a] * c - p[b] * s, p[a] * s + p[b] * c];
      });
      return p.map((v, k) => v + [2.3, -1.7, 4.2][k]);
    });
    for (const depth of [0.3, 0.5, 0.85, 1.1]) {
      const result = assertSafeEdit(mesh, extrude(mesh, face, depth), face);
      closed(result);
      assert.ok(
        Math.abs(signedVolume(result) - signedVolume(mesh) - 1.3 * depth) <
          1e-9,
      );
    }
  }
});

function acrossWall(mesh, count) {
  const result = cloneMesh(mesh),
    wall = result.faces.findIndex((face) => {
      const n = faceNormal(result, face);
      return (
        n[0] < -0.99 &&
        face.every((id) => Math.abs(result.vertices[id][0] + 1) < 1e-8)
      );
    }),
    [a, b, c, d] = result.faces[wall];
  function edge(start, end) {
    return Array.from({ length: count + 1 }, (_, i) => {
      if (i === 0) return start;
      if (i === count) return end;
      const t = i / count,
        id = result.vertices.length;
      result.vertices.push(
        result.vertices[start].map(
          (v, k) => v + (result.vertices[end][k] - v) * t,
        ),
      );
      result.vertexDrivers.push([
        [start, 1 - t],
        [end, t],
      ]);
      return id;
    });
  }
  const lower = edge(a, b),
    upper = edge(d, c);
  result.faces = result.faces.map((face, index) =>
    index === wall
      ? face
      : face.flatMap((u, i) => {
          const v = face[(i + 1) % face.length];
          for (const ids of [lower, upper]) {
            if (u === ids[0] && v === ids.at(-1)) return ids.slice(0, -1);
            if (v === ids[0] && u === ids.at(-1))
              return [...ids].reverse().slice(0, -1);
          }
          return [u];
        }),
  );
  const strips = Array.from({ length: count }, (_, i) => [
    lower[i],
    lower[i + 1],
    upper[i + 1],
    upper[i],
  ]);
  result.faces[wall] = strips[0];
  result.faces.push(...strips.slice(1));
  return result;
}

test("twenty wall strips across a cap edge join without a special side-count limit", () => {
  const fixture = connectedChannel({ left: false }),
    mesh = acrossWall(fixture.mesh, 20),
    face = fixture.face;
  closed(mesh);
  assert.equal(mesh.faces[face].length, 23);
  for (const depth of [0.3, 0.85, 1.1]) {
    const result = assertSafeEdit(mesh, extrude(mesh, face, depth), face);
    closed(result);
    assert.ok(
      Math.abs(signedVolume(result) - signedVolume(mesh) - 1.3 * depth) < 1e-10,
    );
  }
});

test("face compaction keeps real overhead obstacles in the intersection and swept-volume checks", () => {
  const { mesh: channel, face } = connectedChannel({ wallSegments: 20 }),
    other = cube(),
    mesh = cloneMesh(channel),
    offset = mesh.vertices.length;
  mesh.vertices.push(
    ...other.vertices.map(([x, y, z]) => [
      -1.325 + 0.1 * x,
      1.7 + 0.1 * y,
      0.1 * z,
    ]),
  );
  mesh.faces.push(...other.faces.map((f) => f.map((id) => id + offset)));
  // This extra solid starts above the low cap and is fully enclosed by a 1.1 pull.
  for (const depth of [0.65, 1.1])
    assert.throws(
      () => assertSafeEdit(mesh, extrude(mesh, face, depth), face),
      /surface|intersect|geometry/,
    );
  const limited = constrainEdit(
    ([depth]) =>
      assertSafeEdit(mesh, previewExtrusion(mesh, face, depth), face),
    [0],
    [1.1],
  );
  assert.ok(limited.blocked);
  assert.ok(limited.values[0] > 0.599 && limited.values[0] < 0.6);
  assertSafeEdit(mesh, limited.mesh, face);
});

test("selection follows the cap when removing many joined walls compacts its old slot", () => {
  const fixture = connectedChannel({ wallSegments: 20 }),
    mesh = cloneMesh(fixture.mesh),
    [cap] = mesh.faces.splice(fixture.face, 1);
  mesh.faces.push(cap);
  const oldFace = mesh.faces.length - 1,
    result = assertSafeEdit(mesh, extrude(mesh, oldFace, 1.1), oldFace),
    selected = editFaceIndex(result, oldFace);
  assert.ok(selected < oldFace);
  assert.ok(
    result.faces[selected].every(
      (id) => Math.abs(result.vertices[id][1] - 2.1) < 1e-7,
    ),
  );
  closed(result);
  assert.ok(Math.abs(signedVolume(result) - signedVolume(mesh) - 1.43) < 1e-10);
  const next = assertSafeEdit(result, extrude(result, selected, 0.2), selected);
  closed(next);
  assert.ok(
    next.faces[editFaceIndex(next, selected)].every(
      (id) => Math.abs(next.vertices[id][1] - 2.3) < 1e-7,
    ),
  );
});

test("a connected overhang remains a true blocker while adjoining coplanar walls join", () => {
  const fixture = connectedChannel(),
    face = fixture.face;
  let mesh = fixture.mesh;
  const wall = mesh.faces.findIndex(
    (f) =>
      faceNormal(mesh, f)[0] < -0.99 &&
      f.every((id) => Math.abs(mesh.vertices[id][0] + 1) < 1e-8),
  );
  mesh = assertSafeEdit(mesh, inset(mesh, wall, 0.5), wall);
  mesh = assertSafeEdit(mesh, extrude(mesh, wall, 0.25), wall);
  for (const depth of [0.4, 1.1])
    assert.throws(
      () => assertSafeEdit(mesh, extrude(mesh, face, depth), face),
      /surface|intersect|geometry/,
    );
  assert.throws(
    () => assertSafeEdit(mesh, bevelFace(mesh, face, 0.2, 1.1), face),
    /surface|intersect|geometry/,
  );
});

test("triangulation retains collinear corners that are shared with joined walls", () => {
  const vertices = [
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1.85, 1],
      [-1, 1.85, 1],
      [-1, 1.5, 1],
      [-1, 1.3, 1],
    ],
    face = [0, 1, 2, 3, 4, 5],
    triangles = triangulatePolygon(vertices, face);
  assert.equal(triangles.length, face.length - 2);
  assert.deepEqual(new Set(triangles.flat()), new Set(face));
  const edges = new Map();
  for (const triangle of triangles)
    for (let i = 0; i < 3; i++) {
      const ids = [triangle[i], triangle[(i + 1) % 3]].sort((a, b) => a - b),
        key = ids.join("/");
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  for (let i = 0; i < face.length; i++)
    assert.equal(
      edges.get(
        [face[i], face[(i + 1) % face.length]].sort((a, b) => a - b).join("/"),
      ),
      1,
    );
});
