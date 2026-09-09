import { cloneMesh, extrude, faceNormal } from "./mesh.js";

const EPSILON = 1e-8;
export const MAX_EXTRUSION = 3;
export const MIN_EXTRUSION = 0.002;

/**
 * Build an exact one-dimensional perspective projection for the face normal.
 * clipNormal is a transformed direction (w=0 before the view-projection matrix),
 * not a second projected point. The fallback is only for an end-on normal,
 * whose projection cannot define a useful on-screen axis.
 */
export function makeDragAxis({
  clipOrigin,
  clipNormal,
  width,
  height,
  fallbackUnitsPerPixel,
}) {
  if (
    ![...clipOrigin, ...clipNormal, width, height, fallbackUnitsPerPixel].every(
      Number.isFinite,
    ) ||
    width <= 0 ||
    height <= 0 ||
    fallbackUnitsPerPixel <= 0 ||
    clipOrigin[3] <= EPSILON
  ) {
    throw new Error(
      "The face cannot be dragged from this camera position. Reset the view.",
    );
  }
  const [x, y, , w] = clipOrigin,
    [nx, ny, , nw] = clipNormal;
  const vx = (((nx * w - x * nw) / (w * w)) * width) / 2;
  const vy = (-((ny * w - y * nw) / (w * w)) * height) / 2;
  const rate = Math.hypot(vx, vy);
  const fallback = rate < Math.max(8, 0.15 / fallbackUnitsPerPixel);
  return fallback
    ? {
        direction: [0, -1],
        pixelsPerUnit: 1 / fallbackUnitsPerPixel,
        perspective: 0,
        fallback: true,
      }
    : {
        direction: [vx / rate, vy / rate],
        pixelsPerUnit: rate,
        perspective: nw / w,
        fallback: false,
      };
}

/** Invert projected motion along the normal, with per-face inward and outward bounds. */
export function dragDistance(
  axis,
  start,
  current,
  { snap = false, maxDistance = MAX_EXTRUSION, minDistance = 0 } = {},
) {
  const displacement =
    (current[0] - start[0]) * axis.direction[0] +
    (current[1] - start[1]) * axis.direction[1];
  if (!Number.isFinite(displacement)) return 0;
  const denominator = axis.pixelsPerUnit - axis.perspective * displacement;
  let distance =
    denominator <= EPSILON ? maxDistance : displacement / denominator;
  distance = Math.max(
    minDistance,
    Math.min(MAX_EXTRUSION, maxDistance, distance),
  );
  if (snap) distance = Math.round(distance * 10) / 10;
  return Math.max(minDistance, Math.min(maxDistance, distance));
}

/** Stop a pushed face just before its nearest connected supporting layer. */
export function inwardLimit(mesh, face) {
  const ids = mesh.faces[face],
    selected = new Set(ids),
    normal = faceNormal(mesh, ids),
    depths = [];
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  for (const polygon of mesh.faces)
    for (let edge = 0; edge < polygon.length; edge++) {
      const a = polygon[edge],
        b = polygon[(edge + 1) % polygon.length];
      if (selected.has(a) === selected.has(b)) continue;
      const inside = mesh.vertices[selected.has(a) ? a : b],
        outside = mesh.vertices[selected.has(a) ? b : a];
      const depth = dot(
        inside.map((v, i) => v - outside[i]),
        normal,
      );
      if (depth > 1e-6) depths.push(depth);
    }
  if (!depths.length) {
    const level =
      ids.reduce((sum, id) => sum + dot(mesh.vertices[id], normal), 0) /
      ids.length;
    mesh.vertices.forEach((vertex, id) => {
      const depth = level - dot(vertex, normal);
      if (!selected.has(id) && depth > 1e-6) depths.push(depth);
    });
  }
  if (!depths.length) return 0;
  const depth = Math.min(...depths),
    clearance = Math.max(0.0001, depth * 0.001);
  return -Math.max(0, Math.min(MAX_EXTRUSION, depth - clearance));
}

/** Inward edits move existing vertices rather than stacking inverted side walls. */
export function previewExtrusion(source, face, distance) {
  if (
    !Number.isFinite(distance) ||
    distance > MAX_EXTRUSION ||
    distance < inwardLimit(source, face) - 1e-8
  )
    throw new Error("The face cannot cross its supporting surface.");
  if (Math.abs(distance) < MIN_EXTRUSION) return cloneMesh(source);
  if (distance > 0) return extrude(source, face, distance);
  const result = cloneMesh(source),
    normal = faceNormal(source, source.faces[face]);
  for (const id of result.faces[face])
    result.vertices[id] = result.vertices[id].map(
      (v, i) => v + normal[i] * distance,
    );
  return result;
}

/** The perpendicular gesture adjusts cap width without changing normal depth. */
export function bevelWidth(
  axis,
  start,
  current,
  initialFraction,
  viewportSize,
) {
  let tangent = [-axis.direction[1], axis.direction[0]];
  if (tangent[0] < -1e-8 || (Math.abs(tangent[0]) < 1e-8 && tangent[1] > 0))
    tangent = tangent.map((v) => -v);
  const pixels =
    (current[0] - start[0]) * tangent[0] + (current[1] - start[1]) * tangent[1];
  return {
    fraction: Math.max(
      0.02,
      Math.min(
        0.78,
        initialFraction + pixels / Math.max(120, viewportSize * 0.65),
      ),
    ),
    tangent,
  };
}
