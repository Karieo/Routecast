import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { apiMiddleware } from "./server/api";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "ROUTECAST_");
  return {
    plugins: [
      react(),
      {
        name: "routecast-local-api",
        configureServer(server) {
          server.middlewares.use(
            apiMiddleware(
              mode === "development" && env.ROUTECAST_DEV_PROVIDERS === "1",
            ),
          );
        },
        configurePreviewServer(server) {
          server.middlewares.use(apiMiddleware(false));
        },
      },
    ],
    server: { host: "127.0.0.1" },
    build: {
      rollupOptions: {
        input: {
          main: "index.html",
          landing: "routecast-landing.html",
          privacy: "privacy-policy.html",
          terms: "terms-of-service.html",
        },
      },
    },
  };
});
