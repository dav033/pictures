/**
 * Lógica pura del pulso de producción (`npm run prod:pulso`): agrega las filas que lee el script, decide qué es una alerta y
 * arma las líneas del informe. Sin base, red ni reloj: se prueba con filas en memoria (scripts/test/test-pulso-produccion.ts).
 * Solo agregados: nada de texto del cliente ni identificadores.
 */

export const UMBRAL_ERRORES = 5;
export const UMBRAL_PROMEDIO = 6;
export const MIN_CALIFICACIONES = 3;
export const ESTADOS_LOGIN_SANOS: readonly number[] = [200, 307];
/** Lo más que se lista por sección antes de resumir el resto en «+N más»: el informe cabe en 30 líneas. */
const MAX_LINEAS_POR_SECCION = 4;

/** Estados de `plan_audit_log` que equivalen a un 5xx (el servidor o un servicio del que depende no pudo), a diferencia de un rechazo esperado. */
export const ESTADOS_PLAN_5XX: ReadonlySet<string> = new Set(["ERROR", "BACKEND_NO_DISPONIBLE", "ARMADO_NO_DISPONIBLE"]);
/** Razones (`geometry.razon`) de `plan_audit_log` que equivalen a un 5xx: el motor 3D lanzó (500 `ERROR_DEL_MOTOR`). */
export const RAZONES_PLAN_5XX: ReadonlySet<string> = new Set(["error_inesperado"]);
/** Resultados de `ai_call_log` que son un fallo del proveedor o del servidor; `cancelado` lo decide el cliente y no cuenta. */
export const RESULTADOS_LLAMADA_5XX: ReadonlySet<string> = new Set(["error", "timeout"]);

export type FilaFeedback = { producto: string; propio: boolean; calificacion: number | null; deshecho: boolean; cuantos: number };
export type FilaPlan = { estado: string; motor: string; razon: string; cuantos: number };
export type FilaLlamada = { proveedor: string; modelo: string; superficie: string; resultado: string; propio: boolean; cuantos: number; coste: number; moneda: string | null };
export type Despliegue = { estado: string; edad: string };

export type DatosPulso = {
  horas: number;
  incluirPropio: boolean;
  feedback: readonly FilaFeedback[];
  plan: readonly FilaPlan[];
  llamadas: readonly FilaLlamada[];
  /** Estado HTTP de /login; `null` si no respondió. */
  login: number | null;
  /** El despliegue de producción más reciente; `null` si no se pudo leer (sin CLI, sin sesión). */
  despliegue: Despliegue | null;
};

export type ResumenSuperficie = { producto: string; turnos: number; calificados: number; promedio: number | null; distribucion: Record<number, number>; bajas: number; deshechos: number };
export type ResumenLlamadas = { clave: string; llamadas: number; errores: number; coste: Record<string, number> };
export type ResumenPulso = {
  horas: number;
  incluirPropio: boolean;
  feedback: ResumenSuperficie[];
  /** Promedio de todas las calificaciones contadas (el que mira la alerta) y cuántas son. */
  promedioGeneral: number | null;
  calificadosGeneral: number;
  plan: Array<{ estado: string; motor: string; cuantos: number }>;
  erroresPlan: number;
  banderaFallida: Record<string, number>;
  llamadas: ResumenLlamadas[];
  erroresLlamadas: number;
  costeTotal: Record<string, number>;
  propio: { turnos: number; llamadas: number; erroresLlamadas: number };
  login: number | null;
  despliegue: Despliegue | null;
};

const redondear = (valor: number, decimales: number): number => Number(valor.toFixed(decimales));
const sumar = (a: number, b: number): number => a + b;

function resumirFeedback(filas: readonly FilaFeedback[]): { superficies: ResumenSuperficie[]; promedio: number | null; calificados: number } {
  const porProducto = new Map<string, { turnos: number; suma: number; calificados: number; distribucion: Record<number, number>; bajas: number; deshechos: number }>();
  let sumaGeneral = 0;
  let calificadosGeneral = 0;
  for (const fila of filas) {
    const acumulado = porProducto.get(fila.producto) ?? { turnos: 0, suma: 0, calificados: 0, distribucion: {}, bajas: 0, deshechos: 0 };
    acumulado.turnos += fila.cuantos;
    if (fila.deshecho) acumulado.deshechos += fila.cuantos;
    if (fila.calificacion !== null) {
      acumulado.calificados += fila.cuantos;
      acumulado.suma += fila.calificacion * fila.cuantos;
      acumulado.distribucion[fila.calificacion] = (acumulado.distribucion[fila.calificacion] ?? 0) + fila.cuantos;
      if (fila.calificacion <= 4) acumulado.bajas += fila.cuantos;
      sumaGeneral += fila.calificacion * fila.cuantos;
      calificadosGeneral += fila.cuantos;
    }
    porProducto.set(fila.producto, acumulado);
  }
  const superficies = [...porProducto.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([producto, a]) => ({
    producto, turnos: a.turnos, calificados: a.calificados, promedio: a.calificados ? redondear(a.suma / a.calificados, 2) : null, distribucion: a.distribucion, bajas: a.bajas, deshechos: a.deshechos,
  }));
  return { superficies, promedio: calificadosGeneral ? redondear(sumaGeneral / calificadosGeneral, 2) : null, calificados: calificadosGeneral };
}

