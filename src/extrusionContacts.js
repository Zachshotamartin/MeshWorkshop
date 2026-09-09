const EPS = 1e-7;
const sub = (a, b) => a.map((v, k) => v - b[k]);
const dot = (a, b) => a.reduce((sum, v, k) => sum + v * b[k], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const distance = (point, plane) => dot(sub(point, plane.origin), plane.normal);
const sweeps = new WeakMap();

/** Only the extrusion operation can authorize tangential side contacts. */
export function recordExtrusionSweep(source, result, selected, start, end) {
  const delta = sub(end[0], start[0]),
    depth = Math.hypot(...delta);
  if (depth <= EPS) return result;
  const normal = delta.map((v) => v / depth),
    sides = start.map((origin, i) => {
      const n = cross(sub(start[(i + 1) % start.length], origin), normal),
        size = Math.hypot(...n);
      return { origin: [...origin], normal: n.map((v) => v / size) };
    });
  // Wall clipping can change an original polygon beyond the cap's new height.
  // Include its existing lateral contacts there without widening the footprint.
  const capIds = new Set(source.faces[selected]);
  let lower = 0, upper = depth;
  for (const face of source.faces) {
    if (!face.some((id) => capIds.has(id))) continue;
    for (const id of face) {
      const level = dot(sub(source.vertices[id], start[0]), normal);
      lower = Math.min(lower, level);
      upper = Math.max(upper, level);
    }
  }
  sweeps.set(result, {
    source,
    selected,
    sides,
    planes: [
      ...sides,
      { origin: start[0].map((v, k) => v + normal[k] * lower), normal: normal.map((v) => -v) },
      { origin: start[0].map((v, k) => v + normal[k] * upper), normal },
    ],
  });
  return result;
}

/** Shortening also moves the connected side walls, including contacts below the cap. */
export function recordShorteningSweep(source, result, selected, normal) {
  const ids = new Set(source.faces[selected]),
    cap = source.faces[selected].map((id) => source.vertices[id]);
  let depth = 0;
  for (const face of source.faces) {
    if (!face.some((id) => ids.has(id))) continue;
    for (const id of face)
      depth = Math.max(depth, dot(sub(cap[0], source.vertices[id]), normal));
  }
  // Preserve the outward orientation of the footprint: swapping the cap and
  // its base would turn the lateral clipping planes inside out. Cover the full
  // edited wall height, not just the removed slice at the top.
  return recordExtrusionSweep(source, result, selected,
    cap.map((point) => point.map((v, k) => v - normal[k] * depth)), cap);
}

function clipToPrism(points, planes) {
  let polygon = points;
  for (const plane of planes) {
    const next = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length],
        da = distance(a, plane),
        db = distance(b, plane),
        insideA = da <= EPS,
        insideB = db <= EPS;
      if (insideA) next.push(a);
      if (insideA !== insideB) {
        const t = Math.max(0, Math.min(1, da / (da - db)));
        next.push(a.map((v, k) => v + (b[k] - v) * t));
      }
    }
    polygon = next;
    if (!polygon.length) break;
  }
  return polygon;
}

/** Certify that the entire obstacle/prism intersection stays on a lateral plane. */
export function extrusionContactTest(source, result, selected) {
  const sweep = sweeps.get(result);
  if (!sweep || sweep.source !== source || sweep.selected !== selected)
    return null;
  const cache = new WeakMap();
  return (triangle) => {
    if (cache.has(triangle)) return cache.get(triangle);
    // Clipping includes start and end depth. An overhead triangle touching
    // the cap's interior must block even at the first point of contact.
    const polygon = clipToPrism(triangle.points, sweep.planes),
      boundaries = polygon.length
        ? sweep.sides.filter((plane) =>
            polygon.every((point) => Math.abs(distance(point, plane)) <= EPS),
          )
        : [];
    // Looking only at the original triangle's vertices is insufficient: a
    // large or oblique triangle can cross the footprint between its vertices.
    const allowed = boundaries.length
      ? (point) =>
          sweep.planes.every((plane) => distance(point, plane) <= EPS) &&
          boundaries.some((plane) => Math.abs(distance(point, plane)) <= EPS)
      : null;
    cache.set(triangle, allowed);
    return allowed;
  };
}
