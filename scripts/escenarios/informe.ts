import { generarLote, type Escenario } from "./generador";
import { clasesDe, correr, minimizar, type Resultado } from "./matriz";
import { INVARIANTES, PRESUPUESTO_MS, type Invariante } from "./invariantes";

/**
 * **El barrido de la matriz como función pura** (sin consola ni disco): genera `n` escenarios, los pasa por `ejecutar` (por
 * defecto, la fachada real con los invariantes) y agrega el informe. `correr.ts` lo imprime y lo escribe; la prueba de humo
 * inyecta un `ejecutar` que planta un fallo para comprobar que el informe lo recoge.
 */

const pct = (parte: number, total: number): string => (total ? `${((100 * parte) / total).toFixed(1)}%` : "-");

function percentil(valores: number[], p: number): number {
  if (!valores.length) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)]!;
}

const sumar = (mapa: Map<string, number>, clave: string): void => void mapa.set(clave, (mapa.get(clave) ?? 0) + 1);

type Clase = { escenarios: number; ejemplo: string; primero?: Escenario };
type Cubo = { n: number; pasan: number };

export type OpcionesBarrido = {
  n: number;
  semilla: number;
  ejecutar?: (escenario: Escenario) => Resultado;
  /** Reducir cada clase a un repro mínimo cuesta una fachada por intento; la prueba rápida lo omite. */
  conRepro?: boolean;
};

const tasas = (mapa: Map<string, Cubo>): Record<string, Cubo & { tasa: string }> =>
  Object.fromEntries([...mapa.entries()].sort().map(([k, v]) => [k, { ...v, tasa: pct(v.pasan, v.n) }]));

export function barrer({ n, semilla, ejecutar = (e) => correr(e), conRepro = true }: OpcionesBarrido) {
  const porInvariante = Object.fromEntries(INVARIANTES.map((i) => [i, { pasa: 0, falla: 0 }])) as Record<Invariante, { pasa: number; falla: number }>;
  const porEstructura = new Map<string, Cubo>();
  const porSala = new Map<string, Cubo>();
  const celdas = new Map<string, number>();
  const sinBanda = new Map<string, number>();
  const clases = new Map<string, Clase>();
  const tiempos: number[] = [];
  const fallidos: string[] = [];
  let rechazados = 0, pasan = 0, piezasSinBanda = 0;
  const inicio = Date.now();

  for (const escenario of generarLote(semilla, n)) {
    const r = ejecutar(escenario);
    if (r.rechazoEsquema) rechazados++;
    piezasSinBanda += r.sinBanda.length;
    r.sinBanda.forEach((etiqueta) => sumar(sinBanda, etiqueta));
    r.celdasComprobadas.forEach((celda) => sumar(celdas, celda));
    tiempos.push(r.tiempoMs);
    const principal = escenario.espec.piezas[0]!.oficial;
    const bucket = porEstructura.get(principal) ?? { n: 0, pasan: 0 };
    bucket.n++;
    const ok = r.chequeos.every((c) => c.clases.length === 0);
    for (const c of r.chequeos) porInvariante[c.invariante][c.clases.length ? "falla" : "pasa"]++;
    if (ok) { pasan++; bucket.pasan++; } else fallidos.push(escenario.id);
    porEstructura.set(principal, bucket);
    const sala = r.anchoSalaCm === null ? "?" : r.anchoSalaCm <= 600 ? "ancho<=600" : r.anchoSalaCm <= 900 ? "ancho 601-900" : "ancho>900";
    const deSala = porSala.get(sala) ?? { n: 0, pasan: 0 };
    deSala.n++;
    if (ok) deSala.pasan++;
    porSala.set(sala, deSala);
    for (const clase of new Set(clasesDe(r))) {
      const actual = clases.get(clase) ?? { escenarios: 0, ejemplo: escenario.id };
      actual.escenarios++;
      actual.primero ??= escenario;
      clases.set(clase, actual);
    }
  }

  const informeClases = Object.fromEntries([...clases.entries()].sort((a, b) => b[1].escenarios - a[1].escenarios).map(([clase, v]) => [
    clase,
    { escenarios: v.escenarios, ejemplo: v.ejemplo, semilla, repro: conRepro && v.primero ? minimizar(v.primero, clase) : null },
  ]));

  return {
    version: "matriz-escenarios.v2", generado: new Date().toISOString(), semilla, n,
    validos: n - rechazados, rechazadosPorEsquema: rechazados, pasan, tasaGlobal: pct(pasan, n),
    presupuestoTiempoMs: PRESUPUESTO_MS,
    tiempoFachadaMs: { p50: Math.round(percentil(tiempos, 50)), p95: Math.round(percentil(tiempos, 95)), max: Math.round(Math.max(0, ...tiempos)) },
    piezasSinBanda, sinBandaPorEstructura: Object.fromEntries([...sinBanda.entries()].sort((a, b) => b[1] - a[1])),
    celdasComprobadas: Object.fromEntries([...celdas.entries()].sort()),
    duracionS: Math.round((Date.now() - inicio) / 1000),
    porInvariante: Object.fromEntries(Object.entries(porInvariante).map(([k, v]) => [k, { ...v, tasa: pct(v.pasa, n) }])),
    porEstructura: tasas(porEstructura),
    porSala: tasas(porSala),
    clases: informeClases,
    escenariosFallidos: fallidos.slice(0, 500),
  };
}

export type InformeBarrido = ReturnType<typeof barrer>;
