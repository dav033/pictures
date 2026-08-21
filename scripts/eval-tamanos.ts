import { existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { Pool } from "pg";
import { buscarCatalogoRag } from "../src/lib/rag/chat/buscar";
import { interpretarConsulta } from "../src/lib/rag/query-parser/parse";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

/**
 * Baseline/regresión de discriminación de tamaños (PLAN_TAMANOS_GLOBO.md F0/F6).
 * Mide, a nivel de retrieval (sin pasar por el LLM de chat completo — más
 * rápido y determinístico), si "R-5"/"5 pulgadas"/etc. en el mensaje del
 * cliente cambia en algo el conjunto de variantes que puede ver el modelo.
 * Antes de F2, la respuesta esperada es "no" — eso es justo lo que este
 * script debe demostrar como baseline, no un bug del script.
 */

type CasoTamano = {
  mensaje: string;
  tamanoEsperado: string; // código de catálogo, ej "R-5"
  diamPulgEsperado: number;
};

const CASOS: CasoTamano[] = [
  { mensaje: "quiero globos rojos de 5 pulgadas para un cumpleaños", tamanoEsperado: "R-5", diamPulgEsperado: 5 },
  { mensaje: "necesito globos dorados R-9 para una boda", tamanoEsperado: "R-9", diamPulgEsperado: 9 },
  { mensaje: "globos azules chiquitos, de los pequeñitos", tamanoEsperado: "R-5", diamPulgEsperado: 5 },
  { mensaje: "globos verdes grandes, tipo gigante", tamanoEsperado: "R-24", diamPulgEsperado: 24 },
  { mensaje: "globos blancos de 18 pulgadas para columna", tamanoEsperado: "R-18", diamPulgEsperado: 18 },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const lineas: string[] = [];
  const log = (s: string) => { console.log(s); lineas.push(s); };

  try {
    log("=== 1. Distribución de tamaños en el catálogo (Postgres, catalog_variants) ===");
    const { rows: dist } = await pool.query<{ codigo_tamano: string | null; n: string }>(
      `SELECT codigo_tamano, COUNT(*) n FROM catalog_variants WHERE available = true GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 10`,
    );
    const totalDisponibles = dist.reduce((s, r) => s + Number(r.n), 0);
    for (const r of dist) log(`  ${(r.codigo_tamano ?? "(null)").padEnd(16)} ${r.n.padStart(5)}  (${((Number(r.n) / totalDisponibles) * 100).toFixed(1)}%)`);

    log("\n=== 2. ¿El mensaje del cliente con tamaño explícito restringe las variantes candidatas? (ruta real: buscarCatalogoRag) ===");
    let mezclaTamanos = 0;
    let aciertos = 0;
    for (const caso of CASOS) {
      const respuesta = await buscarCatalogoRag(pool, caso.mensaje);
      // Lo que el LLM VE de verdad es `candidatos[].variantes` (ya recortado
      // por la whitelist de search.ts) — no todas las variantes del
      // producto en DB, que es un superconjunto y mediría otra cosa.
      const variantesVistas = respuesta.candidatos.flatMap((c) => c.variantes);
      if (variantesVistas.length === 0) { log(`  [SIN RESULTADOS] "${caso.mensaje}"`); continue; }
      const tamanosDistintos = new Set(variantesVistas.map((v) => v.codigoTamano));
      const tieneEsperado = variantesVistas.some((v) => v.codigoTamano === caso.tamanoEsperado);
      const soloEsperado = variantesVistas.every((v) => v.codigoTamano === caso.tamanoEsperado);
      if (tamanosDistintos.size > 1) mezclaTamanos++;
      if (soloEsperado && tieneEsperado) aciertos++;
      log(`  "${caso.mensaje}"`);
      log(`    esperado=${caso.tamanoEsperado} | tamaños distintos vistos por el LLM=${tamanosDistintos.size} (${[...tamanosDistintos].join(", ")}) | incluye el esperado=${tieneEsperado} | SOLO el esperado=${soloEsperado}`);
    }
    log(`\n  Casos donde el retrieval mezcla tamaños pese a pedido explícito: ${mezclaTamanos}/${CASOS.length}`);
    log(`  Casos donde el retrieval devuelve EXCLUSIVAMENTE el tamaño pedido: ${aciertos}/${CASOS.length}`);

    log("\n=== 3. ¿Existe algún filtro duro de tamaño/forma en el schema del intérprete? ===");
    const primero = await interpretarConsulta(CASOS[0].mensaje);
    const tieneCampoTamano = "tamanos" in primero.filtros_duros || "formas" in primero.filtros_duros;
    log(`  filtros_duros tiene 'tamanos'/'formas': ${tieneCampoTamano}`);
    log(`  filtros_duros real devuelto: ${JSON.stringify(primero.filtros_duros)}`);

    const fecha = new Date().toISOString().slice(0, 10);
    writeFileSync(`reports/eval-tamanos-${fecha}.txt`, lineas.join("\n") + "\n");
    log(`\n[OK] guardado en reports/eval-tamanos-${fecha}.txt`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[FAIL] eval-tamanos falló:", error);
  process.exitCode = 1;
});
