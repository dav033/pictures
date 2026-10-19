import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE_POR_DEFECTO = "http://localhost:3010";
const CHROME_DEL_SISTEMA = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PYTHON_POR_DEFECTO = "http://127.0.0.1:8000";
const HOSTS_LOCALES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Plazos en ms. El primer acceso a una ruta de `next dev` compila, por eso la navegación es holgada. */
export const PLAZOS = { accion: 20_000, navegacion: 60_000, turnoDeChat: 90_000 } as const;

export type Configuracion = {
  base: string;
  /** Una base local usa el proveedor de IA local (US$0); una remota usa el de pago y por eso los turnos de chat son opcionales. */
  esLocal: boolean;
  incluirChatEnRemoto: boolean;
  contrasena: string | null;
  urlPython: string;
  ejecutable: string | undefined;
  carpetaSalida: string;
};

function valorDe(argumentos: readonly string[], nombre: string): string | undefined {
  const igual = argumentos.find((argumento) => argumento.startsWith(`${nombre}=`));
  if (igual) return igual.slice(nombre.length + 1);
  const indice = argumentos.indexOf(nombre);
  return indice >= 0 ? argumentos[indice + 1] : undefined;
}

function cargarArchivoDeEntorno(ruta: string): void {
  const absoluta = path.resolve(ruta);
  if (!existsSync(absoluta)) throw new Error(`--env-file: no existe ${absoluta}`);
  process.loadEnvFile(absoluta);
}

function baseNormalizada(texto: string): URL {
  try {
    return new URL(texto.replace(/\/+$/, ""));
  } catch {
    throw new Error(`--base no es una URL válida: ${texto}`);
  }
}

function ejecutorDelNavegador(entorno: NodeJS.ProcessEnv): string | undefined {
  const indicado = entorno.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim();
  if (indicado) return indicado;
  return existsSync(CHROME_DEL_SISTEMA) ? CHROME_DEL_SISTEMA : undefined;
}

export function leerConfiguracion(argumentos: readonly string[], entorno: NodeJS.ProcessEnv): Configuracion {
  const archivoDeEntorno = valorDe(argumentos, "--env-file");
  if (archivoDeEntorno) cargarArchivoDeEntorno(archivoDeEntorno);
  const url = baseNormalizada(valorDe(argumentos, "--base") ?? BASE_POR_DEFECTO);
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    base: url.origin,
    esLocal: HOSTS_LOCALES.has(url.hostname),
    incluirChatEnRemoto: argumentos.includes("--con-chat"),
    contrasena: entorno.APP_PASSWORD?.trim() || null,
    urlPython: entorno.PYTHON_BACKEND_URL?.trim() || PYTHON_POR_DEFECTO,
    ejecutable: ejecutorDelNavegador(entorno),
    carpetaSalida: path.join(os.tmpdir(), "e2e-humo", sello),
  };
}
