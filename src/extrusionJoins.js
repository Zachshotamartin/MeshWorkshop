const EPS = 1e-7;
const sub = (a, b) => a.map((v, k) => v - b[k]);
const dot = (a, b) => a.reduce((sum, v, k) => sum + v * b[k], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (v) => Math.hypot(...v);
const edgeKey = (a, b) => (a < b ? `${a}/${b}` : `${b}/${a}`);

export function polygonNormal(points) {
  const n = [0, 0, 0];
  for (let i = 1; i < points.length - 1; i++) {
    const c = cross(sub(points[i], points[0]), sub(points[i + 1], points[0]));
    for (let k = 0; k < 3; k++) n[k] += c[k];
  }
  const size = length(n);
  return size > EPS * EPS ? n.map((v) => v / size) : null;
}

/** Keep collinear boundary corners in the triangles used for surface tests. */
export function triangulatePolygon(vertices, face) {
  const ids = [...face],
    out = [],
    n = polygonNormal(ids.map((id) => vertices[id]));
  if (!n) return [];
  while (ids.length > 3) {
    const ear = ids.findIndex((id, i) => {
      const corners = [
          ids[(i + ids.length - 1) % ids.length],
          id,
          ids[(i + 1) % ids.length],
        ],
        points = corners.map((corner) => vertices[corner]);
      if (
        dot(cross(sub(points[1], points[0]), sub(points[2], points[1])), n) <=
        EPS * EPS
      )
        return false;
      // An ear may not skip a collinear boundary corner on its diagonal.
      // Otherwise that corner vanishes from the collision/picking triangles.
      return !ids.some(
        (other) =>
          !corners.includes(other) &&
          points.every(
            (a, j) =>
              dot(
                cross(sub(points[(j + 1) % 3], a), sub(vertices[other], a)),
                n,
              ) >=
              -EPS * EPS,
          ),
      );
    });
    if (ear < 0) return [];
    out.push([
      ids[(ear + ids.length - 1) % ids.length],
      ids[ear],
      ids[(ear + 1) % ids.length],
    ]);
    ids.splice(ear, 1);
  }
  if (polygonNormal(ids.map((id) => vertices[id]))) out.push(ids);
  return out;
}

const edits = new WeakMap();
export const extrusionJoinInfo = (mesh) => edits.get(mesh);
export const editFaceIndex = (mesh, fallback) =>
  edits.get(mesh)?.selected ?? fallback;

function overlapsArea(points, clip, normal) {
  let polygon = points;
  for (let i = 0; i < clip.length && polygon.length; i++) {
    const origin = clip[i],
      edge = sub(clip[(i + 1) % clip.length], origin),
      raw = cross(normal, edge),
      size = length(raw),
      inward = raw.map((v) => v / size),
      next = [];
    for (let j = 0; j < polygon.length; j++) {
      const a = polygon[j],
        b = polygon[(j + 1) % polygon.length],
        da = dot(sub(a, origin), inward),
        db = dot(sub(b, origin), inward);
      if (da >= -EPS) next.push(a);
      if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
        const t = da / (da - db);
        next.push(a.map((v, k) => v + (b[k] - v) * t));
      }
    }
    polygon = next;
  }
  return polygonNormal(polygon) !== null;
}

