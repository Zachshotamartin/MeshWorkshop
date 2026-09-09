import {
  bevelFace,
  splitFace,
  cube,
  extrude,
  inset,
  subdivide,
  faceNormal,
  preset,
  topology,
  toOBJ,
  cloneMesh,
} from "./mesh.js";
export const metadata = {
  id: "mesh-workshop",
  title: "Mesh Workshop",
  description:
    "Shape a polygon mesh by editing its faces. Extrude a room, bevel a shoulder, split a face, then soften the whole form with Catmull–Clark subdivision.",
  technique: "Polygon topology editing and Catmull–Clark subdivision",
  instructions: [
    "Click a face or use Previous/Next face.",
    "Extrude moves a new cap along its normal; inset builds a real ring of faces.",
    "Beveled extrusion uses the inset fraction and extrusion distance to form sloped shoulders. A face split adds a diagonal without new edge vertices.",
    "Undo an edit, compare the wireframe, and export the edited topology as OBJ.",
  ],
  limitations: [
    "Face insets move vertices toward their centroid; they are not constant-distance CAD offsets.",
    "The editor does not detect self-intersection from repeated extreme extrusions.",
    "Subdivision is bounded to 16,000 output faces and manifold edges.",
  ],
};
export function createExperiment(ctx) {
  const { THREE, root, ui } = ctx;
  let mesh = preset("Terraced tower"),
    selected = 5,
    distance = 0.55,
    fraction = 0.22,
    wire = true,
    history = [],
    object,
    edges,
    normal;
  let triangles = [];
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.48,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const wireMaterial = new THREE.LineBasicMaterial({
    color: 0x253f36,
    transparent: true,
    opacity: 0.65,
  });
  const normalMaterial = new THREE.LineBasicMaterial({ color: 0xffd497 });
  const info = ui.note("");
  function disposeObject(o) {
    if (o) {
      root.remove(o);
      o.geometry.dispose();
    }
  }
  function rebuild() {
    disposeObject(object);
    disposeObject(edges);
    disposeObject(normal);
    const positions = [],
      colors = [];
    triangles = [];
    mesh.faces.forEach((f, fi) => {
      const c = new THREE.Color(fi === selected ? 0xe8b280 : 0xacc6a2);
      for (let i = 1; i < f.length - 1; i++) {
        for (const id of [f[0], f[i], f[i + 1]]) {
          positions.push(...mesh.vertices[id]);
          colors.push(c.r, c.g, c.b);
        }
        triangles.push(fi);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    object = new THREE.Mesh(geometry, material);
    object.castShadow = true;
    object.receiveShadow = true;
    root.add(object);
    const lines = [];
    for (const f of mesh.faces)
      for (let i = 0; i < f.length; i++)
        lines.push(
          ...mesh.vertices[f[i]],
          ...mesh.vertices[f[(i + 1) % f.length]],
        );
    edges = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(lines, 3),
      ),
      wireMaterial,
    );
    edges.visible = wire;
    root.add(edges);
    const f = mesh.faces[selected],
      c = f.reduce(
        (a, i) => a.map((v, k) => v + mesh.vertices[i][k] / f.length),
        [0, 0, 0],
      ),
      n = faceNormal(mesh, f);
    normal = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...c),
        new THREE.Vector3(...c.map((v, k) => v + n[k] * 0.5)),
      ]),
      normalMaterial,
    );
    root.add(normal);
    const t = topology(mesh);
    info.textContent = `Face ${selected + 1} of ${t.faces} · ${t.vertices} vertices · ${t.edges} edges · ${t.boundary} boundary edges`;
    ctx.invalidate();
  }
  function edit(fn, label) {
    try {
      const next = fn(mesh);
      history.push({ mesh: cloneMesh(mesh), selected });
      if (history.length > 24) history.shift();
      mesh = next;
      selected = Math.min(selected, mesh.faces.length - 1);
      rebuild();
      ctx.setStatus(
        `${label}. ${mesh.faces.length} polygon faces; ${history.length} edits can be undone.`,
      );
    } catch (error) {
      ctx.setStatus(error.message);
    }
  }
  ui.select(
    "Starting form",
    ["Cube", "Terraced tower", "Studio wing", "Rounded vessel"],
    "Terraced tower",
    (name) => {
      mesh = preset(name);
      selected = Math.min(5, mesh.faces.length - 1);
      history = [];
      rebuild();
      ctx.fit();
      ctx.setStatus(`${name} loaded. Pick a face to shape it.`);
    },
  );
  ui.section("Selected face");
  ui.button("Previous face", () => {
    selected = (selected + mesh.faces.length - 1) % mesh.faces.length;
    rebuild();
  });
  ui.button("Next face", () => {
    selected = (selected + 1) % mesh.faces.length;
    rebuild();
  });
  ui.range("Extrusion distance", {
    min: 0.1,
    max: 1.5,
    step: 0.05,
    value: distance,
    onChange: (v) => (distance = v),
  });
  ui.button(
    "Extrude face",
    () => edit((m) => extrude(m, selected, distance), "Face extruded"),
    { primary: true },
  );
  ui.range("Inset fraction", {
    min: 0.05,
    max: 0.6,
    step: 0.05,
    value: fraction,
    onChange: (v) => (fraction = v),
  });
  ui.button("Inset face", () =>
    edit((m) => inset(m, selected, fraction), "Face inset"),
  );
  ui.button("Beveled extrusion", () =>
    edit(
      (m) => bevelFace(m, selected, fraction, distance),
      "Raised cap with sloped shoulders created",
    ),
  );
  ui.button("Split face diagonally", () =>
    edit(
      (m) => splitFace(m, selected),
      "Face divided through existing vertices",
    ),
  );
  ui.section("Whole mesh");
  ui.button("Subdivide once", () =>
    edit((m) => subdivide(m), "Catmull–Clark subdivision applied"),
  );
  ui.toggle("Show polygon edges", wire, (v) => {
    wire = v;
    if (edges) edges.visible = v;
    ctx.invalidate();
  });
  ui.button("Undo edit", () => {
    const state = history.pop();
    if (!state) {
      ctx.setStatus("No edits to undo.");
      return;
    }
    mesh = state.mesh;
    selected = state.selected;
    rebuild();
    ctx.setStatus("Previous mesh restored.");
  });
  ui.button("Reset to cube", () => {
    mesh = cube();
    selected = 5;
    history = [];
    rebuild();
    ctx.fit();
  });
  ui.button("Export OBJ", () => ctx.download("mesh-workshop.obj", toOBJ(mesh)));
  let down = null;
  ctx.listen(ctx.canvas, "pointerdown", (e) => {
    down = [e.clientX, e.clientY];
  });
  ctx.listen(ctx.canvas, "click", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5)
      return;
    const hit = ctx.pick(e, [object])[0];
    if (hit) {
      selected = triangles[hit.faceIndex];
      rebuild();
      ctx.setStatus(
        `Face ${selected + 1} selected. Its outward direction is shown in gold.`,
      );
    }
  });
  rebuild();
  ctx.fit();
  ctx.setStatus(
    "Select a face to begin. Every edit changes the actual polygon topology.",
  );
  return {
    dispose() {
      material.dispose();
      wireMaterial.dispose();
      normalMaterial.dispose();
    },
  };
}
