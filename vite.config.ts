import fs from "node:fs"
import path from "path"
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from "@sentry/vite-plugin"

const websiteChrome = path.resolve(__dirname, "../website/public/chrome/cac-chrome.js")

function serveCacChrome(): Plugin {
  return {
    name: "serve-cac-chrome",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0]
        if (url !== "/chrome/cac-chrome.js") return next()
        if (!fs.existsSync(websiteChrome)) return next()
        res.setHeader("Content-Type", "text/javascript; charset=utf-8")
        res.setHeader("Cache-Control", "no-store")
        fs.createReadStream(websiteChrome).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [
    serveCacChrome(),
    react(),
    tailwindcss(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        filesToDeleteAfterUpload: ["./dist/**/*.map"],
      },
    }),
  ],
  build: {
    sourcemap: "hidden",
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
