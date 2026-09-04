import fs from "node:fs";
import path from "node:path";
import { PlanDecoracionSchema, type PlanDecoracion, type EstructuraPlan } from "../src/lib/plan/tipos";

/**
 * Evaluador de variedad composicional (PLAN-COMPOSICION-RICA-V001.md §3.1,
 * §11.7; continúa WP-0.1 de PLAN-COMPOSICION-Y-CELEBRACIONES-V001.md).
 *
 * Modos:
 *   --fixtures         Sin red. Corre sobre los fixtures de este archivo.
 *                       Es el modo de Fase 0: publica la línea base ANTES de
 *                       tocar el planificador.
 *   --replay <archivo>  Sin red. Recalcula las métricas sobre un corpus de
 *                       planes ya capturado (JSON: PlanDecoracion[]).
 *
 * `--live` (Gemini planificador, nunca fal.ai) no está implementado todavía:
 * requiere el anchor-first prompting de Fase 5. Este script solo mide lo que
 * el sistema puede producir HOY (Plan 1.0), para tener con qué comparar
 * cuando cambie el planificador.
 *
 * Los fixtures de abajo son ESCRITOS A MANO para aproximar el patrón
 * documentado en PLAN-COMPOSICION-Y-CELEBRACIONES-V001.md (arco + dos
 * columnas dominante, ver B1-B7). No son salida real capturada de Gemini:
 * eso es exactamente lo que `--replay` reemplaza en cuanto exista un
 * manifiesto de planes reales.
 *
 *   npx tsx scripts/eval-variedad-composicion.ts --fixtures
 *   npx tsx scripts/eval-variedad-composicion.ts --replay reports/variedad-composicion/corpus.json
 */

type Franja = "bajo" | "medio" | "alto";

type BriefFixture = {
  id: string;
  celebracion: string;
  franja: Franja;
  plan: PlanDecoracion;
};

let contadorId = 0;
/** UUIDs deterministas y distintos entre sí — no hace falta aleatoriedad para fixtures fijos. */
const ID = () => {
  contadorId += 1;
  return `00000000-0000-4000-8000-${contadorId.toString().padStart(12, "0")}`;
};

function estructura(over: Partial<EstructuraPlan> & Pick<EstructuraPlan, "estructura_id" | "tipo" | "ubicacion" | "rol_escena">): EstructuraPlan {
  return {
    nombre: over.nombre ?? over.tipo,
    medidas: { ancho_m: 2, alto_m: 2 },
    repeticiones: 1,
    densidad: "media",
    mezcla: "organica_fina",
    materiales: [{ product_id: "P-1", participacion: 1, rol_material: "principal" as const }],
    porque: "fixture",
    ...over,
  } as EstructuraPlan;
}

function planArcoColumnas(id: string, paleta: string[]): PlanDecoracion {
  return PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: ID(),
    concepto: { titulo: id, descripcion: "Arco focal con dos columnas laterales.", paleta },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras: [
      estructura({ estructura_id: "EST_01_ARCO", tipo: "arco", ubicacion: "arco_central", rol_escena: "focal" }),
      estructura({ estructura_id: "EST_02_COL", tipo: "columna", ubicacion: "lateral_izquierdo", rol_escena: "soporte" }),
      estructura({ estructura_id: "EST_03_COL", tipo: "columna", ubicacion: "lateral_derecho", rol_escena: "soporte" }),
    ],
    supuestos: [],
  });
}

/**
 * Los doce briefs de Fase 0: cuatro repiten el patrón dominante conocido con
 * distinta paleta (para medir colisión entre celebraciones distintas), y
 * ocho varían tipo/ubicación dentro de lo que Plan 1.0 puede expresar hoy —
 * sin inventar relaciones físicas ni escultura, que todavía no existen en
 * producción.
 */
