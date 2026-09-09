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
import {
  makeDragAxis,
  dragDistance,
  previewExtrusion,
  MIN_EXTRUSION,
} from "./drag.js";

export const metadata = {
  id: "mesh-workshop",
  title: "Mesh Workshop",
  description:
    "Grab a face and pull it into a new shape. Drag out rooms and terraces, bevel their shoulders, then cut or subdivide the actual polygon mesh.",
  technique:
    "Direct face manipulation, polygon topology editing and Catmull–Clark subdivision",
  instructions: [
    "Drag a visible face outward along its gold normal to extrude it. A click only selects the face.",
    "Hold Shift to snap the pull to 0.1 units. Escape cancels; releasing commits one undo step.",
    "Drag the background or right-drag anywhere to orbit. For a face looking straight at the camera, drag upward to pull it toward you.",
    "Choose Extrude or Bevel for the drag operation. Inset, diagonal cuts, subdivision and OBJ export work on the resulting topology.",
    "Keyboard: choose Previous/Next face, adjust Keyboard pull distance, then press Enter on that slider or the viewport.",
  ],
  limitations: [
    "Pulls are outward-only and bounded to 3 model units. Returning to the start removes the preview; inward motion does not build inverted side faces.",
    "Face bevels and insets move vertices toward their centroid, not a constant-distance CAD offset. Extreme edits can intersect other parts of an already complex mesh.",
    "Editing and subdivision are bounded to 16,000 faces. Background and right-drag keep camera control separate from face editing.",
  ],
};