// Convex clipping extends each cut to an infinite line. Recover the finite
// remainder outline so those construction lines do not subdivide other faces.
function repartition(pieces, vertices, removable) {
  if (pieces.length < 2) return pieces;
  const ids = [...new Set(pieces.flat())],
    directed = new Map();
  for (const face of pieces) {
    const outline = face.flatMap((a, i) => {
      const b = face[(i + 1) % face.length],
        edge = sub(vertices[b], vertices[a]),
        size = dot(edge, edge),
        cuts = [];
      for (const id of ids) {
        if (id === a || id === b) continue;
        const delta = sub(vertices[id], vertices[a]),
          t = dot(delta, edge) / size;
        if (
          t * Math.sqrt(size) > EPS &&
          (1 - t) * Math.sqrt(size) > EPS &&
          length(
            sub(
              delta,
              edge.map((v) => v * t),
            ),
          ) < EPS
        )
          cuts.push([t, id]);
      }
      cuts.sort((a, b) => a[0] - b[0]);
      return [a, ...cuts.map(([, id]) => id)];
    });
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i],
        b = outline[(i + 1) % outline.length],
        key = edgeKey(a, b),
        previous = directed.get(key);
      if (previous) {
        if (previous[0] !== b || previous[1] !== a) return pieces;
        directed.delete(key);
      } else directed.set(key, [a, b]);
    }
  }
  const next = new Map();
  for (const [a, b] of directed.values()) {
    if (next.has(a)) return pieces;
    next.set(a, b);
  }
  const loops = [],
    normal = polygonNormal(pieces[0].map((id) => vertices[id]));
  while (next.size) {
    const first = next.keys().next().value,
      loop = [];
    let id = first;
    do {
      if (!next.has(id)) return pieces;
      loop.push(id);
      const following = next.get(id);
      next.delete(id);
      id = following;
    } while (id !== first);
    // A hole requires a bridge; keep the existing safe convex partition.
    const n = polygonNormal(loop.map((id) => vertices[id]));
    if (!n || dot(n, normal) < 0) return pieces;
    let changed = true;
    while (changed && loop.length > 3) {
      changed = false;
      for (let i = 0; i < loop.length; i++) {
        if (!removable(loop[i])) continue;
        const a = vertices[loop[(i + loop.length - 1) % loop.length]],
          b = vertices[loop[i]],
          c = vertices[loop[(i + 1) % loop.length]],
          edge = sub(c, a),
          delta = sub(b, a),
          t = dot(delta, edge) / dot(edge, edge);
        if (
          t > 0 &&
          t < 1 &&
          length(
            sub(
              delta,
              edge.map((v) => v * t),
            ),
          ) < EPS
        ) {
          loop.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    loops.push(loop);
  }
  const result = [];
  for (const loop of loops) {
    const triangles = triangulatePolygon(vertices, loop);
    if (triangles.length !== loop.length - 2) return pieces;
    let merged = true;
    while (merged) {
      merged = false;
      search: for (let a = 0; a < triangles.length; a++)
        for (let b = 0; b < a; b++) {
          const first = triangles[a],
            second = triangles[b];
          for (let i = 0; i < first.length; i++) {
            const j = second.findIndex(
              (id, k) =>
                id === first[(i + 1) % first.length] &&
                second[(k + 1) % second.length] === first[i],
            );
            if (j < 0) continue;
            const left = [...first.slice(i + 1), ...first.slice(0, i + 1)],
              right = [...second.slice(j + 1), ...second.slice(0, j + 1)],
              combined = [...left, ...right.slice(1, -1)];
            if (
              new Set(combined).size !== combined.length ||
              !combined.every(
                (id, k) =>
                  dot(
                    cross(
                      sub(
                        vertices[combined[(k + 1) % combined.length]],
                        vertices[id],
                      ),
                      sub(
                        vertices[combined[(k + 2) % combined.length]],
                        vertices[combined[(k + 1) % combined.length]],
                      ),
                    ),
                    normal,
                  ) >=
                  -EPS * EPS,
              )
            )
              continue;
            triangles[b] = combined;
            triangles.splice(a, 1);
            merged = true;
            break search;
          }
        }
    }
    result.push(...triangles);
  }
  return result;
}

/** Cancel only opposite walls connected to a cap edge; this is not a solid union. */
export function joinExtrusion(source, result, selected) {
  const cap = source.faces[selected],
    sideStart = source.faces.length,
    normals = source.faces.map((face) =>
      polygonNormal(face.map((id) => source.vertices[id])),
    ),
    edges = new Map();
  source.faces.forEach((face, index) =>
    face.forEach((a, i) => {
      const key = edgeKey(a, face[(i + 1) % face.length]);
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push(index);
    }),
  );
  const components = cap.map((a, side) => {
    const b = cap[(side + 1) % cap.length],
      polygon = result.faces[sideStart + side],
      points = polygon.map((id) => result.vertices[id]),
      n = polygonNormal(points),
      eligible = (face) =>
        n &&
        normals[face] &&
        dot(normals[face], n) < -1 + EPS &&
        source.faces[face].every(
          (id) => Math.abs(dot(sub(source.vertices[id], points[0]), n)) < EPS,
        ),
      found = new Set(),
      pending = (edges.get(edgeKey(a, b)) || []).filter(eligible);
    while (pending.length) {
      const face = pending.pop();
      if (found.has(face)) continue;
      found.add(face);
      source.faces[face].forEach((u, i) => {
        for (const neighbor of edges.get(
          edgeKey(u, source.faces[face][(i + 1) % source.faces[face].length]),
        ) || [])
          if (!found.has(neighbor) && eligible(neighbor))
            pending.push(neighbor);
      });
    }
    // A connected coplanar component can continue around the corner into a
    // wall that only grazes this extrusion. Such a wall must not contribute
    // weld targets, even though traversal through it is allowed.
    return new Set(
      [...found].filter((face) =>
        overlapsArea(
          points,
          source.faces[face].map((id) => source.vertices[id]),
          normals[face],
        ),
      ),
    );
  });
  if (components.every((component) => !component.size)) return result;

  const candidates = new Set(cap),
    aliases = new Map(),
    parts = result.faces.map((face) => [face]),
    capEnd = result.faces[selected].map((id) => [...result.vertices[id]]),
    sweepNormal = polygonNormal(cap.map((id) => source.vertices[id])),
    sweepStart = dot(source.vertices[cap[0]], sweepNormal),
    sweepEnd = dot(capEnd[0], sweepNormal);
  for (const component of components)
    for (const face of component)
      for (const id of source.faces[face]) candidates.add(id);
  const inSweep = (point) => {
    const level = dot(point, sweepNormal);
    return (
      level >= sweepStart - EPS &&
      level <= sweepEnd + EPS &&
      cap.every((id, i) => {
        const origin = source.vertices[id],
          edge = sub(source.vertices[cap[(i + 1) % cap.length]], origin);
        return (
          dot(cross(edge, sub(point, origin)), sweepNormal) >=
          -EPS * length(edge)
        );
      })
    );
  };
  // Distinct diagonal sheets stay separate until an actual wall fill connects
  // their corner. At equal roof heights, that fill must also join both existing
  // endpoint IDs, rather than choosing only one for the new cap.
  const representatives = [];
  for (const id of candidates) {
    if (!inSweep(result.vertices[id])) continue;
    const match = representatives.find(
      (other) => length(sub(result.vertices[id], result.vertices[other])) < EPS,
    );
    if (match === undefined) representatives.push(id);
    else aliases.set(id, match);
  }
  const resolve = (id) => aliases.get(id) ?? id;
  function vertex(point, drivers) {
    for (const id of candidates)
      if (length(sub(result.vertices[id], point)) < EPS) return resolve(id);
    const id = result.vertices.length;
    result.vertices.push(point);
    result.vertexDrivers.push(drivers);
    candidates.add(id);
    return id;
  }
  for (const id of result.faces[selected]) {
    const match = [...candidates].find(
      (candidate) =>
        length(sub(result.vertices[candidate], result.vertices[id])) < EPS,
    );
    if (match === undefined) candidates.add(id);
    else aliases.set(id, resolve(match));
  }
  const clean = (ids) =>
    ids.filter((id, i) => id !== ids[(i + ids.length - 1) % ids.length]);
  const area = (ids) => {
    if (ids.length < 3) return 0;
    const origin = result.vertices[ids[0]],
      n = [0, 0, 0];
    for (let i = 1; i < ids.length - 1; i++) {
      const c = cross(
        sub(result.vertices[ids[i]], origin),
        sub(result.vertices[ids[i + 1]], origin),
      );
      for (let k = 0; k < 3; k++) n[k] += c[k];
    }
    return length(n);
  };
  function split(ids, origin, direction) {
    const inside = [],
      outside = [];
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i],
        b = ids[(i + 1) % ids.length],
        pa = result.vertices[a],
        pb = result.vertices[b],
        da = dot(sub(pa, origin), direction),
        db = dot(sub(pb, origin), direction);
      if (da >= -EPS) inside.push(a);
      if (da <= EPS) outside.push(a);
      if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
        const t = da / (da - db),
          id = vertex(
            pa.map((v, k) => v + (pb[k] - v) * t),
            [
              [a, 1 - t],
              [b, t],
            ],
          );
        inside.push(id);
        outside.push(id);
      }
    }
    return [clean(inside), clean(outside)];
  }
  function difference(subject, clip) {
    const n = polygonNormal(clip.map((id) => result.vertices[id])),
      outside = [];
    let inside = subject;
    for (let i = 0; i < clip.length && inside.length >= 3; i++) {
      const a = result.vertices[clip[i]],
        b = result.vertices[clip[(i + 1) % clip.length]],
        raw = cross(n, sub(b, a)),
        size = length(raw),
        direction = raw.map((v) => v / size),
        [next, piece] = split(inside, a, direction);
      if (area(piece) > EPS * EPS) outside.push(piece);
      inside = next;
    }
    return area(inside) > EPS * EPS ? outside : [subject];
  }
  let joined = false;
  components.forEach((component, side) => {
    const sideIndex = sideStart + side,
      sideFace = result.faces[sideIndex];
    for (const face of component) {
      const remaining = parts[sideIndex].flatMap((piece) =>
        difference(piece, source.faces[face]),
      );
      if (
        remaining.length === parts[sideIndex].length &&
        remaining.every((piece, i) => piece === parts[sideIndex][i])
      )
        continue;
      joined = true;
      parts[sideIndex] = remaining;
      parts[face] = parts[face].flatMap((piece) => difference(piece, sideFace));
    }
  });
  if (!joined) return result;

  parts.forEach((pieces, origin) => {
    parts[origin] = repartition(
      pieces.map((face) => clean(face.map(resolve))),
      result.vertices,
      (id) =>
        id >= source.vertices.length + cap.length &&
        !inSweep(result.vertices[id]),
    );
  });
  const used = new Set(parts.flat(2));
  for (const id of candidates)
    if (!used.has(resolve(id))) candidates.delete(id);

  const joinedWalls = [
      ...new Set(components.flatMap((component) => [...component])),
    ],
    wallContact = new Map();
  function onJoinedWall(id) {
    if (!wallContact.has(id)) {
      const point = result.vertices[id];
      wallContact.set(
        id,
        joinedWalls.some((index) => {
          const face = source.faces[index],
            n = normals[index],
            origin = source.vertices[face[0]];
          return (
            Math.abs(dot(sub(point, origin), n)) < EPS &&
            face.every((a, i) => {
              const p = source.vertices[a],
                edge = sub(source.vertices[face[(i + 1) % face.length]], p);
              return dot(cross(edge, sub(point, p)), n) >= -EPS * length(edge);
            })
          );
        }),
      );
    }
    return wallContact.get(id);
  }
  const splitBoundary = (face, origin) =>
    face.flatMap((raw, i) => {
      const a = resolve(raw),
        b = resolve(face[(i + 1) % face.length]),
        pa = result.vertices[a],
        edge = sub(result.vertices[b], pa),
        size = dot(edge, edge),
        cuts = [];
      for (const candidate of candidates) {
        const id = resolve(candidate);
        if (id === a || id === b) continue;
        // Conform existing sheets only where an old wall is actually joined.
        // A new cap corner above those walls can lie on a taller diagonal
        // sheet's edge; splitting that untouched edge would weld four faces.
        if (origin < sideStart && origin !== selected && !onJoinedWall(id))
          continue;
        if (id < source.vertices.length) {
          const level = dot(result.vertices[id], sweepNormal);
          // Existing corner sheets can touch above this fill. Propagating a
          // taller wall's corner there would weld two untouched edges into
          // one nonmanifold edge with four incident faces.
          if (level < sweepStart - EPS || level > sweepEnd + EPS) continue;
        }
        const delta = sub(result.vertices[id], pa),
          t = dot(delta, edge) / size;
        if (t * Math.sqrt(size) <= EPS || (1 - t) * Math.sqrt(size) <= EPS)
          continue;
        if (
          length(
            sub(
              delta,
              edge.map((v) => v * t),
            ),
          ) < EPS
        )
          cuts.push([t, id]);
      }
      cuts.sort((x, y) => x[0] - y[0]);
      return [a, ...new Set(cuts.map(([, id]) => id))];
    });
  const entries = parts.flatMap((pieces, origin) =>
      pieces.map((face) => ({
        origin,
        face: clean(splitBoundary(face, origin)),
      })),
    ),
    selectedEntry = entries.find((entry) => entry.origin === selected),
    slot = Math.min(selected, entries.length - 1);
  // Fill vacated slots with new/split polygons before compacting. Keep the cap's
  // index whenever possible so the ongoing pointer gesture retains selection.
  const ordered = new Array(entries.length),
    pending = [];
  ordered[slot] = selectedEntry;
  for (const entry of entries) {
    if (entry === selectedEntry) continue;
    if (entry.origin < ordered.length && !ordered[entry.origin])
      ordered[entry.origin] = entry;
    else pending.push(entry);
  }
  for (let i = 0; i < ordered.length; i++)
    if (!ordered[i]) ordered[i] = pending.shift();
  result.faces = ordered.map((entry) => entry.face);
  if (result.faces.length > 16000)
    throw Error("This edit would exceed the 16,000 face limit.");
  if ([...edges.values()].every((faces) => faces.length === 2)) {
    const joinedEdges = new Map();
    for (const face of result.faces)
      for (let i = 0; i < face.length; i++) {
        const a = face[i],
          b = face[(i + 1) % face.length],
          key = edgeKey(a, b),
          edge = joinedEdges.get(key) || { count: 0, winding: 0 };
        edge.count++;
        edge.winding += a < b ? 1 : -1;
        joinedEdges.set(key, edge);
      }
    if (
      [...joinedEdges.values()].some(
        (edge) => edge.count !== 2 || edge.winding !== 0,
      )
    )
      throw Error(
        "The connected walls cannot be joined without opening the mesh.",
      );
  }
  const unchanged = new Set();
  for (const { origin, face } of ordered) {
    const old = source.faces[origin];
    if (
      old &&
      old.length === face.length &&
      old.every((id, i) => id === face[i])
    )
      unchanged.add(origin);
  }
  edits.set(result, {
    selected: slot,
    unchanged,
    capEnd,
    origins: ordered.map((entry) => entry.origin),
  });
  return result;
}
