import { vlyPlugin } from "@vly-ai/integrations";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vlyPlugin(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Only keep chunks for libraries the app actually uses
          'react-vendor': ['react', 'react-dom'],
          'jszip': ['jszip'],
          'lucide': ['lucide-react'],
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    chunkSizeWarningLimit: 1000,
    target: 'esnext',
    minify: 'esbuild',
  },
  optimizeDeps: {
    entries: ['index.html'],
    include: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
    ],
    // pdfjs-dist v5 is pure ESM, so it loads fine WITHOUT being pre-bundled.
    // Excluding it keeps the giant ~1.3MB library out of the dev-server's
    // cold-start dependency optimization, so the preview boots much faster.
    // (jspdf, jszip, @xenova/transformers stay pre-bundled — they contain
    // CommonJS internals that require the optimizer to run in the browser.)
    exclude: ['pdfjs-dist'],
  },
  server: {
    host: true,
    port: 5173,
    // HMR must stay disabled for the Freebuff platform's managed dev server.
    hmr: false,
  },
});
