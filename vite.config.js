import { defineConfig } from 'vite';
export default defineConfig({
  cacheDir: '.vite',
  optimizeDeps: {
    include: [
      'three/addons/lines/LineMaterial.js',
      'three/addons/lines/LineSegments2.js',
      'three/addons/lines/LineSegmentsGeometry.js',
    ],
  },
});
