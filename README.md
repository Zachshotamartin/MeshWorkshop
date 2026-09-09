# Mesh Workshop

A small polygon modeler built around **direct face dragging**. Grab a face and pull it along its normal; the preview edits real topology and releasing saves one undo step. The standalone tool and portfolio import the same `createExperiment` module.

[Open the portfolio demo](https://zachsm.com/experiments/mesh-workshop).

## Run

Requires Node.js 22 or later.

```sh
npm ci
npm test
npm run dev
```

`npm run build` produces the static site in `dist`. No server processing, account, or GitHub Actions is required.

## Interaction

- **Selection:** switch between Faces, Edges, and Vertices. Edge mode uses thick outlines; vertex mode uses round corner handles. Hover highlights a target, and clicking selects it in gold without highlighting the old face. Other visible handles remain available for the next selection.
- **Edge and vertex bevel:** drag a selected handle right to cut inward, or left to reduce the preview. A small click movement does not start a cut. Hidden handles cannot be picked through the mesh. Previous/Next feature and Enter on the bevel-depth slider provide a keyboard alternative.
- **Drag a face:** select its nearest visible surface, pull outward to extend it, or push inward to shorten the existing face. The floating arrow and distance readout show the gesture. Clicking without moving only selects.
- **Touching parallel walls:** a face can rise alongside connected neighboring walls, including the lower face between two raised blocks. The walls join as the face passes them; only geometry obstructing the pull stops it.
- **Edge and corner contact:** a face can pass a neighboring corner without treating contact as penetration, and can be shortened afterward. Raising a lower face between perpendicular walls joins their shared corner while keeping untouched surfaces separate.
- **Face looking directly at the camera:** drag upward to pull it toward you. This avoids unstable projection when the normal has no useful screen-space direction.
- **Shift:** snap the pull to 0.1 model units.
- **Escape or pointer cancellation:** restore the exact pre-drag mesh. Pulling back through the start also discards the preview.
- **Background drag or right-drag:** orbit without editing the mesh.
- **Drag operation:** choose extrusion or bevel. In bevel mode, drag along the arrow for height and across it to narrow or widen the cap.
- **Keyboard:** use Previous/Next face, adjust Keyboard pull distance, then press Enter on the slider or viewport.

Inset, diagonal face cuts, subdivision, wireframe display, 24-step undo, editable geometric presets, and OBJ export remain available. There is no button-based extrusion workflow.

## How it works

Pure mesh data is `{vertices: number[][], faces: number[][]}`. A cube starts with eight shared vertices and six outward-facing quads. Extrusion replaces one cap and adds connected side faces. Inset adds a coplanar ring; the bevel variant raises a smaller cap with sloped shoulders. A diagonal cut connects existing vertices without T-junctions. Catmull–Clark subdivision creates shared edge and face points using the interior and boundary rules.

When new side walls coincide with connected, opposite-facing walls, planar clipping removes the internal overlap from both sides. Shared cut vertices are welded and incident edges split, preserving a closed surface through neighboring roof heights. This follows connected coplanar wall components of any size; it does not union disconnected solids. Face provenance keeps collision checks and the selected cap correct after removed walls change the face indices.

For lateral edge and point contacts, obstacle triangles are clipped against the extrusion prism. A contact is allowed only when the entire clipped region lies on a lateral boundary; triangles crossing the footprint, cap-interior contacts, and overlapping face areas still block. Shortening checks the full height of the connected side walls, so existing tangencies below the cap do not falsely stop an inward gesture. Branch-dependency and minimum-height limits still apply.

The drag axis is computed from the camera's homogeneous view-projection transform. The pointer's motion along the projected normal is inverted back into model distance, including perspective foreshortening. An end-on normal uses a camera-depth-scaled upward gesture. Preview geometry is rebuilt from one immutable pre-drag snapshot, not repeatedly extruded from the previous preview. Only release adds history. Front-face raycasting against the nearest solid triangle avoids selecting an occluded back face through the visible cap.

The exported lifecycle hooks support cached tool switching: `deactivate()` rolls back an active drag and releases pointer capture; `activate()` restores the viewport affordances. Neither switching nor a canceled gesture commits an edit.

Reference: [Catmull & Clark, *Recursively generated B-spline surfaces on arbitrary topological meshes* (1978)](https://doi.org/10.1016/0010-4485(78)90110-0).

## Verification

`npm test` exercises topology and camera-aware projection, including different camera scales, end-on fallback, inward-motion bounds, repeated previews and rollback.

Connected-extrusion regressions cover one and two touching walls, twenty wall sections, rotated meshes, perpendicular wall corners, edge-only and point-only tangency, repeated joins, exact roof heights, and real obstacles. The browser suite pulls these faces with actual pointer gestures, shortens a corner-grazing extrusion, checks exported volume and closed topology, and compares exact undo results.

```sh
npx playwright install chromium
npm run test:browser
```

The browser test starts a local Vite server, performs real mouse and touch drags, downloads and compares actual OBJ geometry, verifies one-step undo, cancels gestures, checks foreground picking, orbits, exercises keyboard operation and tests deactivation. To use an already-running server:

```sh
MESH_WORKSHOP_URL=http://127.0.0.1:5341 npm run test:browser
```

## Limits

Choose Faces, Edges, or Vertices with the selection control. Edge and vertex modes make a single planar inward chamfer: click a visible edge or corner and drag right to increase the cut, left to reduce it. The remaining surface stays closed. Convex, manifold features are supported; flat and concave features report why they cannot be cut.

Outward pulls add connected geometry up to 3 model units. Inward pushes move the current face vertices without adding inverted side walls, bounded by the nearest supporting layer. Moves below 0.002 units are treated as unchanged. Bevel height and cap width respond to orthogonal mouse directions within one undo transaction. Edits and subdivision are bounded to 16,000 output faces. Insets and face bevels move corners toward the centroid rather than applying a constant-distance CAD offset. Inward edits are blocked when an attached extrusion depends on the selected corners. Extrusions, face bevels, insets, edge bevels, and vertex bevels check changed polygons and triangle intersections against a cached spatial tree, including coplanar overlap and enclosed obstacles in the swept cap volume. Dragging clamps to the last valid position. Twisted, collapsed, and intersecting faces are rejected. This is a bounded polygon modeler with numerical tolerances, not a Boolean CAD kernel or rounded multi-segment bevel modifier. Subdivision rejects nonmanifold edges.

## Captured examples

![A cube face being pulled upward, with a gold direction arrow, live distance readout and connected side faces.](examples/01.png)

An actual drag preview. Releasing commits the whole pull as one edit.

![A cube with a smaller raised top cap joined to its original boundary by sloped bevel shoulders.](examples/02.png)

The same direct gesture in Bevel mode creates sloped shoulder faces.

[Exact reproduction steps](examples/manifest.json).

## Geometry references

[Blender bevel manual](https://docs.blender.org/manual/en/3.0/modeling/meshes/editing/edge/bevel.html) describes edge versus vertex selection, inward chamfer geometry, and overlap clamping. This implementation uses a local clipping plane at a convex selected feature, shares cut vertices between neighboring polygons, and closes the exposed loop with a consistently oriented cap. Edge selection requires two incident faces; vertex selection uses the incident face normals.
