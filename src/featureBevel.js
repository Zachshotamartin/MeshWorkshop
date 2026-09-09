import { cloneMesh, faceNormal } from "./mesh.js";
import { assertSafeEdit } from "./intersections.js";
const EPS = 1e-7;
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const unit = (v) => {
  const length = Math.hypot(...v);
  if (length < EPS) throw Error("Choose a convex corner or a sharp edge.");
  return v.map((x) => x / length);
};
export function meshEdges(mesh) {
  const edges = new Map();
  mesh.faces.forEach((face, index) =>
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length],
        ids = [a, b].sort((x, y) => x - y),
        key = ids.join("/");
      if (!edges.has(key)) edges.set(key, { ids, faces: [] });
      edges.get(key).faces.push(index);
    }),
  );
  return [...edges.values()];
}
export function featurePlane(mesh, kind, key) {
  const selected = kind === "edge" ? key : [key],
    ids = new Set(selected);
  let incident = mesh.faces
    .map((f, i) => (f.some((id) => ids.has(id)) ? i : -1))
    .filter((i) => i >= 0);
  const normals =
    kind === "edge"
      ? meshEdges(mesh).find((edge) => edge.ids.every((id) => ids.has(id)))
          ?.faces
      : incident;
  if (!normals?.length || (kind === "edge" && normals.length !== 2))
    throw Error("An edge bevel needs two connected faces.");
  const ns = normals.map((i) => faceNormal(mesh, mesh.faces[i]));
  if (kind === "edge" && dot(ns[0], ns[1]) > 1 - EPS)
    throw Error("This edge is flat; choose a sharp edge.");
  const normal = unit(
      ns.reduce((sum, n) => sum.map((v, k) => v + n[k]), [0, 0, 0]),
    ),
    origin = mesh.vertices[selected[0]],
    level = dot(origin, normal);
  const depths = [...new Set(incident.flatMap((i) => mesh.faces[i]))]
    .filter((id) => !ids.has(id))
    .map((id) => level - dot(mesh.vertices[id], normal));
  if (!depths.length || depths.some((d) => d <= EPS))
    throw Error("Only convex edges and corners support an inward bevel here.");
  const maxDepth = Math.min(...depths) * 0.98;
  return { normal, level, maxDepth, selected, incident };
}
/** Locally clip the selected convex feature and close the resulting boundary with a flat chamfer. */
export function bevelFeature(mesh, kind, key, depth) {
  if (!Number.isFinite(depth) || depth < 0)
    throw Error("Bevel depth must be inward and nonnegative.");
  if (depth < 0.0005) return cloneMesh(mesh);
  const plane = featurePlane(mesh, kind, key);
  if (depth > plane.maxDepth)
    throw Error("The bevel has reached the next edge.");
  const result = cloneMesh(mesh),
    cuts = new Map(),
    limit = plane.level - depth;
  result.vertexDrivers ||= Array.from(
    { length: result.vertices.length },
    () => null,
  );
  function cut(a, b) {
    const edge = [a, b].sort((x, y) => x - y).join("/");
    if (cuts.has(edge)) return cuts.get(edge);
    const pa = mesh.vertices[a],
      pb = mesh.vertices[b],
      t = (limit - dot(pa, plane.normal)) / dot(sub(pb, pa), plane.normal),
      id = result.vertices.length;
    result.vertices.push(pa.map((v, k) => v + (pb[k] - v) * t));
    result.vertexDrivers.push([
      [a, 1 - t],
      [b, t],
    ]);
    cuts.set(edge, id);
    return id;
  }
  for (const index of plane.incident) {
    const face = mesh.faces[index],
      clipped = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i],
        b = face[(i + 1) % face.length],
        insideA = dot(mesh.vertices[a], plane.normal) <= limit,
        insideB = dot(mesh.vertices[b], plane.normal) <= limit;
      if (insideA) clipped.push(a);
      if (insideA !== insideB) clipped.push(cut(a, b));
    }
    if (clipped.length < 3)
      throw Error("The bevel would remove a neighboring face.");
    result.faces[index] = clipped;
  }
  const directed = new Map();
  for (const face of result.faces)
    for (let i = 0; i < face.length; i++) {
      const a = face[i],
        b = face[(i + 1) % face.length],
        key = [a, b].sort((x, y) => x - y).join("/");
      const value = directed.get(key);
      if (value) value.count++;
      else directed.set(key, { a, b, count: 1 });
    }
  const boundary = [...directed.values()].filter((edge) => edge.count === 1),
    next = new Map(boundary.map(({ a, b }) => [b, a]));
  if (boundary.length < 3 || next.size !== boundary.length)
    throw Error("The bevel boundary cannot be closed safely.");
  const cap = [boundary[0].b];
  let id = next.get(cap[0]);
  while (id !== cap[0] && cap.length <= boundary.length) {
    if (id === undefined) throw Error("The bevel boundary is disconnected.");
    cap.push(id);
    id = next.get(id);
  }
  if (cap.length !== boundary.length)
    throw Error("The bevel would create disconnected cuts.");
  result.faces.push(cap);
  if (result.faces.length > 16000)
    throw Error("This edit would exceed the face limit.");
  return assertSafeEdit(mesh, result);
}