export function createExperiment(ctx) {
  const { THREE, root, ui } = ctx;
  let mesh = cube(),
    selected = 5,
    hovered = -1,
    keyboardDistance = 0.55,
    fraction = 0.22,
    operation = "extrude",
    wire = true;
  let history = [],
    object,
    edges,
    normal,
    triangles = [],
    drag = null;
  const oldRight = ctx.controls.mouseButtons.RIGHT;
  ctx.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  const oldAriaLabel = ctx.canvas.getAttribute("aria-label");
  ctx.canvas.setAttribute(
    "aria-label",
    "Mesh editor. Drag a face to extrude. Drag the background or right-drag to orbit. Enter pulls the selected face; Escape cancels a drag.",
  );
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.48,
    metalness: 0.08,
    side: THREE.FrontSide,
  });
  const wireMaterial = new THREE.LineBasicMaterial({
    color: 0x253f36,
    transparent: true,
    opacity: 0.7,
  });
  const normalMaterial = new THREE.LineBasicMaterial({ color: 0xffd497 });
  const info = ui.note("");
  const hint = ui.note(
    "Drag the highlighted top face upward to begin. Drag empty space or right-drag to orbit.",
  );
  const feedback = document.createElement("div");
  feedback.className = "mesh-drag-feedback";
  feedback.setAttribute("aria-hidden", "true");
  feedback.style.cssText =
    "position:absolute;pointer-events:none;display:none;padding:7px 10px;border:1px solid #e8b280;background:#20382eee;color:#fff1d9;border-radius:5px;font:500 13px/1.3 system-ui;white-space:nowrap;z-index:2";
  ctx.canvas.parentElement.append(feedback);
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  arrow.setAttribute("viewBox", "0 0 48 48");
  arrow.setAttribute("aria-hidden", "true");
  arrow.style.cssText =
    "position:absolute;pointer-events:none;display:none;width:48px;height:48px;overflow:visible;z-index:2";
  const arrowPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  arrowPath.setAttribute("d", "M24 42V6M16 14L24 6L32 14");
  arrowPath.setAttribute("fill", "none");
  arrowPath.setAttribute("stroke", "#ffd497");
  arrowPath.setAttribute("stroke-width", "2.5");
  arrow.append(arrowPath);
  ctx.canvas.parentElement.append(arrow);

  function disposeObject(o) {
    if (o) {
      root.remove(o);
      o.geometry.dispose();
    }
  }
  function repaint() {
    if (!object) return;
    const colors = object.geometry.getAttribute("color"),
      c = new THREE.Color();
    triangles.forEach((face, triangle) => {
      c.set(
        face === selected
          ? drag?.active
            ? 0xf5c494
            : 0xe8b280
          : face === hovered
            ? 0xd7debd
            : 0xacc6a2,
      );
      for (let j = 0; j < 3; j++)
        colors.setXYZ(triangle * 3 + j, c.r, c.g, c.b);
    });
    colors.needsUpdate = true;
    ctx.invalidate();
  }
  function rebuild() {
    disposeObject(object);
    disposeObject(edges);
    disposeObject(normal);
    const positions = [],
      colors = [];
    triangles = [];
    mesh.faces.forEach((f, fi) => {
      for (let i = 1; i < f.length - 1; i++) {
        for (const id of [f[0], f[i], f[i + 1]]) {
          positions.push(...mesh.vertices[id]);
          colors.push(1, 1, 1);
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
      center = f.reduce(
        (a, i) => a.map((v, k) => v + mesh.vertices[i][k] / f.length),
        [0, 0, 0],
      ),
      n = faceNormal(mesh, f);
    normal = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...center),
        new THREE.Vector3(...center.map((v, k) => v + n[k] * 0.6)),
      ]),
      normalMaterial,
    );
    root.add(normal);
    repaint();
    const stats = topology(mesh);
    info.textContent = `Face ${selected + 1} of ${stats.faces} · ${stats.vertices} vertices · ${stats.edges} edges · ${stats.boundary} boundary edges`;
    ctx.canvas.dataset.selectedFace = String(selected);
    ctx.canvas.dataset.faceCount = String(stats.faces);
    ctx.canvas.dataset.undoCount = String(history.length);
    ctx.invalidate();
  }
  function remember(source, face) {
    history.push({ mesh: cloneMesh(source), selected: face });
    if (history.length > 24) history.shift();
  }
  function apply(fn, label) {
    if (drag) cancelDrag("Pull canceled before another edit.");
    try {
      const next = fn(mesh);
      remember(mesh, selected);
      mesh = next;
      selected = Math.min(selected, mesh.faces.length - 1);
      hovered = -1;
      rebuild();
      ctx.setStatus(
        `${label}. ${mesh.faces.length} polygon faces; ${history.length} edits can be undone.`,
      );
    } catch (error) {
      ctx.setStatus(error.message);
    }
  }
  function preview(source, face, distance) {
    return operation === "bevel" && distance >= MIN_EXTRUSION
      ? bevelFace(source, face, fraction, distance)
      : previewExtrusion(source, face, distance);
  }
  function keyboardPull() {
    apply(
      (m) =>
        operation === "bevel"
          ? bevelFace(m, selected, fraction, keyboardDistance)
          : extrude(m, selected, keyboardDistance),
      "Selected face pulled",
    );
  }
  function selectFace(next) {
    if (drag) cancelDrag();
    selected = next;
    hovered = -1;
    rebuild();
    ctx.setStatus(
      `Face ${selected + 1} selected. Drag it outward or use the keyboard pull distance and Enter.`,
    );
  }
  ui.select(
    "Starting form",
    ["Cube", "Terraced tower", "Studio wing", "Rounded vessel"],
    "Cube",
    (name) => {
      if (drag) cancelDrag();
      mesh = preset(name);
      selected = Math.min(5, mesh.faces.length - 1);
      hovered = -1;
      history = [];
      rebuild();
      ctx.fit();
      ctx.setStatus(`${name} loaded. Drag a face to shape it.`);
    },
  );
  ui.select(
    "Drag operation",
    [
      { label: "Extrude face", value: "extrude" },
      { label: "Bevel face", value: "bevel" },
    ],
    operation,
    (value) => {
      if (drag) cancelDrag();
      operation = value;
      ctx.setStatus(
        value === "bevel"
          ? "Drag a face to raise a smaller cap with sloped shoulders."
          : "Drag a face to extrude it along its normal.",
      );
    },
  );
  ui.section("Selected face");
  ui.button("Previous face", () =>
    selectFace((selected + mesh.faces.length - 1) % mesh.faces.length),
  );
  ui.button("Next face", () => selectFace((selected + 1) % mesh.faces.length));
  const keyboardControl = ui.range("Keyboard pull distance", {
    min: 0.05,
    max: 3,
    step: 0.05,
    value: keyboardDistance,
    onChange: (value) => (keyboardDistance = value),
  });
  ui.note(
    "Keyboard: select a face, adjust this distance, and press Enter. Escape restores an in-progress drag.",
  );
  ctx.listen(keyboardControl, "keydown", (event) => {
    if (event.key === "Enter" && !event.repeat) {
      event.preventDefault();
      keyboardPull();
    }
  });
  ui.range("Inset / bevel fraction", {
    min: 0.05,
    max: 0.6,
    step: 0.05,
    value: fraction,
    onChange: (value) => (fraction = value),
  });
  ui.button("Inset face", () =>
    apply((m) => inset(m, selected, fraction), "Face inset"),
  );
  ui.button("Split face diagonally", () =>
    apply(
      (m) => splitFace(m, selected),
      "Face divided through existing vertices",
    ),
  );
  ui.section("Whole mesh");
  ui.button("Subdivide once", () =>
    apply(subdivide, "Catmull–Clark subdivision applied"),
  );
  ui.toggle("Show polygon edges", wire, (value) => {
    wire = value;
    if (edges) edges.visible = value;
    ctx.invalidate();
  });
  ui.button("Undo edit", () => {
    if (drag) {
      cancelDrag();
      return;
    }
    const state = history.pop();
    if (!state) {
      ctx.setStatus("No edits to undo.");
      return;
    }
    mesh = state.mesh;
    selected = state.selected;
    hovered = -1;
    rebuild();
    ctx.setStatus("Previous mesh restored.");
  });
  ui.button("Reset to cube", () => {
    if (drag) cancelDrag();
    mesh = cube();
    selected = 5;
    hovered = -1;
    history = [];
    rebuild();
    ctx.fit();
    ctx.setStatus("Cube restored. Grab a face and pull it outward.");
  });
  ui.button("Export OBJ", () => ctx.download("mesh-workshop.obj", toOBJ(mesh)));

  function axisAt(point, face) {
    root.updateWorldMatrix(true, true);
    ctx.camera.updateMatrixWorld();
    const normal = new THREE.Vector3(
      ...faceNormal(mesh, mesh.faces[face]),
    ).transformDirection(root.matrixWorld);
    const vp = ctx.camera.projectionMatrix
      .clone()
      .multiply(ctx.camera.matrixWorldInverse);
    const p = new THREE.Vector4(point.x, point.y, point.z, 1).applyMatrix4(vp);
    const n = new THREE.Vector4(normal.x, normal.y, normal.z, 0).applyMatrix4(
      vp,
    );
    const bounds = ctx.canvas.getBoundingClientRect();
    const depth = -point.clone().applyMatrix4(ctx.camera.matrixWorldInverse).z;
    const fallbackUnitsPerPixel =
      (2 * depth * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2))) /
      bounds.height;
    return makeDragAxis({
      clipOrigin: p.toArray(),
      clipNormal: n.toArray(),
      width: bounds.width,
      height: bounds.height,
      fallbackUnitsPerPixel,
    });
  }
  function faceHit(event) {
    // FrontSide triangles plus nearest intersection prevent selecting an occluded
    // back face through the visible cap. Edge/wire objects are never pick targets.
    return ctx.pick(event, [object])[0];
  }
  function feedbackAt(event, axis, text) {
    const bounds = ctx.canvas.getBoundingClientRect(),
      x = event.clientX - bounds.left,
      y = event.clientY - bounds.top;
    feedback.textContent = text;
    feedback.style.display = "block";
    feedback.style.left = `${Math.max(8, Math.min(bounds.width - 155, x + 20))}px`;
    feedback.style.top = `${Math.max(8, Math.min(bounds.height - 36, y + 20))}px`;
    arrow.style.display = "block";
    arrow.style.left = `${x - 24}px`;
    arrow.style.top = `${y - 24}px`;
    arrow.style.transform = `rotate(${(Math.atan2(axis.direction[1], axis.direction[0]) * 180) / Math.PI + 90}deg)`;
  }
  function hideFeedback() {
    feedback.style.display = "none";
    arrow.style.display = "none";
  }
  function finishDrag(commit, message) {
    if (!drag) return;
    const state = drag;
    drag = null;
    const accepted = commit && state.active && state.distance >= MIN_EXTRUSION;
    if (accepted) remember(state.source, state.face);
    else mesh = state.source;
    selected = state.face;
    hovered = -1;
    ctx.controls.enabled = state.controlsEnabled;
    ctx.controls.enableDamping = state.damping;
    ctx.canvas.style.cursor = "grab";
    delete ctx.canvas.dataset.dragging;
    hideFeedback();
    if (ctx.canvas.hasPointerCapture(state.pointerId))
      ctx.canvas.releasePointerCapture(state.pointerId);
    rebuild();
    hint.textContent = accepted
      ? `${state.distance.toFixed(2)} units pulled. Drag the new cap again to continue, or Undo edit to restore the whole pull.`
      : "Drag outward along the gold normal. Background or right-drag orbits.";
    ctx.setStatus(
      message ||
        (accepted
          ? `Face ${selected + 1} pulled ${state.distance.toFixed(2)} units. One undo step saved.`
          : `Face ${selected + 1} selected. No geometry changed.`),
    );
  }
  function cancelDrag(
    message = "Pull canceled. The original geometry is restored.",
  ) {
    finishDrag(false, message);
  }
  ctx.listen(
    ctx.canvas,
    "pointerdown",
    (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey)
        return;
      if (drag) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const hit = faceHit(event);
      if (!hit) {
        hovered = -1;
        repaint();
        hideFeedback();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const controlsEnabled = ctx.controls.enabled,
        damping = ctx.controls.enableDamping;
      ctx.controls.enableDamping = false;
      ctx.controls.update();
      ctx.controls.enabled = false;
      try {
        selected = triangles[hit.faceIndex];
        hovered = selected;
        const axis = axisAt(hit.point, selected);
        drag = {
          pointerId: event.pointerId,
          source: cloneMesh(mesh),
          face: selected,
          start: [event.clientX, event.clientY],
          axis,
          distance: 0,
          active: false,
          threshold: event.pointerType === "touch" ? 8 : 4,
          controlsEnabled,
          damping,
        };
        ctx.canvas.setPointerCapture(event.pointerId);
        ctx.canvas.focus({ preventScroll: true });
        ctx.canvas.style.cursor = "grabbing";
        ctx.canvas.dataset.dragging = "armed";
        rebuild();
        feedbackAt(
          event,
          axis,
          axis.fallback ? "Pull upward · 0.00" : "Pull outward · 0.00",
        );
        ctx.setStatus(
          `Face ${selected + 1} selected. ${axis.fallback ? "Drag upward to pull this camera-facing face." : "Drag along the gold arrow."}`,
        );
      } catch (error) {
        ctx.controls.enabled = controlsEnabled;
        ctx.controls.enableDamping = damping;
        drag = null;
        ctx.setStatus(error.message);
      }
    },
    { capture: true },
  );
  ctx.listen(
    ctx.canvas,
    "pointermove",
    (event) => {
      if (drag && event.pointerId === drag.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const current = [event.clientX, event.clientY];
        if (
          !drag.active &&
          Math.hypot(current[0] - drag.start[0], current[1] - drag.start[1]) <
            drag.threshold
        )
          return;
        const distance = dragDistance(drag.axis, drag.start, current, {
          snap: event.shiftKey,
        });
        try {
          drag.active = true;
          if (Math.abs(distance - drag.distance) > 1e-5) {
            mesh = preview(drag.source, drag.face, distance);
            drag.distance = distance;
            rebuild();
          }
          ctx.canvas.dataset.dragging = "preview";
          feedbackAt(
            event,
            drag.axis,
            `${distance.toFixed(2)} units${event.shiftKey ? " · snap" : ""}`,
          );
          hint.textContent =
            distance < MIN_EXTRUSION
              ? "Pull outward to add geometry. Release here to keep the original face."
              : `${distance.toFixed(2)} units · release to keep · Escape to cancel`;
          ctx.invalidate();
        } catch (error) {
          cancelDrag(error.message);
        }
        return;
      }
      if (event.buttons !== 0) return;
      const hit = faceHit(event),
        next = hit ? triangles[hit.faceIndex] : -1;
      if (next !== hovered) {
        hovered = next;
        repaint();
      }
      ctx.canvas.style.cursor = hit ? "grab" : "default";
      if (!hit) hideFeedback();
    },
    { capture: true },
  );
  ctx.listen(
    ctx.canvas,
    "pointerup",
    (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishDrag(true);
    },
    { capture: true },
  );
  ctx.listen(
    ctx.canvas,
    "pointercancel",
    (event) => {
      if (drag?.pointerId === event.pointerId) cancelDrag();
    },
    { capture: true },
  );
  ctx.listen(ctx.canvas, "lostpointercapture", (event) => {
    if (drag?.pointerId === event.pointerId) cancelDrag();
  });
  ctx.listen(ctx.canvas, "pointerleave", () => {
    if (!drag) {
      hovered = -1;
      repaint();
      hideFeedback();
    }
  });
  ctx.listen(
    window,
    "keydown",
    (event) => {
      if (event.key === "Escape" && drag) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelDrag();
      } else if (
        event.key === "Enter" &&
        !event.repeat &&
        event.target === ctx.canvas &&
        !drag
      ) {
        event.preventDefault();
        keyboardPull();
      }
    },
    { capture: true },
  );
  ctx.listen(window, "blur", () => {
    if (drag) cancelDrag();
  });
  ctx.listen(window, "resize", () => {
    if (drag) cancelDrag("Pull canceled because the viewport changed size.");
  });
  rebuild();
  ctx.fit();
  ctx.setStatus(
    "Grab a face and drag outward to extrude. Click to select; background or right-drag to orbit.",
  );
  return {
    deactivate() {
      if (drag) cancelDrag("Pull canceled because another tool was opened.");
      hovered = -1;
      repaint();
      hideFeedback();
      ctx.canvas.style.cursor = "";
      if (oldAriaLabel) ctx.canvas.setAttribute("aria-label", oldAriaLabel);
      for (const key of ["dragging", "selectedFace", "faceCount", "undoCount"])
        delete ctx.canvas.dataset[key];
    },
    activate() {
      ctx.canvas.style.cursor = "default";
      ctx.canvas.setAttribute(
        "aria-label",
        "Mesh editor. Drag a face to extrude. Drag the background or right-drag to orbit. Enter pulls the selected face; Escape cancels a drag.",
      );
      ctx.canvas.dataset.selectedFace = String(selected);
      ctx.canvas.dataset.faceCount = String(mesh.faces.length);
      ctx.canvas.dataset.undoCount = String(history.length);
    },
    dispose() {
      if (drag) cancelDrag();
      feedback.remove();
      arrow.remove();
      ctx.controls.mouseButtons.RIGHT = oldRight;
      ctx.canvas.style.cursor = "";
      if (oldAriaLabel) ctx.canvas.setAttribute("aria-label", oldAriaLabel);
      for (const key of ["dragging", "selectedFace", "faceCount", "undoCount"])
        delete ctx.canvas.dataset[key];
      material.dispose();
      wireMaterial.dispose();
      normalMaterial.dispose();
    },
  };
}
