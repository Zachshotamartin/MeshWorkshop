Run npm test: seven real topology tests for extrusion, inset, Catmull–Clark, valid presets/OBJ and immutable rejection paths. Browser: extrude selected terraced-tower roof, inset, undo, change preset, subdivide and export OBJ. All operations modify vertex/face topology. No Actions added.

Verified in Chromium: extrusion/inset export topology counts, undo restores those counts, subdivision changes the rendered model, 390px layout scrolls without horizontal overflow. Two actual WebGL captures live in examples/ with exact steps.
