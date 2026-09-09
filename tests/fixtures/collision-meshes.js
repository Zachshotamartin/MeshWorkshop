import { cube } from "../../src/mesh.js";

export function parallelBlock(gap) {
  const source = cube(),
    other = cube(),
    offset = source.vertices.length;
  source.vertices.push(...other.vertices.map(([x, y, z]) => [
    x + 2 + gap,
    1.001 + y * 0.0005,
    z,
  ]));
  source.faces.push(...other.faces.map((face) => face.map((id) => id + offset)));
  // Rotating both solids preserves their gap but makes their AABBs overlap.
  source.vertices = source.vertices.map(([x, y, z]) => [
    (x - y) * Math.SQRT1_2,
    (x + y) * Math.SQRT1_2,
    z,
  ]);
  return source;
}

export function overheadBlock() {
  const source = cube(),
    other = cube(),
    offset = source.vertices.length;
  source.vertices.push(...other.vertices.map(([x, y, z]) => [
    x * 0.3,
    1.7 + y * 0.3,
    z * 0.3,
  ]));
  source.faces.push(...other.faces.map((face) => face.map((id) => id + offset)));
  return source;
}
