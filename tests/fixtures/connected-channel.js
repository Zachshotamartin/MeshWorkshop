import { cube, extrude } from "../../src/mesh.js";

// The screenshot's lower middle cap directly touches the raised neighbors.
// Its extrusion is free in +Y, but naive side quads duplicate those walls.
export function connectedChannel({ left = true, wallSegments = 1 } = {}) {
  let mesh = cube();
  mesh = extrude(mesh, 2, 0.65);
  mesh = extrude(mesh, 2, 0.4);
  for (let i = 0; i < wallSegments; i++) mesh = extrude(mesh, 5, 0.85 / wallSegments);
  if (left) mesh = extrude(mesh, 12, 0.5);
  return { mesh, face: 8, capArea: 1.3 };
}

export function diagonalCorner() {
  let mesh = cube();
  for (const [face, depth] of [[3, 2], [1, 2], [8, 2]]) mesh = extrude(mesh, face, depth);
  const raised = mesh.faces.findIndex(face => face.every(id => {
    const [x, y, z] = mesh.vertices[id];
    return y === 1 && x >= 1 && z >= 1;
  }));
  mesh = extrude(mesh, raised, 0.8);
  return { mesh, face: 5, capArea: 4 };
}

// Filling either remaining low quadrant joins two perpendicular walls that
// previously touched each other only along their vertical corner edge.
export function perpendicularCorner(face = 7) {
  const { mesh } = diagonalCorner();
  return { mesh: extrude(mesh, 5, 0.5), face, capArea: 4 };
}

export function lastCorner() {
  const { mesh } = perpendicularCorner();
  return { mesh: extrude(mesh, 7, 1.1), face: 12, capArea: 4 };
}

export function signedVolume(mesh) {
  let volume = 0;
  for (const face of mesh.faces) {
    const a = mesh.vertices[face[0]];
    for (let i = 1; i + 1 < face.length; i++) {
      const b = mesh.vertices[face[i]], c = mesh.vertices[face[i + 1]];
      volume += (
        a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])
      ) / 6;
    }
  }
  return volume;
}
