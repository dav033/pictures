import type { Locator, Page } from "playwright";
import { PLAZOS, type Configuracion } from "./configuracion";

/** Abre una ruta de la app y falla con un mensaje claro si responde con error, manda a iniciar sesión o redirige a otra ruta. */
export async function irA(pagina: Page, config: Configuracion, ruta: string): Promise<void> {
  const respuesta = await pagina.goto(`${config.base}${ruta}`, { waitUntil: "domcontentloaded", timeout: PLAZOS.navegacion });
  if (!respuesta || respuesta.status() >= 400) {
    throw new Error(`${ruta} respondió HTTP ${respuesta?.status() ?? "sin respuesta"}`);
  }
  const llegada = new URL(pagina.url()).pathname;
  if (ruta !== "/login" && llegada === "/login") {
    throw new Error(`${ruta} mandó a /login: el sitio pide contraseña y la sesión no se inició (pasa APP_PASSWORD con --env-file).`);
  }
  if (llegada !== ruta) throw new Error(`${ruta} redirigió a ${llegada}`);
}

/**
 * `domcontentloaded` llega antes de que React enganche los eventos: un clic en ese hueco no hace nada y la prueba espera en vano.
 * React deja sus claves `__react…` en el nodo cuando lo hidrata, y eso es lo que se espera antes de pulsar.
 */
export async function esperarHidratacion(elemento: Locator): Promise<void> {
  const limite = Date.now() + PLAZOS.accion;
  while (Date.now() < limite) {
    // Se vuelve a resolver el localizador en cada vuelta: si React descarta el HTML del servidor, el nodo viejo nunca se hidrata.
    const hidratado = await elemento.evaluate((nodo) => Object.keys(nodo).some((clave) => clave.startsWith("__reactProps")), undefined, { timeout: 2_000 }).catch(() => false);
    if (hidratado) return;
    await elemento.page().waitForTimeout(200);
  }
  throw new Error("La página no terminó de hidratarse en el plazo");
}