const esErrorDePlan = (fila: FilaPlan): boolean => ESTADOS_PLAN_5XX.has(fila.estado) || RAZONES_PLAN_5XX.has(fila.razon);

function resumirPlan(filas: readonly FilaPlan[]) {
  const grupos = new Map<string, { estado: string; motor: string; cuantos: number }>();
  const banderaFallida: Record<string, number> = {};
  for (const fila of filas) {
    const clave = `${fila.estado}|${fila.motor}`;
    const grupo = grupos.get(clave) ?? { estado: fila.estado, motor: fila.motor, cuantos: 0 };
    grupo.cuantos += fila.cuantos;
    grupos.set(clave, grupo);
    // `bandera_python` no es un fallo: es la bandera diciendo python. Las demás `bandera_*` son lecturas que el cliente no logró.
    if (fila.razon.startsWith("bandera_") && fila.razon !== "bandera_python") banderaFallida[fila.razon] = (banderaFallida[fila.razon] ?? 0) + fila.cuantos;
  }
  return {
    plan: [...grupos.values()].sort((a, b) => b.cuantos - a.cuantos || a.estado.localeCompare(b.estado)),
    erroresPlan: filas.filter(esErrorDePlan).map((fila) => fila.cuantos).reduce(sumar, 0),
    banderaFallida,
  };
}

function sumarCoste(destino: Record<string, number>, fila: FilaLlamada): void {
  if (fila.moneda && fila.coste > 0) destino[fila.moneda] = (destino[fila.moneda] ?? 0) + fila.coste;
}

function resumirLlamadas(filas: readonly FilaLlamada[]) {
  const grupos = new Map<string, ResumenLlamadas>();
  const costeTotal: Record<string, number> = {};
  let erroresLlamadas = 0;
  for (const fila of filas) {
    const clave = `${fila.proveedor}/${fila.modelo} · ${fila.superficie}`;
    const grupo = grupos.get(clave) ?? { clave, llamadas: 0, errores: 0, coste: {} };
    grupo.llamadas += fila.cuantos;
    if (RESULTADOS_LLAMADA_5XX.has(fila.resultado)) { grupo.errores += fila.cuantos; erroresLlamadas += fila.cuantos; }
    sumarCoste(grupo.coste, fila);
    sumarCoste(costeTotal, fila);
    grupos.set(clave, grupo);
  }
  return { llamadas: [...grupos.values()].sort((a, b) => b.llamadas - a.llamadas || a.clave.localeCompare(b.clave)), erroresLlamadas, costeTotal };
}

/** Separa lo propio (la sesión local `+local`, el proveedor local `anthropic`) de lo real, salvo con `incluirPropio`. */
export function resumirPulso(datos: DatosPulso): ResumenPulso {
  const cuenta = <T extends { propio: boolean }>(filas: readonly T[]): T[] => (datos.incluirPropio ? [...filas] : filas.filter((fila) => !fila.propio));
  const feedback = resumirFeedback(cuenta(datos.feedback));
  const plan = resumirPlan(datos.plan);
  const llamadas = resumirLlamadas(cuenta(datos.llamadas));
  const propias = datos.incluirPropio ? [] : datos.llamadas.filter((fila) => fila.propio);
  return {
    horas: datos.horas, incluirPropio: datos.incluirPropio,
    feedback: feedback.superficies, promedioGeneral: feedback.promedio, calificadosGeneral: feedback.calificados,
    ...plan, ...llamadas,
    propio: {
      turnos: datos.incluirPropio ? 0 : datos.feedback.filter((fila) => fila.propio).map((fila) => fila.cuantos).reduce(sumar, 0),
      llamadas: propias.map((fila) => fila.cuantos).reduce(sumar, 0),
      erroresLlamadas: propias.filter((fila) => RESULTADOS_LLAMADA_5XX.has(fila.resultado)).map((fila) => fila.cuantos).reduce(sumar, 0),
    },
    login: datos.login, despliegue: datos.despliegue,
  };
}

