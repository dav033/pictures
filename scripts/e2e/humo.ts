/**
 * Humo e2e en un navegador de verdad (Chrome del sistema) contra una base: login, vista guiada, ideas y precio, vista clásica,
 * catálogo y Taller 3D (plantilla, lista de compra, hoja de armado, imprimir, foco, «Añadir» por repositorio). Sin llamadas de pago: la guardia aborta
 * cualquier ruta de imágenes o de IA de pago y topa los turnos de chat en 2. No va en CI (necesita Chrome).
 *
 *   npm run e2e:humo -- [--base http://localhost:3010] [--env-file .env.local] [--con-chat]
 *
 * Detalle y uso contra producción: scripts/e2e/README.md. Sale con 1 si algún paso falla (SKIPPED no cuenta).
 */
import { chromium } from "playwright";
import { leerConfiguracion } from "./humo/configuracion";
import { crearEjecutor } from "./humo/ejecutor";
import { comprobarGasto, instalarGuardiaDeGasto, PASO_GUARDIA } from "./humo/guardia-de-gasto";
import { escribirInforme, imprimirResumen } from "./humo/informe";
import { crearPasosDelAsistente, PASO_ATERRIZAJE, PASO_IDEAS, PASO_LOGIN, PASO_PRECIO, PASO_VISTA_GUIADA } from "./humo/pasos-asistente";
import { PASO_CATALOGO, PASO_CLASICA, PASO_MODULOS, pasoCatalogo, pasoModulos, pasoVistaClasica } from "./humo/pasos-paginas";
import { crearPasosDelTaller, PASO_FOCO, PASO_HOJA, PASO_IMPRIMIR, PASO_LISTA, PASO_PLANTILLA, PASO_REPOSITORIOS } from "./humo/pasos-taller";

async function principal(): Promise<number> {
  const config = leerConfiguracion(process.argv.slice(2), process.env);
  const iniciadoEn = new Date();
  console.log(`Humo e2e contra ${config.base} (${config.esLocal ? "local: IA local sin costo" : "remoto: sin turnos de chat salvo --con-chat"})`);

  const navegador = await chromium.launch({ executablePath: config.ejecutable, args: ["--disable-dev-shm-usage"] });
  try {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CO" });
    const guardia = await instalarGuardiaDeGasto(contexto, config.esLocal || config.incluirChatEnRemoto);
    const { entorno, ejecutar, resultados } = crearEjecutor(contexto, config);
    const asistente = crearPasosDelAsistente(entorno);
    const taller = crearPasosDelTaller(entorno);

    await ejecutar(PASO_LOGIN, asistente.login);
    await ejecutar(PASO_ATERRIZAJE, asistente.aterrizaje, [PASO_LOGIN]);
    await ejecutar(PASO_VISTA_GUIADA, asistente.vistaGuiada, [PASO_LOGIN]);
    await ejecutar(PASO_IDEAS, asistente.ideas, [PASO_LOGIN]);
    await ejecutar(PASO_PRECIO, asistente.precio, [PASO_IDEAS]);
    await ejecutar(PASO_CLASICA, () => pasoVistaClasica(entorno), [PASO_LOGIN]);
    await ejecutar(PASO_CATALOGO, () => pasoCatalogo(entorno), [PASO_LOGIN]);
    await ejecutar(PASO_PLANTILLA, taller.plantilla, [PASO_LOGIN]);
    await ejecutar(PASO_LISTA, taller.lista, [PASO_PLANTILLA]);
    await ejecutar(PASO_HOJA, taller.hoja, [PASO_LISTA]);
    await ejecutar(PASO_IMPRIMIR, taller.imprimir, [PASO_HOJA]);
    await ejecutar(PASO_FOCO, taller.foco, [PASO_LISTA]);
    await ejecutar(PASO_REPOSITORIOS, taller.repositorios, [PASO_PLANTILLA]);
    await ejecutar(PASO_MODULOS, () => pasoModulos(entorno), [PASO_LOGIN]);
    await ejecutar(PASO_GUARDIA, async () => comprobarGasto(guardia));

    const archivo = escribirInforme(config, resultados(), iniciadoEn);
    imprimirResumen(config, resultados(), iniciadoEn, archivo);
    return resultados().some((resultado) => resultado.estado === "FAIL") ? 1 : 0;
  } finally {
    await navegador.close();
  }
}

principal().then(
  (codigo) => { process.exitCode = codigo; },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