const FIXTURES: BriefFixture[] = [
  { id: "cumpleanos-infantil-medio", celebracion: "cumpleanos_infantil", franja: "medio", plan: planArcoColumnas("Cumpleaños infantil", ["azul", "amarillo"]) },
  { id: "xv-anos-alto", celebracion: "xv_anos", franja: "alto", plan: planArcoColumnas("XV años", ["rosa", "dorado"]) },
  { id: "boda-alto", celebracion: "boda", franja: "alto", plan: planArcoColumnas("Boda", ["blanco", "verde"]) },
  { id: "baby-shower-medio", celebracion: "baby_shower", franja: "medio", plan: planArcoColumnas("Baby shower", ["amarillo", "blanco"]) },
  {
    id: "corporativo-alto-backdrop",
    celebracion: "corporativo",
    franja: "alto",
    plan: PlanDecoracionSchema.parse({
      plan_version: "1.0", plan_id: ID(),
      concepto: { titulo: "Lanzamiento corporativo", descripcion: "Backdrop de marca con acentos.", paleta: ["negro", "dorado"] },
      espacio: { tipo: "salón de eventos", fuente: "supuesto" },
      estructuras: [
        estructura({ estructura_id: "EST_01_BACKDROP", tipo: "backdrop", ubicacion: "fondo_pared", rol_escena: "focal", unidades_declaradas: 1, materiales: [{ product_id: "P-1", variant_id: "V-1", participacion: 1, rol_material: "principal" }] }),
        estructura({ estructura_id: "EST_02_CENTRO", tipo: "centro_mesa", ubicacion: "mesas_invitados", rol_escena: "acento" }),
      ],
      supuestos: [],
    }),
  },
  {
    id: "halloween-medio-guirnalda-entrada",
    celebracion: "halloween",
    franja: "medio",
    plan: PlanDecoracionSchema.parse({
      plan_version: "1.0", plan_id: ID(),
      concepto: { titulo: "Halloween", descripcion: "Guirnalda de entrada.", paleta: ["negro", "naranja"] },
      espacio: { tipo: "porche", fuente: "cliente" },
      estructuras: [estructura({ estructura_id: "EST_01_GUIRNALDA", tipo: "guirnalda", ubicacion: "entrada", rol_escena: "focal" })],
      supuestos: [],
    }),
  },
  {
    id: "navidad-bajo-pieza-unica",
    celebracion: "navidad",
    franja: "bajo",
    plan: PlanDecoracionSchema.parse({
      plan_version: "1.0", plan_id: ID(),
      concepto: { titulo: "Navidad", descripcion: "Pieza única sobre la mesa.", paleta: ["rojo", "verde"] },
      espacio: { tipo: "apartamento", fuente: "supuesto" },
      estructuras: [estructura({ estructura_id: "EST_01_CENTRO", tipo: "centro_mesa", ubicacion: "sobre_mesa_principal", rol_escena: "focal" })],
      supuestos: [],
    }),
  },
  {
    id: "graduacion-medio-pared",
    celebracion: "graduacion",
    franja: "medio",
    plan: PlanDecoracionSchema.parse({
      plan_version: "1.0", plan_id: ID(),
      concepto: { titulo: "Graduación", descripcion: "Muro de globos como fondo de fotos.", paleta: ["azul", "blanco"] },
      espacio: { tipo: "salón", fuente: "supuesto" },
      estructuras: [
        estructura({ estructura_id: "EST_01_PARED", tipo: "pared", ubicacion: "fondo_pared", rol_escena: "focal" }),
        estructura({ estructura_id: "EST_02_COL", tipo: "columna", ubicacion: "lateral_izquierdo", rol_escena: "acento" }),
      ],
      supuestos: [],
    }),
  },
  { id: "aniversario-alto", celebracion: "aniversario", franja: "alto", plan: planArcoColumnas("Aniversario", ["vino", "dorado"]) },
  {
    id: "san-valentin-bajo-semiarco",
    celebracion: "san_valentin",
    franja: "bajo",
    plan: PlanDecoracionSchema.parse({
      plan_version: "1.0", plan_id: ID(),
      concepto: { titulo: "San Valentín", descripcion: "Semiarco sobre la mesa principal.", paleta: ["rojo", "blanco"] },
      espacio: { tipo: "restaurante", fuente: "supuesto" },
      estructuras: [estructura({ estructura_id: "EST_01_SEMIARCO", tipo: "semiarco", ubicacion: "sobre_mesa_principal", rol_escena: "focal" })],
      supuestos: [],
    }),
  },
  {
    id: "revelacion-genero-medio-kit-techo",
    celebracion: "revelacion_genero",
    franja: "medio",
    plan: PlanDecoracionSchema.parse({
      plan_version: "1.0", plan_id: ID(),
      concepto: { titulo: "Revelación de género", descripcion: "Kit colgante desde el techo.", paleta: ["rosa", "azul"] },
      espacio: { tipo: "jardín", fuente: "supuesto" },
      estructuras: [estructura({ estructura_id: "EST_01_KIT", tipo: "kit", ubicacion: "techo", rol_escena: "focal", unidades_declaradas: 1, materiales: [{ product_id: "P-1", variant_id: "V-1", participacion: 1, rol_material: "principal" }] })],
      supuestos: [],
    }),
  },
  { id: "bautizo-medio", celebracion: "bautizo", franja: "medio", plan: planArcoColumnas("Bautizo", ["blanco", "celeste"]) },
  {
    id: "cumpleanos-adulto-bajo-accesorio",
    celebracion: "cumpleanos_adulto",
    franja: "bajo",
    plan: PlanDecoracionSchema.parse({
      plan_version: "1.0", plan_id: ID(),
      concepto: { titulo: "Cumpleaños adulto", descripcion: "Un accesorio sobre la mesa.", paleta: ["negro", "dorado"] },
      espacio: { tipo: "casa", fuente: "supuesto" },
      estructuras: [estructura({ estructura_id: "EST_01_ACCESORIO", tipo: "accesorio", ubicacion: "sobre_mesa_principal", rol_escena: "focal", unidades_declaradas: 1, materiales: [{ product_id: "P-1", variant_id: "V-1", participacion: 1, rol_material: "principal" }] })],
      supuestos: [],
    }),
  },
];

