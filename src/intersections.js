// Narrow-phase tests allow shared topological edges, but reject overlap beyond them.
const EPS = 1e-7;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a) => Math.hypot(...a);
const normal = (p) => {
  const n = cross(sub(p[1], p[0]), sub(p[2], p[0])),
    l = length(n);
  return l > EPS ? n.map((v) => v / l) : null;
};
const bounds = (points) => ({
  min: [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k]))),
  max: [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k]))),
});
const overlaps = (a, b) =>
  a.min.every((v, i) => v <= b.max[i] + EPS && a.max[i] >= b.min[i] - EPS);
function onSegment(p, a, b) {
  const v = sub(b, a),
    w = sub(p, a),
    d = dot(v, v);
  if (d < EPS * EPS) return length(w) < EPS;
  const t = dot(w, v) / d;
  return (
    t >= -EPS &&
    t <= 1 + EPS &&
    length(
      sub(
        w,
        v.map((x) => x * t),
      ),
    ) < EPS
  );
}
function insideTriangle(p, points, n) {
  return points.every((a, i) => {
    const edge = sub(points[(i + 1) % 3], a);
    // The cross product measures signed area, so scale the distance tolerance
    // by edge length. Otherwise short extrusion edges acquire a much wider
    // collision margin than the rest of the mesh.
    return dot(cross(edge, sub(p, a)), n) >= -EPS * length(edge);
  });
}
function segmentHits(a, b, points, n) {
  const da = dot(sub(a, points[0]), n),
    db = dot(sub(b, points[0]), n),
    hits = [];
  if (Math.abs(da) < EPS && insideTriangle(a, points, n)) hits.push(a);
  if (Math.abs(db) < EPS && insideTriangle(b, points, n)) hits.push(b);
  if (da * db < 0) {
    const t = da / (da - db),
      p = a.map((v, i) => v + (b[i] - v) * t);
    if (insideTriangle(p, points, n)) hits.push(p);
  }
  return hits;
}
function coplanarOverlap(a, b, n) {
  const axis = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs))),
    project = (p) => p.filter((_, i) => i !== axis),
    A = a.map(project),
    B = b.map(project);
  const turn = (a, b, p) =>
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const sign = Math.sign(turn(B[0], B[1], B[2]));
  let polygon = A;
  for (let i = 0; i < 3 && polygon.length; i++) {
    const q = B[i],
      r = B[(i + 1) % 3],
      out = [];
    for (let j = 0; j < polygon.length; j++) {
      const p = polygon[j],
        s = polygon[(j + 1) % polygon.length],
        dp = sign * turn(q, r, p),
        ds = sign * turn(q, r, s);
      if (dp >= -EPS) out.push(p);
      if ((dp > EPS && ds < -EPS) || (dp < -EPS && ds > EPS)) {
        const t = dp / (dp - ds);
        out.push(p.map((v, k) => v + (s[k] - v) * t));
      }
    }
    polygon = out;
  }
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i],
      q = polygon[(i + 1) % polygon.length];
    area += p[0] * q[1] - p[1] * q[0];
  }
  return Math.abs(area) > EPS * EPS * 10;
}
export function trianglesConflict(a, b) {
  if (!overlaps(a.box, b.box)) return false;
  const na = normal(a.points),
    nb = normal(b.points);
  if (!na || !nb) return true;
  const shared = a.ids
    .filter((id) => b.ids.includes(id))
    .map((id) => a.points[a.ids.indexOf(id)]);
  const allowed = (p) =>
    shared.some((v) => length(sub(p, v)) < EPS) ||
    (shared.length >= 2 && onSegment(p, shared[0], shared[1]));
  const coplanar =
    length(cross(na, nb)) < EPS &&
    Math.abs(dot(sub(a.points[0], b.points[0]), nb)) < EPS;
  if (coplanar && coplanarOverlap(a.points, b.points, na)) return true;
  for (const [first, second, n] of [
    [a, b, nb],
    [b, a, na],
  ])
    for (let i = 0; i < 3; i++) {
      for (const p of segmentHits(
        first.points[i],
        first.points[(i + 1) % 3],
        second.points,
        n,
      ))
        if (!allowed(p)) return true;
    }
  return false;
}
function triangles(mesh, face) {
  const ids = mesh.faces[face],
    out = [];
  for (let i = 1; i < ids.length - 1; i++) {
    const indices = [ids[0], ids[i], ids[i + 1]],
      points = indices.map((id) => mesh.vertices[id]);
    out.push({ ids: indices, points, face, box: bounds(points) });
  }
  return out;
}
function tree(items) {
  if (!items.length) return null;
  const box = {
    min: [0, 1, 2].map((k) => Math.min(...items.map((t) => t.box.min[k]))),
    max: [0, 1, 2].map((k) => Math.max(...items.map((t) => t.box.max[k]))),
  };
  if (items.length <= 8) return { box, items };
  const spans = box.max.map((v, i) => v - box.min[i]),
    axis = spans.indexOf(Math.max(...spans));
  items.sort(
    (a, b) =>
      a.box.min[axis] + a.box.max[axis] - b.box.min[axis] - b.box.max[axis],
  );
  const mid = Math.floor(items.length / 2);
  return {
    box,
    left: tree(items.slice(0, mid)),
    right: tree(items.slice(mid)),
  };
}
function query(node, box, out) {
  if (!node || !overlaps(node.box, box)) return;
  if (node.items) out.push(...node.items);
  else {
    query(node.left, box, out);
    query(node.right, box, out);
  }
}
const cache = new WeakMap();
function sourceTree(mesh) {
  let value = cache.get(mesh);
  if (!value) {
    value = tree(mesh.faces.flatMap((_, i) => triangles(mesh, i)));
    cache.set(mesh, value);
  }
  return value;
}
function validatePolygon(points) {
  const n = normal(points);
  if (!n) throw new Error("This edit would collapse a face.");
  if (points.some((p) => Math.abs(dot(sub(p, points[0]), n)) > EPS * 10))
    throw new Error("This edit would twist a connected face.");
  for (let i = 0; i < points.length; i++)
    if (
      dot(
        cross(
          sub(points[(i + 1) % points.length], points[i]),
          sub(points[(i + 2) % points.length], points[(i + 1) % points.length]),
        ),
        n,
      ) <=
      EPS * EPS
    )
      throw new Error("This edit would fold or collapse a face.");
}
/** Broad-phase tree is cached per immutable gesture source; only edited faces are tested. */
export function assertSafeEdit(source, result, selected) {
  const changed = new Set(),
    moved = new Set();
  result.vertices.forEach((p, id) => {
    if (
      !source.vertices[id] ||
      p.some((v, k) => Math.abs(v - source.vertices[id][k]) > EPS)
    )
      moved.add(id);
  });
  result.faces.forEach((f, i) => {
    if (
      !source.faces[i] ||
      f.length !== source.faces[i].length ||
      f.some((id, k) => id !== source.faces[i][k] || moved.has(id))
    )
      changed.add(i);
  });
  if (!changed.size) return result;
  const dynamic = [];
  for (const face of changed) {
    validatePolygon(result.faces[face].map((id) => result.vertices[id]));
    dynamic.push(...triangles(result, face));
  }
  const spatial = sourceTree(source);
  for (let i = 0; i < dynamic.length; i++) {
    const a = dynamic[i],
      neighbors = [];
    query(spatial, a.box, neighbors);
    for (const b of neighbors)
      if (!changed.has(b.face) && trianglesConflict(a, b))
        throw new Error("Blocked by another surface.");
    for (let j = 0; j < i; j++)
      if (a.face !== dynamic[j].face && trianglesConflict(a, dynamic[j]))
        throw new Error("This edit would intersect a connected face.");
  }
  // A large pull can enclose a small obstacle without leaving a surface crossing
  // at its endpoint. Test the swept cap volume as well as the final surface.
  const start = source.faces[selected]?.map((id) => source.vertices[id]),
    end = result.faces[selected]?.map((id) => result.vertices[id]);
  if (start && end && start.length === end.length) {
    const center = [0, 1, 2].map(
      (k) =>
        [...start, ...end].reduce((sum, p) => sum + p[k], 0) /
        (start.length * 2),
    );
    const planes = [
      start,
      [...end].reverse(),
      ...start.map((p, i) => [
        p,
        start[(i + 1) % start.length],
        end[(i + 1) % end.length],
        end[i],
      ]),
    ]
      .map((points) => {
        const n = normal(points);
        if (!n) return null;
        const sign = dot(sub(center, points[0]), n) > 0 ? -1 : 1;
        return { p: points[0], n: n.map((v) => v * sign) };
      })
      .filter(Boolean);
    const volume =
      planes.length >= 4 &&
      planes.every(({ p, n }) => dot(sub(center, p), n) < -EPS);
    if (volume) {
      const capIds = new Set(source.faces[selected]),
        activeVertices = new Set(source.faces.flat());
      for (let id = 0; id < source.vertices.length; id++)
        if (
          activeVertices.has(id) &&
          !capIds.has(id) &&
          planes.every(({ p, n }) => dot(sub(source.vertices[id], p), n) < -EPS)
        )
          throw new Error("This edit would pass through existing geometry.");
    }
  }
  return result;
}

/** Clamp a proposed gesture to its last valid point, including large pointer jumps. */
export function constrainEdit(make, previous, requested) {
  try {
    return { mesh: make(requested), values: requested, blocked: null };
  } catch (error) {
    let low = 0,
      high = 1,
      values = previous,
      mesh = make(previous);
    for (let i = 0; i < 12; i++) {
      const t = (low + high) / 2,
        next = requested.map((v, k) => previous[k] + (v - previous[k]) * t);
      try {
        const candidate = make(next);
        low = t;
        values = next;
        mesh = candidate;
      } catch {
        high = t;
      }
    }
    return { mesh, values, blocked: error.message };
  }
}
