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
  // PDF generation runs in a module Web Worker that lazy-loads pdf-lib via
  // dynamic import() — that requires code-splitting, so the worker must be
  // bundled as ESM (the default 'iife' format cannot split chunks).
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    entries: ['index.html'],
    include: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
    ],
    // pdf.js and @xenova/transformers are served from /public/vendor and
    // loaded at runtime (URL import / script tag) — they are NOT part of the
    // Vite module graph, so neither cold-start dependency optimization nor
    // `vite build` ever processes them. These excludes are belt-and-suspenders.
    // (jspdf and jszip stay pre-bundled — they contain CommonJS internals that
    // require the optimizer to run in the browser.)
    exclude: ['pdfjs-dist', '@xenova/transformers', 'onnxruntime-web'],
  },
  server: {
    host: true,
    port: 5173,
    // HMR must stay disabled for the Freebuff platform's managed dev server.
    hmr: false,
  },
});