// ---------------------------------------------------------------------------
// Firma rica (§11.7). Con Plan 1.0 solo hay tipo+ubicación por elemento; los
// ejes de relación/target/distribución/sujeto se añaden cuando el elemento
// los declara (Plan 1.1), para que este mismo evaluador sirva sin cambios
// cuando el planificador empiece a producirlos (Fase 5).
// ---------------------------------------------------------------------------

/**
 * Forma estructural mínima común a Plan 1.0 y 1.1: Plan 1.0 nunca declara
 * `relaciones_fisicas` ni `escultura_visual`, así que estas ramas quedan
 * inertes hoy (0 en las métricas) y se activan solas cuando el planificador
 * empiece a producir Plan 1.1 (Fase 5), sin tocar este evaluador.
 */
type EstructuraFirmable = {
  tipo: string;
  ubicacion: string;
  relaciones_fisicas?: Array<{ prioridad: string; relacion: string; target: { kind: string; id: string }; distribucion?: string }>;
  escultura_visual?: { sujeto?: string };
};
type PlanFirmable = { estructuras: EstructuraFirmable[] };

function firmaEstructura(est: EstructuraFirmable): string {
  const partes: string[] = [est.tipo, est.ubicacion];
  const primaria = est.relaciones_fisicas?.find((relacion) => relacion.prioridad === "primaria");
  if (primaria) {
    partes.push(primaria.relacion, primaria.target.kind);
    if (primaria.distribucion) partes.push(primaria.distribucion);
  }
  if (est.escultura_visual?.sujeto) partes.push(`sujeto:${est.escultura_visual.sujeto}`);
  return partes.join("|");
}

function firmaPlan(plan: PlanFirmable): string {
  return plan.estructuras.map(firmaEstructura).sort().join(";");
}

