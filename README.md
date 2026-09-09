# Mesh Workshop

A small real polygon modeler: face selection, connected extrusion, face insets, Catmull–Clark subdivision, undo, wireframe inspection and OBJ export. Standalone and portfolio use the same `createExperiment` module. Presets are built by the same editable topology operations, not pre-rendered pictures.

`npm test`, `npm run dev`, `npm run build`.

Pure mesh data is `{vertices: number[][], faces: number[][]}`. `extrude`, `inset` and `subdivide` return new meshes. A cube begins with eight shared vertices and six outward-facing quads. Extrusion replaces one cap and adds its bridge faces. Inset adds a coplanar ring. Subdivision creates shared edge/face points with the Catmull–Clark interior and boundary rules.

Limits: convex face insets move points toward the centroid rather than constructing constant-distance offsets. Extreme repeated extrusions may self-intersect; this is not a solid Boolean/CAD system. Subdivision rejects nonmanifold edges and more than16,000 resulting faces. Undo retains24 edits.

Reference: Catmull & Clark, *Recursively generated B-spline surfaces on arbitrary topological meshes* (1978), https://doi.org/10.1016/0010-4485(78)90110-0.

## Chamfers and face cuts

Beveled extrusion raises a smaller cap and joins it to the original boundary with sloped shoulder faces. It uses the extrusion distance and inset fraction; it is a selected-face chamfered extrusion, not an all-edge bevel modifier. Split face diagonally connects existing nonadjacent face vertices and does not create T-junctions. Both operations preserve closed manifold topology on a valid closed input and participate in undo.

## Run and explore

[Open the portfolio demo](https://zachsm.com/experiments/mesh-workshop). This repository runs independently and exports the same implementation used by the portfolio.

Requires Node.js 22 or later.

```sh
npm ci
npm test
npm run dev
```

`npm run build` produces a static site in `dist`. Editing, uploaded files, and exports stay in the browser. No account, server processing, or GitHub Actions is required.

## Captured examples

![Green polygon tower with stepped terraces, an extended selected roof face, and its actual wireframe edges.](examples/01.png)

A terraced tower shaped with face extrusion and inset operations..

![Rounded green vessel with a dense, continuous quad wireframe from actual Catmull–Clark subdivision.](examples/02.png)

Three Catmull–Clark passes turn an extruded polygon form into a rounded vessel..

Exact reproduction steps are recorded in [the example manifest](examples/manifest.json).
