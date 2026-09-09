import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

// Screen-sized handles remain legible when the model is zoomed out. Depth
// testing keeps hidden corners and edges behind the actual surface.
export function createFeatureHandles({ THREE: T, root, invalidate }) {
  const group = new T.Group();
  group.name = "mesh-feature-handles";
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = textureCanvas.height = 64;
  const context = textureCanvas.getContext("2d");
  const shading = context.createRadialGradient(23, 19, 2, 32, 32, 29);
  shading.addColorStop(0, "#ffffff");
  shading.addColorStop(0.28, "#eeeeee");
  shading.addColorStop(0.75, "#a0a0a0");
  shading.addColorStop(1, "#343434");
  context.fillStyle = shading;
  context.beginPath();
  context.arc(32, 32, 29, 0, Math.PI * 2);
  context.fill();
  const texture = new T.CanvasTexture(textureCanvas);
  texture.colorSpace = T.SRGBColorSpace;
  const styles = {
    available: { color: 0xb3d7bd, width: 3, size: 18 },
    hovered: { color: 0xfff0c2, width: 6, size: 24 },
    selected: { color: 0xffbc67, width: 6, size: 24 },
  };
  const materials = Object.fromEntries(
    Object.entries(styles).map(([state, { color, width, size }]) => {
      const edge = new LineMaterial({
        color, linewidth: width, depthTest: true, depthWrite: false, transparent: true,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
        toneMapped: false,
      });
      const vertex = new T.PointsMaterial({
        color, size, sizeAttenuation: false, map: texture, alphaTest: 0.3,
        depthTest: true, depthWrite: false, toneMapped: false, transparent: true,
      });
      vertex.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
          "#include <project_vertex>",
          "#include <project_vertex>\ngl_Position.z -= 0.00005 * gl_Position.w;",
        );
      };
      return [state, { edge, vertex }];
    }),
  );
  function clear() {
    root.remove(group);
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry.dispose();
    }
  }
  function add(mesh, mode, items, state) {
    if (!items.length) return;
    const positions = items.flatMap((item) =>
      mode === "edge" ? item.flatMap((id) => mesh.vertices[id]) : mesh.vertices[item],
    );
    const geometry = mode === "edge"
      ? new LineSegmentsGeometry().setPositions(positions)
      : new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    const marker = mode === "edge"
      ? new LineSegments2(geometry, materials[state].edge)
      : new T.Points(geometry, materials[state].vertex);
    marker.name = `${mode}-${state}`;
    marker.renderOrder = { available: 3, hovered: 4, selected: 5 }[state];
    group.add(marker);
  }
  return {
    show(mesh, mode, items, selection, hovered, previewCap) {
      clear();
      if (mode === "face") { invalidate(); return; }
      add(mesh, mode, items, "available");
      if (previewCap) {
        // Follow the new cut instead of leaving a handle at a removed corner.
        add(mesh, "edge", previewCap.map((id, i) => [id, previewCap[(i + 1) % previewCap.length]]), "selected");
      } else {
        if (hovered !== null) add(mesh, mode, [hovered], "hovered");
        if (selection !== null) add(mesh, mode, [selection], "selected");
      }
      root.add(group);
      invalidate();
    },
    clear,
    dispose() {
      clear();
      for (const pair of Object.values(materials)) {
        pair.edge.dispose();
        pair.vertex.dispose();
      }
      texture.dispose();
    },
  };
}
