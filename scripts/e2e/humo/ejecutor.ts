import { mkdirSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import { PLAZOS, type Configuracion } from "./configuracion";

export type EstadoPaso = "PASS" | "FAIL" | "SKIPPED";

export type ResultadoPaso = { paso: string; estado: EstadoPaso; ms: number; detalle: string | null; captura: string | null };

/** El paso no se puede hacer en este entorno (una dependencia o una bandera apagada): se anota y no cuenta como fallo. */
export class PasoOmitido extends Error {}

export type Entorno = {
  config: Configuracion;
  paginaNueva: () => Promise<Page>;
  /** Marca la página que se fotografía si el paso falla (para los pasos que siguen en una página ya abierta). */
  usar: (pagina: Page) => void;
};

export type CuerpoDePaso = () => Promise<string | void>;

export type Ejecutor = {
  entorno: Entorno;
  /** `requiere`: nombres de pasos que tienen que haber pasado; si no, este se omite. */
  ejecutar: (paso: string, cuerpo: CuerpoDePaso, requiere?: readonly string[]) => Promise<void>;
  resultados: () => readonly ResultadoPaso[];
};

const LINEAS_DE_ERROR = 8;

function sinColores(texto: string): string {
  return texto.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}

/** Mensaje corto del error: sin colores de terminal, sin la contraseña y con las primeras líneas del registro de Playwright. */
function mensajeDelError(error: unknown, secreto: string | null): string {
  const crudo = sinColores(error instanceof Error ? error.message : String(error));
  const limpio = secreto ? crudo.split(secreto).join("***") : crudo;
  return limpio.split("\n").slice(0, LINEAS_DE_ERROR).join("\n").trim();
}

function nombreDeArchivo(indice: number, paso: string): string {
  const slug = paso.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${String(indice).padStart(2, "0")}-${slug}.png`;
}

function linea(resultado: ResultadoPaso): string {
  const detalle = resultado.detalle ? ` — ${resultado.detalle.split("\n").join(" | ")}` : "";
  return `[${resultado.estado}] ${resultado.paso} (${resultado.ms} ms)${detalle}`;
}

export function crearEjecutor(contexto: BrowserContext, config: Configuracion): Ejecutor {
  const resultados: ResultadoPaso[] = [];
  const erroresDePagina: string[] = [];
  let paginaActual: Page | null = null;

  const entorno: Entorno = {
    config,
    paginaNueva: async () => {
      const pagina = await contexto.newPage();
      pagina.setDefaultTimeout(PLAZOS.accion);
      pagina.on("pageerror", (error) => erroresDePagina.push(String(error)));
      paginaActual = pagina;
      return pagina;
    },
    usar: (pagina) => { paginaActual = pagina; },
  };

  async function capturar(paso: string): Promise<string | null> {
    if (!paginaActual || paginaActual.isClosed()) return null;
    mkdirSync(config.carpetaSalida, { recursive: true });
    const archivo = path.join(config.carpetaSalida, nombreDeArchivo(resultados.length + 1, paso));
    try {
      await paginaActual.screenshot({ path: archivo, timeout: 10_000 });
      return archivo;
    } catch {
      return null;
    }
  }

  function registrar(resultado: ResultadoPaso): void {
    resultados.push(resultado);
    console.log(linea(resultado) + (resultado.captura ? `\n         captura: ${resultado.captura}` : ""));
  }

  async function ejecutar(paso: string, cuerpo: CuerpoDePaso, requiere: readonly string[] = []): Promise<void> {
    const sinCumplir = requiere
      .map((nombre) => ({ nombre, previo: resultados.find((resultado) => resultado.paso === nombre) }))
      .find(({ previo }) => previo?.estado !== "PASS");
    if (sinCumplir) {
      const motivo = sinCumplir.previo ? `quedó en ${sinCumplir.previo.estado}` : "no se ejecutó";
      registrar({ paso, estado: "SKIPPED", ms: 0, detalle: `requiere «${sinCumplir.nombre}», que ${motivo}`, captura: null });
      return;
    }
    const inicio = Date.now();
    const erroresPrevios = erroresDePagina.length;
    try {
      const detalle = (await cuerpo()) ?? null;
      const nuevos = erroresDePagina.slice(erroresPrevios);
      if (nuevos.length > 0) throw new Error(`Errores no capturados en la página: ${nuevos.join(" || ")}`);
      registrar({ paso, estado: "PASS", ms: Date.now() - inicio, detalle, captura: null });
    } catch (error) {
      const ms = Date.now() - inicio;
      if (error instanceof PasoOmitido) {
        registrar({ paso, estado: "SKIPPED", ms, detalle: error.message, captura: null });
        return;
      }
      registrar({ paso, estado: "FAIL", ms, detalle: mensajeDelError(error, config.contrasena), captura: await capturar(paso) });
    }
  }

  return { entorno, ejecutar, resultados: () => resultados };
}
