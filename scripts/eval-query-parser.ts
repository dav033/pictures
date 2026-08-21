import { existsSync } from "node:fs";
import { interpretarConsulta } from "../src/lib/rag/query-parser/parse";
import type { IntentQuery } from "../src/lib/rag/query-parser/schema";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

/**
 * Regresión del query-parser (PLAN_RENDIMIENTO_RAG.md, Fases 1-2). No existía
 * ningún test de esta pieza — eval-retrieval.ts prueba buscarHibrido
 * directamente, sin pasar por interpretarConsulta. Este script sí ejercita la
 * llamada real a Gemini con thinkingLevel="minimal" + gemini-3.5-flash-lite,
 * y verifica dos cosas que un cambio de modelo/thinking puede romper en
 * silencio: (1) que los filtros duros sigan siendo los correctos, y (2) que
 * sean ESTABLES entre repeticiones — el caso que motivó este script
 * (categorías de más en consultas donde "globos" solo se menciona de pasada)
 * era intermitente, no determinista, así que un solo intento no lo detecta.
 *
 * `undefined` en un campo esperado = no se verifica ese campo (la consulta no
 * tiene una respuesta única correcta ahí). Los campos SÍ declarados deben
 * cumplirse en las REPETICIONES corridas, todas, no solo la mayoría.
 */
type CasoEsperado = {
  mensaje: string;
  nota: string;
  intent: "product_search" | "other";
  categorias?: string[];
  ocasiones?: string[];
  colores?: string[];
  precioMax?: number | null;
  soloDisponibles?: boolean;
};

const CASOS: CasoEsperado[] = [
  {
    mensaje: "cumpleaños infantil globos dorados decoracion",
    nota: "caso de regresión: \"globos\" de pasada NO es filtro de categoría",
    intent: "product_search",
    categorias: [],
  },
  {
    mensaje: "tiene que ser dorado, sin excepción, para una boda",
    nota: "filtro duro de color explícito",
    intent: "product_search",
    colores: ["dorado"],
  },
  {
    mensaje: "preferiría algo dorado pero acepto otros colores",
    nota: "preferencia explícita, NO es filtro duro",
    intent: "product_search",
    colores: [],
  },
  {
    mensaje: "máximo 50 mil pesos para un cumpleaños",
    nota: "precio_max duro",
    intent: "product_search",
    precioMax: 50_000,
  },
  {
    mensaje: "hasta $100.000 en velas solamente",
    nota: "categoría dura explícita (\"solamente\") + precio",
    intent: "product_search",
    categorias: ["vela"],
    precioMax: 100_000,
  },
  { mensaje: "hola buenas tardes", nota: "saludo, no es búsqueda", intent: "other" },
  { mensaje: "¿tienen envíos a Medellín?", nota: "pregunta general, no es búsqueda", intent: "other" },
  {
    mensaje: "algo elegante para XV años en tonos tierra",
    nota: "estilo difuso, sin filtro duro de categoría",
    intent: "product_search",
    categorias: [],
  },
  {
    mensaje: "globos metalizados azules para baby shower",
    nota: "categoría+color+ocasión, los tres explícitos",
    intent: "product_search",
    categorias: ["globo_metalizado"],
    colores: ["azul"],
    ocasiones: ["baby_shower"],
  },
  {
    mensaje: "quiero ver productos agotados también",
    nota: "solo_disponibles=false explícito",
    intent: "product_search",
    soloDisponibles: false,
  },
  {
    mensaje: "necesito un arco de globos verde y rojo para navidad",
    nota: "categoría+colores+ocasión, los tres explícitos",
    intent: "product_search",
    categorias: ["guirnalda_arco"],
    colores: ["verde", "rojo"],
    ocasiones: ["navidad"],
  },
  {
    mensaje: "decoracion barata",
    nota: "sin cifra concreta, sin categoría",
    intent: "product_search",
    categorias: [],
  },
];

const REPETICIONES = 3;
const LATENCIA_P50_MAX_MS = 1_500;

function setEq(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
}

