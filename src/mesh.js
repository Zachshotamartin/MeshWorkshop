import { recordVertexDrivers } from "./deformation.js";

const add = (a, b) => a.map((v, i) => v + b[i]),
  sub = (a, b) => a.map((v, i) => v - b[i]),
  mul = (a, s) => a.map((v) => v * s),
  mean = (ps) => mul(ps.reduce(add, [0, 0, 0]), 1 / ps.length);
export const cloneMesh = (m) => ({
  vertices: m.vertices.map((p) => [...p]),
  faces: m.faces.map((f) => [...f]),
  ...(m.vertexDrivers
    ? {
        vertexDrivers: m.vertexDrivers.map(
          (drivers) => drivers?.map((pair) => [...pair]) || null,
        ),
      }
    : {}),
});
export function faceNormal(mesh, face) {
  const n = [0, 0, 0];
  for (let i = 0; i < face.length; i++) {
    const p = mesh.vertices[face[i]],
      q = mesh.vertices[face[(i + 1) % face.length]];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const l = Math.hypot(...n);
  if (l < 1e-10) throw new Error("Selected face has no area.");
  return mul(n, 1 / l);
}
export function cube() {
  return {
    vertices: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
    faces: [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 4, 7, 3],
      [1, 2, 6, 5],
      [0, 1, 5, 4],
      [3, 7, 6, 2],
    ],
  };
}
function validate(m, face) {
  if (
    !m ||
    !Array.isArray(m.vertices) ||
    !Array.isArray(m.faces) ||
    m.faces.length > 16000
  )
    throw new Error("Mesh exceeds the 16,000 face editing limit.");
  if (!Number.isInteger(face) || face < 0 || face >= m.faces.length)
    throw new Error("Choose a face first.");
}
export function extrude(mesh, index, distance = 0.5) {
  validate(mesh, index);
  if (mesh.faces.length + mesh.faces[index].length > 16000)
    throw new Error("This edit would exceed the 16,000 face limit.");
  if (!Number.isFinite(distance) || distance <= 0 || distance > 3)
    throw new Error(
      "Extrusion distance must be greater than zero and at most 3.",
    );
  const m = cloneMesh(mesh),
    f = m.faces[index],
    n = faceNormal(m, f),
    start = m.vertices.length;
  for (const i of f) m.vertices.push(add(m.vertices[i], mul(n, distance)));
  recordVertexDrivers(m, f, start, 0);
  m.faces[index] = f.map((_, i) => start + i);
  for (let i = 0; i < f.length; i++) {
    const j = (i + 1) % f.length;
    m.faces.push([f[i], f[j], start + j, start + i]);
  }
  return m;
}
export function inset(mesh, index, fraction = 0.2) {
  validate(mesh, index);
  if (mesh.faces.length + mesh.faces[index].length > 16000)
    throw new Error("This edit would exceed the 16,000 face limit.");
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 0.8)
    throw new Error("Inset fraction must be between 0 and 0.8.");
  const m = cloneMesh(mesh),
    f = m.faces[index],
    center = mean(f.map((i) => m.vertices[i])),
    start = m.vertices.length;
  for (const i of f)
    m.vertices.push(
      add(m.vertices[i], mul(sub(center, m.vertices[i]), fraction)),
    );
  recordVertexDrivers(m, f, start, fraction);
  m.faces[index] = f.map((_, i) => start + i);
  for (let i = 0; i < f.length; i++) {
    const j = (i + 1) % f.length;
    m.faces.push([f[i], f[j], start + j, start + i]);
  }
  return m;
}
export function subdivide(mesh) {
  if (mesh.faces.reduce((sum, f) => sum + f.length, 0) > 16000)
    throw new Error(
      "Subdivision would exceed 16,000 faces. Undo or use a simpler mesh.",
    );
  const facePoints = mesh.faces.map((f) =>
      mean(f.map((i) => mesh.vertices[i])),
    ),
    edges = new Map(),
    touch = mesh.vertices.map(() => ({ faces: [], edges: [] }));
  mesh.faces.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i],
        b = f[(i + 1) % f.length],
        key = [a, b].sort((x, y) => x - y).join("/");
      if (!edges.has(key))
        edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [] });
      edges.get(key).faces.push(fi);
      touch[a].faces.push(fi);
    }
  });
  for (const [key, e] of edges) {
    if (e.faces.length > 2)
      throw new Error("Subdivision requires manifold edges.");
    touch[e.a].edges.push(key);
    touch[e.b].edges.push(key);
  }
  const vertices = mesh.vertices.map((p, i) => {
    const t = touch[i],
      boundary = t.edges
        .map((k) => edges.get(k))
        .filter((e) => e.faces.length === 1);
    if (boundary.length === 2) {
      const neighbors = boundary.map(
        (e) => mesh.vertices[e.a === i ? e.b : e.a],
      );
      return mul(add(mul(p, 6), add(...neighbors)), 1 / 8);
    }
    if (!t.faces.length) return [...p];
    const n = t.faces.length,
      F = mean(t.faces.map((fi) => facePoints[fi])),
      R = mean(
        t.edges.map((k) => {
          const e = edges.get(k);
          return mean([mesh.vertices[e.a], mesh.vertices[e.b]]);
        }),
      );
    return mul(add(add(F, mul(R, 2)), mul(p, n - 3)), 1 / n);
  });
  for (const e of edges.values()) {
    e.index = vertices.length;
    vertices.push(
      e.faces.length === 2
        ? mean([
            mesh.vertices[e.a],
            mesh.vertices[e.b],
            ...e.faces.map((fi) => facePoints[fi]),
          ])
        : mean([mesh.vertices[e.a], mesh.vertices[e.b]]),
    );
  }
  const start = vertices.length;
  vertices.push(...facePoints);
  const faces = [];
  mesh.faces.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const prev = f[(i + f.length - 1) % f.length],
        a = f[i],
        next = f[(i + 1) % f.length],
        key = (x, y) => [x, y].sort((p, q) => p - q).join("/");
      faces.push([
        a,
        edges.get(key(a, next)).index,
        start + fi,
        edges.get(key(prev, a)).index,
      ]);
    }
  });
  return { vertices, faces };
}
export function topology(mesh) {
  const activeVertices = new Set(mesh.faces.flat());
  const edges = new Map();
  for (const f of mesh.faces)
    for (let i = 0; i < f.length; i++) {
      const k = [f[i], f[(i + 1) % f.length]].sort((a, b) => a - b).join("/");
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  return {
    vertices: activeVertices.size,
    faces: mesh.faces.length,
    edges: edges.size,
    boundary: [...edges.values()].filter((n) => n === 1).length,
    nonManifold: [...edges.values()].filter((n) => n > 2).length,
    euler: activeVertices.size - edges.size + mesh.faces.length,
  };
}
export function preset(name) {
  let m = cube();
  if (name === "Terraced tower") {
    m = extrude(m, 5, 0.65);
    m = inset(m, 5, 0.25);
    m = extrude(m, 5, 0.8);
    m = inset(m, 5, 0.3);
    m = extrude(m, 5, 0.55);
  }
  if (name === "Studio wing") {
    m = extrude(m, 3, 1.1);
    m = inset(m, 3, 0.22);
    m = extrude(m, 3, 0.35);
    m = extrude(m, 5, 0.45);
    m = inset(m, 5, 0.18);
  }
  if (name === "Rounded vessel") {
    m = inset(m, 5, 0.3);
    m = extrude(m, 5, 0.9);
    m = subdivide(m);
    m = subdivide(m);
  }
  return m;
}
export function toOBJ(mesh) {
  const used = [...new Set(mesh.faces.flat())].sort((a, b) => a - b),
    indices = new Map(used.map((id, i) => [id, i + 1]));
  return (
    [
      "# Mesh Workshop — editable polygon mesh",
      ...used.map(
        (id) => "v " + mesh.vertices[id].map((v) => v.toFixed(6)).join(" "),
      ),
      ...mesh.faces.map(
        (face) => "f " + face.map((id) => indices.get(id)).join(" "),
      ),
    ].join("\n") + "\n"
  );
}

export function bevelFace(mesh, index, fraction = 0.2, distance = 0.25) {
  validate(mesh, index);
  if (mesh.faces.length + mesh.faces[index].length > 16000)
    throw new Error("This edit would exceed the 16,000 face limit.");
  if (
    !Number.isFinite(fraction) ||
    fraction <= 0 ||
    fraction >= 0.8 ||
    !Number.isFinite(distance) ||
    distance < 0 ||
    distance > 3
  )
    throw Error(
      "Use a bevel fraction between 0 and 0.8 and a height from 0 to 3.",
    );
  const m = cloneMesh(mesh),
    f = m.faces[index],
    center = mean(f.map((i) => m.vertices[i])),
    normal = faceNormal(m, f),
    start = m.vertices.length;
  for (const id of f)
    m.vertices.push(
      add(
        add(m.vertices[id], mul(sub(center, m.vertices[id]), fraction)),
        mul(normal, distance),
      ),
    );
  recordVertexDrivers(m, f, start, fraction);
  m.faces[index] = f.map((_, i) => start + i);
  for (let i = 0; i < f.length; i++) {
    const j = (i + 1) % f.length;
    m.faces.push([f[i], f[j], start + j, start + i]);
  }
  return m;
}
export function splitFace(mesh, index) {
  validate(mesh, index);
  if (mesh.faces.length + 1 > 16000)
    throw new Error("This edit would exceed the 16,000 face limit.");
  const m = cloneMesh(mesh),
    f = m.faces[index];
  if (f.length < 4)
    throw Error(
      "This face is already a triangle. Select a face with four or more corners.",
    );
  const middle = Math.floor(f.length / 2);
  m.faces[index] = f.slice(0, middle + 1);
  m.faces.push([f[0], ...f.slice(middle)]);
  return m;
}
