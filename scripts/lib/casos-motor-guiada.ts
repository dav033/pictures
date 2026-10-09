import { readFileSync } from "node:fs";
import path from "node:path";
import { ESTRUCTURAS_OFICIALES_IDS } from "../../src/lib/plan/estructuras-oficiales";
import { PlanesIdeasArchivoSchema } from "../../src/lib/plan/plan-de-idea";
import { armarDesdeEspec, especDesdePlan, especDesdePropuesta, type BomLinea, type EspecClienteV1, type ResultadoMotorV1 } from "../../src/lib/globos3d/motor/v1";
import { resolverProductoDeIdeas } from "../../src/lib/globos3d/motor/productos-ideas";
import { representacionDe, type Representacion } from "../../src/lib/globos3d/motor/representable";

/**
 * Los casos del motor 3D de la vista guiada: las 28 ideas guardadas de la biblioteca y una espec por defecto por cada
 * una de las 18 estructuras oficiales. Los comparten el generador de las fixtures doradas, su prueba y el informe de
 * cómo se representa cada idea. Sin red y sin coste.
 */
const RAIZ = path.resolve(__dirname, "..", "..");
export const DIRECTORIO_DORADO = path.join(RAIZ, "contracts", "domain", "v1", "golden", "motor-guiada");
const RUTA_PLANES = path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "planes-ideas.json");
const COLORES_POR_DEFECTO = ["azul", "blanco", "dorado"] as const;

export type CasoMotor = {
  id: string;
  espec: EspecClienteV1;
  avisosDeConversion: string[];
  /** Lo que cuenta el plan guardado, resuelto por Python (solo las ideas): para comparar, no para exigir. */
  globosPython?: number;
};

export function casosIdeas(): CasoMotor[] {
  const planes = PlanesIdeasArchivoSchema.parse(JSON.parse(readFileSync(RUTA_PLANES, "utf8")));
  return Object.entries(planes.ideas).map(([ideaId, idea]) => {
    const { espec, avisos } = especDesdePlan(idea.plan, { resolverProducto: resolverProductoDeIdeas, origen: { tipo: "idea", ideaIds: [ideaId] } });
    return { id: `idea-${ideaId}`, espec, avisosDeConversion: avisos, globosPython: idea.globos };
  });
}

export function casosOficiales(): CasoMotor[] {
  return ESTRUCTURAS_OFICIALES_IDS.map((estructura) => {
    const { espec, avisos } = especDesdePropuesta({ frase: `Te propongo ${estructura}.`, colores: [...COLORES_POR_DEFECTO], piezas: [{ estructura, cantidad: 1 }] });
    return { id: `oficial-${estructura}`, espec, avisosDeConversion: avisos };
  });
}

export const todosLosCasos = (): CasoMotor[] => [...casosIdeas(), ...casosOficiales()];

export type CajaCm = [number, number, number, number, number, number];
export type RegistroDorado = {
  caso: string;
  motor: ResultadoMotorV1["motor"];
  especHash: string;
  noRepresentable: ResultadoMotorV1["noRepresentable"];
  piezas: Record<string, { lineas: BomLinea[]; unidades: number; caja: CajaCm }>;
  total: { lineas: BomLinea[]; unidades: number };
  caja: CajaCm;
  referenciaPython?: { globos: number };
};

const unidades = (lineas: readonly BomLinea[]) => lineas.reduce((suma, l) => suma + l.cantidad, 0);

function unirCajas(cajas: readonly CajaCm[]): CajaCm {
  if (!cajas.length) return [0, 0, 0, 0, 0, 0];
  return [0, 1, 2].map((k) => Math.min(...cajas.map((c) => c[k]!))).concat([3, 4, 5].map((k) => Math.max(...cajas.map((c) => c[k]!)))) as CajaCm;
}

export function registroDorado(caso: CasoMotor, resultado: ResultadoMotorV1): RegistroDorado {
  const cajas = new Map(resultado.armada.piezas.map((p) => [p.id, p.caja as CajaCm]));
  const piezas: RegistroDorado["piezas"] = {};
  for (const [id, lineas] of Object.entries(resultado.bom.porPieza)) piezas[id] = { lineas, unidades: unidades(lineas), caja: cajas.get(id) ?? [0, 0, 0, 0, 0, 0] };
  return {
    caso: caso.id,
    motor: resultado.motor,
    especHash: resultado.especHash,
    noRepresentable: resultado.noRepresentable,
    piezas,
    total: { lineas: resultado.bom.total, unidades: unidades(resultado.bom.total) },
    caja: unirCajas([...cajas.values()]),
    ...(caso.globosPython !== undefined ? { referenciaPython: { globos: caso.globosPython } } : {}),
  };
}

export function registroDe(caso: CasoMotor): RegistroDorado {
  return registroDorado(caso, armarDesdeEspec(caso.espec));
}

export type ClasificacionIdea = { estado: Representacion["estado"]; razones: string[] };

/** Cómo se representa una espec: el peor estado de sus piezas y por qué. */
export function clasificar(espec: EspecClienteV1): ClasificacionIdea {
  const orden: Representacion["estado"][] = ["representable", "aproximada", "declarada", "fallback"];
  const piezas = espec.piezas.map((p) => ({ p, r: representacionDe(p) }));
  const estado = piezas.reduce<Representacion["estado"]>((peor, { r }) => (orden.indexOf(r.estado) > orden.indexOf(peor) ? r.estado : peor), "representable");
  return { estado, razones: piezas.filter(({ r }) => r.estado !== "representable").map(({ p, r }) => `${p.oficial}: ${r.motivo}`) };
}
