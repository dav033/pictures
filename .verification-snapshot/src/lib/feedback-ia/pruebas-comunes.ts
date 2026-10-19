import type { QueryResult, QueryResultRow } from "pg";
import type { ClienteAlmacen, ObjetoListado } from "@/lib/almacen/objetos-s3";
import { sessionToken } from "@/lib/auth/session";
import { cookieDeAdministrador, crearLimitador } from "./acceso";
import type { DependenciasRutas } from "./dependencias";
import type { BaseDatos } from "./repositorio";

/** Dobles de prueba compartidos por las pruebas de las rutas (no se importan desde código de producción). */

export const CONTRASENA = "clave-de-prueba";
export const CLAVE_ADMIN = "clave-de-administrador";
const SESION = `session=${sessionToken(CONTRASENA)}`;
const COOKIE_ADMIN_VALIDA = cookieDeAdministrador(CLAVE_ADMIN).split(";")[0];

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

export type AlmacenFalso = ClienteAlmacen & { objetos: Map<string, { cuerpo: Uint8Array; tipo: string; modificado: Date }> };

export function almacenFalso(): AlmacenFalso {
  const objetos: AlmacenFalso["objetos"] = new Map();
  return {
    objetos,
    async poner(clave, cuerpo, tipo) { objetos.set(clave, { cuerpo, tipo, modificado: new Date() }); },
    async obtener(clave) { return objetos.get(clave) ?? null; },
    async existe(clave) { return objetos.has(clave); },
    async borrar(clave) { objetos.delete(clave); },
    async listar(prefijo) {
      const listado: ObjetoListado[] = [...objetos].filter(([clave]) => clave.startsWith(prefijo)).map(([clave, objeto]) => ({ clave, modificado: objeto.modificado }));
      return { objetos: listado, siguiente: null };
    },
    urlFirmada: (clave) => `https://almacen.test/${clave}`,
  };
}

export function dependenciasFalsas(db: BaseDatos, extra: Partial<DependenciasRutas> = {}): DependenciasRutas & { auditorias: string[]; fallos: string[]; avisos: string[] } {
  const auditorias: string[] = [];
  const fallos: string[] = [];
  const avisos: string[] = [];
  return {
    auditorias,
    fallos,
    avisos,
    db: () => db,
    almacen: () => null,
    servicio: () => ({ db, leerPasos: async () => [], versionApp: () => "abc123" }),
    resumir: async () => null,
    resumenAutomaticoActivo: () => false,
    limitadorRegistro: crearLimitador(1000),
    limitadorConsulta: crearLimitador(1000),
    limitadorCaptura: crearLimitador(1000),
    limitadorCapturaDiario: crearLimitador(1000),
    limitadorResumenGemini: crearLimitador(1000),
    auditar: (quien, que) => { auditorias.push(`${quien}: ${que}`); },
    registrarFallo: (evento) => { fallos.push(evento); },
    avisar: (evento) => { avisos.push(evento); },
    ...extra,
  };
}

type OpcionesPeticion = {
  metodo?: string;
  cuerpo?: BodyInit;
  cabeceras?: Record<string, string>;
  conSesion?: boolean;
  /** Cookie `feedback_usuario` del navegador (32 hex); sin ella el servidor entrega una nueva. */
  usuario?: string;
  admin?: boolean;
};

export function peticion(url: string, init: OpcionesPeticion = {}): Request {
  const cabeceras: Record<string, string> = { ...init.cabeceras };
  const cookies = [
    cabeceras.cookie ?? null,
    init.conSesion === false ? null : SESION,
    init.usuario ? `feedback_usuario=${init.usuario}` : null,
    init.admin ? COOKIE_ADMIN_VALIDA : null,
  ].filter((cookie): cookie is string => cookie !== null);
  if (cookies.length > 0) cabeceras.cookie = cookies.join("; ");
  return new Request(`https://app.test${url}`, { method: init.metodo ?? "GET", headers: cabeceras, body: init.cuerpo });
}

export function peticionJson(url: string, cuerpo: unknown, init: Omit<OpcionesPeticion, "metodo" | "cuerpo"> = {}): Request {
  return peticion(url, { ...init, metodo: "POST", cuerpo: JSON.stringify(cuerpo), cabeceras: { "content-type": "application/json", ...init.cabeceras } });
}

export const USUARIO_A = "a".repeat(32);
export const USUARIO_B = "b".repeat(32);
