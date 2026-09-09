/** Record which original corners generated each new corner. Sources always precede copies. */
export function recordVertexDrivers(mesh, face, start, inset = 0) {
  mesh.vertexDrivers ||= Array.from({ length: start }, () => null);
  for (const corner of face) {
    mesh.vertexDrivers.push(
      inset === 0
        ? [[corner, 1]]
        : face.map((id) => [
            id,
            (id === corner ? 1 - inset : 0) + inset / face.length,
          ]),
    );
  }
}

/** A moved corner also moves the corners subsequently extruded or inset from it. */
export function faceMovementWeights(mesh, faceIndex) {
  const selected = new Set(mesh.faces[faceIndex]);
  const weights = new Float64Array(mesh.vertices.length);
  for (let id = 0; id < weights.length; id++) {
    if (selected.has(id)) weights[id] = 1;
    else
      for (const [source, weight] of mesh.vertexDrivers?.[id] || []) {
        if (source >= id)
          throw new Error("Invalid extrusion dependency. Undo the last edit.");
        weights[id] += weights[source] * weight;
      }
  }
  return weights;
}
