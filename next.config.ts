import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next bloquea por defecto las peticiones cross-origin a los recursos de desarrollo
  // (`/_next/*`, incluido el WebSocket de HMR): solo acepta el host con el que arrancó, que
  // es `localhost`. Al abrir la app desde otra máquina de la red, Firefox no podía conectar a
  // `ws://192.168.72.101:3001/_next/hmr` y quedaba sin recarga en caliente.
  //
  // Solo afecta a `next dev` y solo habilita rangos privados de LAN: nada de comodines
  // abiertos, para no permitir que cualquier origen pida recursos del servidor de desarrollo.
  // `127.0.0.1` también: abrir la app por la IP de loopback en vez de `localhost` dejaba la
  // página sin JavaScript (chunks bloqueados) y sin un solo botón que respondiera (2026-09-25).
  allowedDevOrigins: ["127.0.0.1", "192.168.72.101", "192.168.*.*", "10.*.*.*", "172.16.*.*", "172.30.*.*"],
  cacheComponents: true,
  experimental: {
    // `src/proxy.ts` matches every API route, so Next buffers each request body
    // up to this size and delivers a larger one truncated (no 413). Explicit
    // instead of the implicit default so the photo analysis route can reject a
    // bigger body with a clear "photo too large" message. Keep equal to
    // `LIMITE_CUERPO_ANALISIS_BYTES` (src/app/api/references/analyze/analisis-http.ts).
    proxyClientMaxBodySize: 10 * 1024 * 1024,
  },
  images: {
    remotePatterns: [new URL("https://cdn.shopify.com/s/files/**")],
  },
};

export default nextConfig;
