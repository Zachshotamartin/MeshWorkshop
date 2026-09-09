import { meshEdges, featurePlane, bevelFeature } from "./featureBevel.js";
import { constrainEdit } from "./intersections.js";
import { cloneMesh } from "./mesh.js";
import { createFeatureHandles } from "./featureHandles.js";

export function createFeatureEditing(ctx, model) {
  const { THREE: T, ui, root, canvas } = ctx;
  let mode = "face",
    selection = null,
    drag = null,
    hovered = null,
    keyboardDepth = 0.15;
  const handles = createFeatureHandles(ctx);
  const select = ui.select(
    "Selection",
    [
      { label: "Faces", value: "face" },
      { label: "Edges", value: "edge" },
      { label: "Vertices", value: "vertex" },
    ],
    mode,
    (value) => {
      cancel();
      model.cancelFace();
      mode = value;
      selection = hovered = null;
      sync();
      ctx.setStatus(
        mode === "face"
          ? "Select a face to push, pull, or bevel."
          : "Click a visible " +
              (mode === "edge" ? "edge" : "corner") +
              ", then drag right to cut inward. Drag left to reduce the cut.",
      );
    },
  );
  select.parentElement.parentElement.prepend(select.parentElement);
  const note = ui.note(
      "Select a feature, then drag right for a deeper inward cut. Left reduces it. Escape cancels.",
    ),
    prev = ui.button("Previous feature", () => cycle(-1)),
    next = ui.button("Next feature", () => cycle(1));
  const depth = ui.range("Keyboard bevel depth", {
    min: 0,
    max: 1.5,
    step: 0.01,
    value: keyboardDepth,
    onChange: (value) => (keyboardDepth = value),
  });
  const enter = ui.note(
    "Press Enter on the depth slider or viewport to bevel the selected feature.",
  );
  const own = [note, prev, next, depth.parentElement, enter],
    faceInputs = [
      ...select.parentElement.parentElement.querySelectorAll(
        "input,select,button",
      ),
    ].filter(
      (el) =>
        ![select, prev, next, depth].includes(el) &&
        (/Previous face|Next face|Inset face|Split face diagonally/.test(
          el.textContent,
        ) ||
          /Keyboard pull distance|Inset \/ bevel fraction/.test(
            el.getAttribute("aria-label") || "",
          )),
    );
  const dragOperation = [
    ...select.parentElement.parentElement.querySelectorAll("select"),
  ].find(
    (el) => el !== select && [...el.options].some((o) => o.value === "bevel"),
  );
  const featureGroup = document.createElement("div");
  featureGroup.style.display = "contents";
  own.forEach((el) => featureGroup.append(el));
  select.parentElement.after(featureGroup);
  const faceHeading = [
    ...select.parentElement.parentElement.querySelectorAll("h3"),
  ].find((el) => el.textContent === "Selected face");
  function features(mesh = model.get()) {
    return mode === "edge"
      ? meshEdges(mesh).map((edge) => edge.ids)
      : [...new Set(mesh.faces.flat())];
  }
  function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function sync() {
    featureGroup.style.display = mode === "face" ? "none" : "contents";
    if (faceHeading) faceHeading.style.display = mode === "face" ? "" : "none";
    faceInputs.forEach((el) => {
      el.disabled = mode !== "face";
      (el.closest("label") || el).style.display = mode === "face" ? "" : "none";
    });
    if (dragOperation) {
      dragOperation.disabled = mode !== "face";
      dragOperation.parentElement.style.display = mode === "face" ? "" : "none";
    }
    canvas.dataset.selectionMode = mode;
    canvas.style.cursor = "grab";
    model.selectionMode(mode);
    refresh();
  }
  function refresh() {
    const mesh = model.get(), list = mode === "face" ? [] : features(mesh);
    const previewCap = drag?.depth > 0.0005 ? mesh.faces.at(-1) : null;
    if (!previewCap && selection !== null && !list.some((item) => same(item, selection)))
      selection = null;
    if (hovered !== null && !list.some((item) => same(item, hovered))) hovered = null;
    canvas.dataset.selectedFeature = selection === null ? "" : JSON.stringify(selection);
    canvas.dataset.hoveredFeature = hovered === null ? "" : JSON.stringify(hovered);
    handles.show(mesh, mode, list, selection, hovered, previewCap);
  }
  function cycle(direction) {
    cancel();
    const list = features();
    hovered = null;
    selection =
      list[
        (list.findIndex((item) => same(item, selection)) +
          direction +
          list.length) %
          list.length
      ];
    refresh();
    ctx.setStatus(
      (mode === "edge" ? "Edge" : "Vertex") +
        " selected. Drag right or set bevel depth and press Enter.",
    );
  }
  function projected(point) {
    const p = new T.Vector3(...point)
        .applyMatrix4(root.matrixWorld)
        .project(ctx.camera),
      b = canvas.getBoundingClientRect();
    return [
      b.x + ((p.x + 1) * b.width) / 2,
      b.y + ((1 - p.y) * b.height) / 2,
      p.z,
    ];
  }
  function visible(point) {
    const world = new T.Vector3(...point).applyMatrix4(root.matrixWorld),
      camera = ctx.camera.position,
      ray = new T.Raycaster(camera, world.clone().sub(camera).normalize());
    const hit = ray.intersectObject(model.object(), false)[0];
    return !hit || hit.distance >= camera.distanceTo(world) - 0.015;
  }
  function pick(event) {
    const mesh = model.get(),
      b = canvas.getBoundingClientRect();
    if (
      event.clientX < b.x ||
      event.clientX > b.right ||
      event.clientY < b.y ||
      event.clientY > b.bottom
    )
      return null;
    root.updateWorldMatrix(true, true);
    ctx.camera.updateMatrixWorld();
    let best = null,
      score = event.pointerType === "touch" ? 28 : 20;
    for (const item of features(mesh)) {
      let world, distance;
      if (mode === "vertex") {
        world = mesh.vertices[item];
        const p = projected(world);
        if (p[2] < -1 || p[2] > 1) continue;
        distance = Math.hypot(event.clientX - p[0], event.clientY - p[1]);
      } else {
        const a = projected(mesh.vertices[item[0]]),
          c = projected(mesh.vertices[item[1]]),
          dx = c[0] - a[0],
          dy = c[1] - a[1],
          t = Math.max(
            0,
            Math.min(
              1,
              ((event.clientX - a[0]) * dx + (event.clientY - a[1]) * dy) /
                (dx * dx + dy * dy || 1),
            ),
          );
        distance = Math.hypot(
          event.clientX - a[0] - t * dx,
          event.clientY - a[1] - t * dy,
        );
        world = mesh.vertices[item[0]].map(
          (v, k) => v + (mesh.vertices[item[1]][k] - v) * t,
        );
      }
      if (distance < score && visible(world)) {
        score = distance;
        best = item;
      }
    }
    return best;
  }
  function end(commit) {
    if (!drag) return;
    const state = drag;
    drag = null;
    if (canvas.hasPointerCapture(state.pointer))
      canvas.releasePointerCapture(state.pointer);
    ctx.controls.enabled = state.controls;
    ctx.controls.enableDamping = state.damping;
    delete canvas.dataset.dragging;
    canvas.style.cursor = "grab";
    hovered = null;
    if (commit && state.depth > 0.0005) {
      model.commit(state.mesh, state.source);
      selection = null;
      ctx.setStatus(
        `Inward ${mode} bevel: ${state.depth.toFixed(2)} units.${state.blocked ? " " + state.blocked : ""} One undo step saved.`,
      );
    } else {
      model.show(state.source);
      ctx.setStatus(
        state.blocked || "Feature selected. Drag right to cut inward.",
      );
    }
    refresh();
  }
  function cancel() {
    end(false);
  }
  ctx.listen(
    canvas,
    "pointerdown",
    (event) => {
      if (
        mode === "face" ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const picked = pick(event);
      if (picked === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      model.cancelFace();
      selection = hovered = picked;
      try {
        const source = cloneMesh(model.get()),
          plane = featurePlane(source, mode, selection);
        drag = {
          source,
          mesh: source,
          plane,
          pointer: event.pointerId,
          start: event.clientX,
          startY: event.clientY,
          threshold: event.pointerType === "touch" ? 8 : 4,
          active: false,
          depth: 0,
          controls: ctx.controls.enabled,
          damping: ctx.controls.enableDamping,
          unitsPerPixel:
            (2 *
              Math.max(
                0.1,
                ctx.camera.position.distanceTo(
                  new T.Vector3(...source.vertices[plane.selected[0]]),
                ),
              ) *
              Math.tan(T.MathUtils.degToRad(ctx.camera.fov / 2))) /
            canvas.clientHeight,
        };
        ctx.controls.enableDamping = false;
        ctx.controls.update();
        ctx.controls.enabled = false;
        canvas.setPointerCapture(event.pointerId);
        canvas.focus({ preventScroll: true });
        canvas.dataset.dragging = "armed";
        canvas.style.cursor = "grabbing";
        refresh();
        ctx.setStatus("Drag right to bevel inward; left reduces the cut.");
      } catch (error) {
        ctx.setStatus(error.message);
        refresh();
      }
    },
    { capture: true },
  );
  ctx.listen(
    canvas,
    "pointermove",
    (event) => {
      if (mode === "face") return;
      if (!drag) {
        const next = event.buttons ? null : pick(event);
        if (!same(next, hovered)) { hovered = next; refresh(); }
        canvas.style.cursor = hovered === null ? "grab" : "pointer";
        return;
      }
      if (event.pointerId !== drag.pointer) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!drag.active && Math.hypot(event.clientX - drag.start, event.clientY - drag.startY) < drag.threshold) return;
      drag.active = true;
      const raw = Math.max(
          0,
          (event.clientX - drag.start) * drag.unitsPerPixel,
        ),
        value = Math.min(drag.plane.maxDepth, raw),
        limited = constrainEdit(
          ([amount]) => bevelFeature(drag.source, mode, selection, amount),
          [drag.depth],
          [value],
        );
      drag.mesh = limited.mesh;
      drag.depth = limited.values[0];
      drag.blocked =
        limited.blocked ||
        (raw > value ? "Stopped before the next edge." : null);
      model.show(drag.mesh);
      canvas.dataset.dragging = "preview";
      ctx.setStatus(
        `${mode === "edge" ? "Edge" : "Vertex"} bevel ${drag.depth.toFixed(2)} · inward only${drag.blocked ? " · " + drag.blocked : ""}`,
      );
    },
    { capture: true },
  );
  ctx.listen(canvas, "pointerleave", () => {
    if (!drag && hovered !== null) { hovered = null; refresh(); canvas.style.cursor = "grab"; }
  });
  ctx.listen(
    canvas,
    "pointerup",
    (event) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      end(true);
    },
    { capture: true },
  );
  ctx.listen(canvas, "pointercancel", cancel, { capture: true });
  ctx.listen(canvas, "lostpointercapture", () => {
    if (drag) cancel();
  });
  ctx.listen(window, "blur", cancel);
  ctx.listen(window, "resize", cancel);
  function keyboard(event) {
    if (mode === "face") return;
    if (event.key === "Escape") {
      cancel();
      return;
    }
    if (
      event.key !== "Enter" ||
      event.repeat ||
      ![canvas, depth].includes(event.target)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (selection === null) cycle(1);
    const source = cloneMesh(model.get());
    try {
      const plane = featurePlane(source, mode, selection),
        limited = constrainEdit(
          ([amount]) => bevelFeature(source, mode, selection, amount),
          [0],
          [Math.min(keyboardDepth, plane.maxDepth)],
        );
      if (limited.values[0] > 0.0005) {
        model.commit(limited.mesh, source);
        selection = null;
      }
      ctx.setStatus(
        limited.blocked ||
          "Inward bevel applied. Undo restores the original feature.",
      );
      refresh();
    } catch (error) {
      ctx.setStatus(error.message);
    }
  }
  ctx.listen(window, "keydown", keyboard, { capture: true });
  sync();
  return {
    get active() {
      return mode !== "face";
    },
    refresh,
    cancel,
    deactivate() {
      cancel();
      hovered = null;
      handles.clear();
    },
    activate() {
      sync();
    },
    dispose() {
      cancel();
      handles.dispose();
      for (const key of ["selectionMode", "selectedFeature", "hoveredFeature"]) delete canvas.dataset[key];
    },
  };
}