/** Compara solo los campos que el caso SÍ declaró. */
function comparar(caso: CasoEsperado, obtenido: IntentQuery): string[] {
  const difs: string[] = [];
  if (obtenido.intent !== caso.intent) difs.push(`intent: esperado "${caso.intent}", obtenido "${obtenido.intent}"`);
  if (caso.categorias !== undefined && !setEq(caso.categorias, obtenido.filtros_duros.categorias))
    difs.push(`categorias: esperado [${caso.categorias}], obtenido [${obtenido.filtros_duros.categorias}]`);
  if (caso.ocasiones !== undefined && !setEq(caso.ocasiones, obtenido.filtros_duros.ocasiones))
    difs.push(`ocasiones: esperado [${caso.ocasiones}], obtenido [${obtenido.filtros_duros.ocasiones}]`);
  if (caso.colores !== undefined && !setEq(caso.colores, obtenido.filtros_duros.colores))
    difs.push(`colores: esperado [${caso.colores}], obtenido [${obtenido.filtros_duros.colores}]`);
  if (caso.precioMax !== undefined && obtenido.filtros_duros.precio_max !== caso.precioMax)
    difs.push(`precio_max: esperado ${caso.precioMax}, obtenido ${obtenido.filtros_duros.precio_max}`);
  if (caso.soloDisponibles !== undefined && obtenido.filtros_duros.solo_disponibles !== caso.soloDisponibles)
    difs.push(`solo_disponibles: esperado ${caso.soloDisponibles}, obtenido ${obtenido.filtros_duros.solo_disponibles}`);
  return difs;
}

async function main() {
  console.log(`Regresión del query-parser — ${CASOS.length} casos x ${REPETICIONES} repeticiones\n`);

  const latencias: number[] = [];
  let casosEstables = 0;
  let casosConError = 0;
  const fallos: string[] = [];

  for (const caso of CASOS) {
    const corridas: { difs: string[]; ms: number }[] = [];
    for (let i = 0; i < REPETICIONES; i++) {
      const t0 = Date.now();
      try {
        const obtenido = await interpretarConsulta(caso.mensaje);
        const ms = Date.now() - t0;
        latencias.push(ms);
        corridas.push({ difs: comparar(caso, obtenido), ms });
      } catch (error) {
        casosConError++;
        corridas.push({ difs: [`ERROR: ${error instanceof Error ? error.message : error}`], ms: Date.now() - t0 });
      }
    }

    const todasLimpias = corridas.every((c) => c.difs.length === 0);
    const msPromedio = Math.round(corridas.reduce((s, c) => s + c.ms, 0) / corridas.length);

    if (todasLimpias) {
      casosEstables++;
      console.log(`  [PASS] "${caso.mensaje}" — ${caso.nota} (avg ${msPromedio}ms)`);
    } else {
      const unicos = [...new Set(corridas.flatMap((c) => c.difs))];
      const inestable = new Set(corridas.map((c) => JSON.stringify(c.difs))).size > 1;
      console.log(
        `  [FAIL${inestable ? " INESTABLE" : ""}] "${caso.mensaje}" — ${caso.nota} (avg ${msPromedio}ms)`,
      );
      for (const d of unicos) console.log(`      ${d}`);
      fallos.push(caso.mensaje);
    }
  }

  latencias.sort((a, b) => a - b);
  const p50 = latencias[Math.floor(latencias.length * 0.5)] ?? NaN;
  const p95 = latencias[Math.floor(latencias.length * 0.95)] ?? NaN;

  console.log("\n--- Resumen ---");
  console.log(`Casos estables (correctos en las ${REPETICIONES} repeticiones): ${casosEstables}/${CASOS.length}`);
  console.log(`Llamadas con error: ${casosConError}/${CASOS.length * REPETICIONES}`);
  console.log(`Latencia: p50=${p50}ms, p95=${p95}ms (n=${latencias.length})`);

  console.log("\n--- Criterios de aceptación ---");
  const todosPasan = fallos.length === 0;
  console.log(`[${todosPasan ? "PASS" : "FAIL"}] todos los casos correctos y estables en las ${REPETICIONES} repeticiones`);
  console.log(`[${casosConError === 0 ? "PASS" : "FAIL"}] cero errores de la API`);
  console.log(`[${p50 < LATENCIA_P50_MAX_MS ? "PASS" : "FAIL"}] latencia p50 < ${LATENCIA_P50_MAX_MS}ms (obtenido ${p50}ms)`);

  process.exitCode = todosPasan && casosConError === 0 && p50 < LATENCIA_P50_MAX_MS ? 0 : 1;
}

main().catch((error) => {
  console.error("[FAIL] eval-query-parser falló:", error);
  process.exitCode = 1;
});