const FIRMA_ARCO_COLUMNAS = ["arco|arco_central", "columna|lateral_derecho", "columna|lateral_izquierdo"].join(";");

function relacionesPrimariasDe(plan: PlanFirmable): string[] {
  return plan.estructuras.flatMap((est) =>
    (est.relaciones_fisicas ?? []).filter((relacion) => relacion.prioridad === "primaria").map((relacion) => relacion.relacion));
}

/** §3.1: dos capas de profundidad o envolvente/suspendida por sí sola, + relación no bilateral, + identidad visual específica. */
function esPlanRicoElegible(plan: PlanFirmable): boolean {
  const relacionesEnvolventes = new Set(["envolver", "colgar_de", "derramarse_sobre"]);
  const relacionesPrimarias = relacionesPrimariasDe(plan);
  const tieneEnvolvente = relacionesPrimarias.some((relacion) => relacionesEnvolventes.has(relacion));
  const tieneDosCapas = plan.estructuras.length >= 2 && tieneEnvolvente;
  const tieneRelacionNoBilateral = relacionesPrimarias.some((relacion) => relacion !== "quedar_detras_de" && relacion !== "quedar_debajo_de") || relacionesPrimarias.length > 0;
  const tieneIdentidadEspecifica = plan.estructuras.some((est) => est.tipo === "escultura" || Boolean(est.escultura_visual));
  return (tieneDosCapas || tieneEnvolvente) && tieneRelacionNoBilateral && tieneIdentidadEspecifica;
}

type Metricas = {
  n_planes: number;
  tasa_arco_columnas: number;
  colision_composicional: number;
  arquetipo_dominante: number;
  arquetipo_dominante_firma: string | null;
  cobertura_relaciones_fisicas: number;
  concentracion_relacion: number;
  planes_ricos_elegibles: number;
  planes_ricos_elegibles_base: number;
  tipos_distintos_usados: string[];
};