export function evaluarAlertas(resumen: ResumenPulso): string[] {
  const alertas: string[] = [];
  const errores = resumen.erroresPlan + resumen.erroresLlamadas;
  if (errores > UMBRAL_ERRORES) alertas.push(`${errores} filas de error (plan_audit_log ${resumen.erroresPlan} + ai_call_log ${resumen.erroresLlamadas}) en ${resumen.horas} h; el umbral es ${UMBRAL_ERRORES}.`);
  if (resumen.promedioGeneral !== null && resumen.calificadosGeneral >= MIN_CALIFICACIONES && resumen.promedioGeneral < UMBRAL_PROMEDIO) {
    alertas.push(`calificación promedio ${resumen.promedioGeneral} con ${resumen.calificadosGeneral} calificaciones; el piso es ${UMBRAL_PROMEDIO}.`);
  }
  for (const [razon, cuantos] of Object.entries(resumen.banderaFallida).sort(([a], [b]) => a.localeCompare(b))) {
    alertas.push(`${cuantos} planes de la guiada cayeron a Python sin leer la bandera (${razon}).`);
  }
  if (resumen.login === null || !ESTADOS_LOGIN_SANOS.includes(resumen.login)) alertas.push(`/login respondió ${resumen.login ?? "nada"}; se esperaba ${ESTADOS_LOGIN_SANOS.join(" o ")}.`);
  return alertas;
}

const texto = (valor: number | null): string => (valor === null ? "-" : String(valor));
const dinero = (coste: Record<string, number>): string => {
  const partes = Object.entries(coste).sort(([a], [b]) => a.localeCompare(b)).map(([moneda, valor]) => `${moneda} ${valor.toFixed(4)}`);
  return partes.length ? partes.join(" + ") : "n/d";
};
const distribucion = (conteo: Record<number, number>): string => Object.entries(conteo).map(([nota, cuantos]) => [Number(nota), cuantos] as const).sort(([a], [b]) => a - b).map(([nota, cuantos]) => `${nota}:${cuantos}`).join(" ") || "-";

function recortar(lineas: string[], maximo = MAX_LINEAS_POR_SECCION): string[] {
  return lineas.length <= maximo ? lineas : [...lineas.slice(0, maximo - 1), `  +${lineas.length - maximo + 1} más`];
}

export function formatearPulso(resumen: ResumenPulso, alertas: readonly string[], ahora: Date): string[] {
  const lineas: string[] = [];
  lineas.push(`PULSO ${ahora.toISOString().slice(0, 16)}Z · últimas ${resumen.horas} h · ${resumen.incluirPropio ? "incluye lo propio" : "sin lo propio (+local, anthropic)"}`);
  lineas.push("FEEDBACK (turnos con actividad)");
  lineas.push(...(resumen.feedback.length
    ? recortar(resumen.feedback.map((s) => `  ${s.producto}: ${s.turnos} turnos, ${s.calificados} calificados, prom ${texto(s.promedio)}, dist ${distribucion(s.distribucion)}, ≤4: ${s.bajas}, deshechos: ${s.deshechos}`))
    : ["  sin turnos"]));
  lineas.push(`PLAN_AUDIT (no marca versión: incluye lo propio) · errores 5xx: ${resumen.erroresPlan}`);
  lineas.push(...(resumen.plan.length ? recortar(resumen.plan.map((g) => `  ${g.estado} · ${g.motor}: ${g.cuantos}`), 5) : ["  sin filas"]));
  lineas.push(`IA (ai_call_log) · errores: ${resumen.erroresLlamadas} · coste estimado ${dinero(resumen.costeTotal)}`);
  lineas.push(...(resumen.llamadas.length
    ? recortar(resumen.llamadas.map((g) => `  ${g.clave}: ${g.llamadas} llamadas, ${g.errores} err, ${dinero(g.coste)}`), 5)
    : ["  sin llamadas"]));
  if (!resumen.incluirPropio) lineas.push(`PROPIO (no cuenta): ${resumen.propio.turnos} turnos locales; ${resumen.propio.llamadas} llamadas de anthropic (${resumen.propio.erroresLlamadas} con error)`);
  lineas.push(`SONDAS: /login ${resumen.login ?? "sin respuesta"} · producción en Vercel: ${resumen.despliegue ? `${resumen.despliegue.estado} (hace ${resumen.despliegue.edad})` : "no se pudo leer"}`);
  lineas.push(alertas.length ? "ESTADO: ALERTA" : "ESTADO: sano");
  lineas.push(...alertas.map((alerta) => `ALERTA: ${alerta}`));
  return lineas;
}

const SECUENCIA_DE_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** El despliegue de producción más reciente en la salida de `vercel ls` (la tabla ya viene del más nuevo al más viejo). */
export function ultimoDespliegueDeProduccion(salida: string): Despliegue | null {
  for (const linea of salida.replace(SECUENCIA_DE_COLOR, "").split(/\r?\n/)) {
    const lectura = /^\s*(\S+)\s+\S+\s+\S+\s+●\s*(.+?)\s{2,}Production\b/.exec(linea);
    if (lectura) return { edad: lectura[1]!, estado: lectura[2]!.trim() };
  }
  return null;
}
