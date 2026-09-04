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
  allowedDevOrigins: ["192.168.72.101", "192.168.*.*", "10.*.*.*", "172.16.*.*", "172.30.*.*"],
  cacheComponents: true,
  images: {
    remotePatterns: [new URL("https://cdn.shopify.com/s/files/**")],
  },
};

export default nextConfig;