function calcularMetricas(fixtures: BriefFixture[]): Metricas {
  const firmas = fixtures.map((fixture) => firmaPlan(fixture.plan));
  const nPlanes = fixtures.length;

  const tasaArcoColumnas = firmas.filter((firma) => firma === FIRMA_ARCO_COLUMNAS).length / nPlanes;

  let paresColisionados = 0;
  let paresDistintaCelebracion = 0;
  for (let i = 0; i < fixtures.length; i++) {
    for (let j = i + 1; j < fixtures.length; j++) {
      if (fixtures[i]!.celebracion === fixtures[j]!.celebracion) continue;
      paresDistintaCelebracion++;
      if (firmas[i] === firmas[j]) paresColisionados++;
    }
  }
  const colisionComposicional = paresDistintaCelebracion > 0 ? paresColisionados / paresDistintaCelebracion : 0;

  const conteoFirmas = new Map<string, number>();
  for (const firma of firmas) conteoFirmas.set(firma, (conteoFirmas.get(firma) ?? 0) + 1);
  const [firmaDominante, conteoDominante] = [...conteoFirmas.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const arquetipoDominante = conteoDominante / nPlanes;

  const relacionesTotales = fixtures.flatMap((fixture) => relacionesPrimariasDe(fixture.plan));
  const relacionesDistintas = new Set(relacionesTotales);
  const conteoRelacion = new Map<string, number>();
  for (const relacion of relacionesTotales) conteoRelacion.set(relacion, (conteoRelacion.get(relacion) ?? 0) + 1);
  const concentracionRelacion = relacionesTotales.length > 0 ? Math.max(...conteoRelacion.values()) / relacionesTotales.length : 0;

  const planesMedioAlto = fixtures.filter((fixture) => fixture.franja !== "bajo");
  const planesRicos = planesMedioAlto.filter((fixture) => esPlanRicoElegible(fixture.plan));

  return {
    n_planes: nPlanes,
    tasa_arco_columnas: tasaArcoColumnas,
    colision_composicional: colisionComposicional,
    arquetipo_dominante: arquetipoDominante,
    arquetipo_dominante_firma: firmaDominante ?? null,
    cobertura_relaciones_fisicas: relacionesDistintas.size,
    concentracion_relacion: concentracionRelacion,
    planes_ricos_elegibles: planesMedioAlto.length > 0 ? planesRicos.length / planesMedioAlto.length : 0,
    planes_ricos_elegibles_base: planesMedioAlto.length,
    tipos_distintos_usados: [...new Set(fixtures.flatMap((fixture) => fixture.plan.estructuras.map((est) => est.tipo)))].sort(),
  };
}

function cargarCorpusDeArchivo(rutaArchivo: string): BriefFixture[] {
  const crudo = JSON.parse(fs.readFileSync(rutaArchivo, "utf8")) as Array<{ id: string; celebracion: string; franja: Franja; plan: unknown }>;
  return crudo.map((entrada) => ({ ...entrada, plan: PlanDecoracionSchema.parse(entrada.plan) }));
}

function main(): void {
  const argRelay = process.argv.indexOf("--replay");
  const fixtures = argRelay >= 0 ? cargarCorpusDeArchivo(process.argv[argRelay + 1]!) : FIXTURES;
  const modo = argRelay >= 0 ? "replay" : "fixtures";

  if (process.argv.includes("--live")) {
    throw new Error("MODO_LIVE_NO_IMPLEMENTADO: --live requiere el prompting anchor-first de Fase 5 (PLAN-COMPOSICION-RICA-V001.md §13). Usa --fixtures o --replay.");
  }

  const metricas = calcularMetricas(fixtures);
  const reporte = {
    fecha: new Date().toISOString(),
    modo,
    fuente: modo === "fixtures"
      ? "Fixtures escritos a mano (este archivo), no captura real del planificador. Ver comentario de cabecera."
      : `--replay ${process.argv[argRelay + 1]}`,
    metricas,
    briefs: fixtures.map((fixture) => ({ id: fixture.id, celebracion: fixture.celebracion, franja: fixture.franja, firma: firmaPlan(fixture.plan) })),
  };

  const outDir = path.join(process.cwd(), "reports/variedad-composicion");
  fs.mkdirSync(outDir, { recursive: true });
  const fecha = new Date().toISOString().slice(0, 10);
  const rutaSalida = path.join(outDir, `${fecha}.json`);
  fs.writeFileSync(rutaSalida, JSON.stringify(reporte, null, 2));

  console.log(`[eval-variedad-composicion] modo=${modo} n=${metricas.n_planes}`);
  console.log(`  tasa_arco_columnas        = ${(metricas.tasa_arco_columnas * 100).toFixed(1)}% (objetivo Fase 5: < 20%)`);
  console.log(`  colision_composicional    = ${(metricas.colision_composicional * 100).toFixed(1)}% (objetivo Fase 5: < 25%)`);
  console.log(`  arquetipo_dominante       = ${(metricas.arquetipo_dominante * 100).toFixed(1)}% — "${metricas.arquetipo_dominante_firma}" (objetivo Fase 5: < 35%)`);
  console.log(`  cobertura_relaciones_fisicas = ${metricas.cobertura_relaciones_fisicas} (objetivo Fase 5: >= 6; Plan 1.0 no las declara, así que hoy es 0)`);
  console.log(`  concentracion_relacion    = ${(metricas.concentracion_relacion * 100).toFixed(1)}%`);
  console.log(`  planes_ricos_elegibles    = ${(metricas.planes_ricos_elegibles * 100).toFixed(1)}% de ${metricas.planes_ricos_elegibles_base} planes medio/alto (objetivo Fase 5: >= 70%)`);
  console.log(`  tipos_distintos_usados    = ${metricas.tipos_distintos_usados.join(", ")}`);
  console.log(`reporte en ${path.relative(process.cwd(), rutaSalida)}`);
}

main();
