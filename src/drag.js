import { cloneMesh, extrude } from "./mesh.js";

const EPSILON = 1e-8;
export const MAX_EXTRUSION = 3;
export const MIN_EXTRUSION = 0.02;

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

/** Invert projected motion along the normal, with outward-only bounds. */
export function dragDistance(
  axis,
  start,
  current,
  { snap = false, maxDistance = MAX_EXTRUSION } = {},
) {
  const displacement =
    (current[0] - start[0]) * axis.direction[0] +
    (current[1] - start[1]) * axis.direction[1];
  if (!Number.isFinite(displacement) || displacement <= 0) return 0;
  const denominator = axis.pixelsPerUnit - axis.perspective * displacement;
  let distance =
    denominator <= EPSILON ? maxDistance : displacement / denominator;
  distance = Math.max(0, Math.min(MAX_EXTRUSION, maxDistance, distance));
  if (snap) distance = Math.round(distance * 10) / 10;
  return distance;
}

/** A preview is always rebuilt from the pre-drag mesh, never the prior preview. */
export function previewExtrusion(source, face, distance) {
  if (!Number.isFinite(distance) || distance < 0 || distance > MAX_EXTRUSION)
    throw new Error("Pull the face outward by at most 3 model units.");
  return distance < MIN_EXTRUSION
    ? cloneMesh(source)
    : extrude(source, face, distance);
}
