import type { QueryResult, QueryResultRow } from "pg";
import type { ClienteAlmacen } from "@/lib/almacen/objetos-s3";
import { sessionToken } from "@/lib/auth/session";
import { crearLimitador } from "./acceso";
import type { DependenciasRutas } from "./dependencias";
import type { BaseDatos } from "./repositorio";

/** Dobles de prueba compartidos por las pruebas de las rutas (no se importan desde código de producción). */

export const CONTRASENA = "clave-de-prueba";
export const COOKIE = `session=${sessionToken(CONTRASENA)}`;

export type Consulta = { sql: string; valores: unknown[] };
export type Respondedor = (consulta: Consulta) => unknown[] | { rows: unknown[]; rowCount?: number } | undefined;

export function baseFalsa(responder: Respondedor): BaseDatos & { consultas: Consulta[] } {
  const consultas: Consulta[] = [];
  return {
    consultas,
    async query<R extends QueryResultRow = QueryResultRow>(sql: string, valores: unknown[] = []): Promise<QueryResult<R>> {
      const consulta = { sql, valores };
      consultas.push(consulta);
      const respuesta = responder(consulta);
      const rows = (Array.isArray(respuesta) ? respuesta : respuesta?.rows ?? []) as R[];
      const rowCount = Array.isArray(respuesta) || !respuesta ? rows.length : respuesta.rowCount ?? rows.length;
      return { rows, rowCount, command: "", oid: 0, fields: [] };
    },
  };
}

export function almacenFalso(): ClienteAlmacen & { objetos: Map<string, { cuerpo: Uint8Array; tipo: string }> } {
  const objetos = new Map<string, { cuerpo: Uint8Array; tipo: string }>();
  return {
    objetos,
    async poner(clave, cuerpo, tipo) { objetos.set(clave, { cuerpo, tipo }); },
    async obtener(clave) { return objetos.get(clave) ?? null; },
    async existe(clave) { return objetos.has(clave); },
    async borrar(clave) { objetos.delete(clave); },
    urlFirmada: (clave) => `https://almacen.test/${clave}`,
  };
}

export function dependenciasFalsas(db: BaseDatos, extra: Partial<DependenciasRutas> = {}): DependenciasRutas & { auditorias: string[]; fallos: string[] } {
  const auditorias: string[] = [];
  const fallos: string[] = [];
  return {
    auditorias,
    fallos,
    db: () => db,
    almacen: () => null,
    servicio: () => ({ db, leerPasos: async () => [], versionApp: () => "abc123" }),
    resumir: async () => null,
    resumenAutomaticoActivo: () => false,
    limitadorRegistro: crearLimitador(1000),
    limitadorCaptura: crearLimitador(1000),
    auditar: (quien, que) => { auditorias.push(`${quien}: ${que}`); },
    registrarFallo: (evento) => { fallos.push(evento); },
    ...extra,
  };
}

export function peticion(url: string, init: { metodo?: string; cuerpo?: BodyInit; cabeceras?: Record<string, string>; conSesion?: boolean } = {}): Request {
  const cabeceras: Record<string, string> = { ...init.cabeceras };
  if (init.conSesion !== false) cabeceras.cookie = COOKIE;
  return new Request(`https://app.test${url}`, { method: init.metodo ?? "GET", headers: cabeceras, body: init.cuerpo });
}

export function peticionJson(url: string, cuerpo: unknown, init: { conSesion?: boolean; cabeceras?: Record<string, string> } = {}): Request {
  return peticion(url, { metodo: "POST", cuerpo: JSON.stringify(cuerpo), conSesion: init.conSesion, cabeceras: { "content-type": "application/json", ...init.cabeceras } });
}
