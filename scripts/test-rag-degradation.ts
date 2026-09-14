import { Pool } from "pg";
import { buscarHibrido, RagUnavailableError } from "../src/lib/rag/retrieval/search";
import type { ConsultaRetrieval } from "../src/lib/rag/retrieval/types";

/**
 * Fase 5.4 del plan de resiliencia:
 * "Postgres no disponible" tenía dos comportamientos distintos en
 * buscarHibrido() -- la rama vectorial degradaba (try/catch -> ERROR ->
 * sigue con las demás ramas), pero queryFullText/queryTrigram no tenían
 * try/catch: un fallo ahí se propagaba como throw no capturado y tumbaba
 * el turno completo. Este test inyecta el fallo real (sin apagar ningún
 * Postgres real) envolviendo pool.query para que rechace solo las consultas
 * que coinciden con el texto SQL de la rama que se quiere derribar --
 * confirma que una rama caída no oculta resultados de las otras. No fabrica
 * éxito: si todas las ramas configuradas fallan, lanza un error estable que la
 * ruta de chat traduce a RAG_UNAVAILABLE.
 */

function envolverPoolConFallo(poolReal: Pool, patronSqlAFallar: RegExp | null, mensaje: string): Pool {
  // Cast angosto y explicado: pool.query está sobrecargado en @types/pg con
  // firmas que no se dejan tipar limpiamente para un wrapper genérico de
  // pruebas. Se elimina si algún día se necesita inyectar fallos por tipo de
  // consulta en producción en vez de en un script de prueba desechable.
  const wrapper = Object.create(poolReal) as Pool;
  wrapper.query = (async (textoOConfig: unknown, params?: unknown) => {
    const sql = typeof textoOConfig === "string" ? textoOConfig : ((textoOConfig as { text?: string })?.text ?? "");
    if (patronSqlAFallar === null || patronSqlAFallar.test(sql)) throw new Error(mensaje);
    const queryReal = poolReal.query.bind(poolReal) as (a: unknown, b?: unknown) => Promise<unknown>;
    return queryReal(textoOConfig, params);
  }) as Pool["query"];
  return wrapper;
}

function leerDsnLocal(): string {
  const dsn = process.env.RAG_DEGRADATION_DATABASE_URL?.trim();
  if (!dsn) throw new Error("RAG_DEGRADATION_DATABASE_URL es obligatoria y debe apuntar a PostgreSQL local.");
  let parsed: URL;
  try {
    parsed = new URL(dsn);
  } catch {
    throw new Error("RAG_DEGRADATION_DATABASE_URL no es una URL PostgreSQL válida.");
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error("RAG_DEGRADATION_DATABASE_URL debe usar el protocolo PostgreSQL.");
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error("El arnés de degradación solo permite una base PostgreSQL loopback.");
  }
  return dsn;
}

async function main() {
  const poolReal = new Pool({ connectionString: leerDsnLocal() });
  let fallos = 0;
  const reportar = (ok: boolean, nombre: string, detalle: string) => {
    console.log(`[${ok ? "PASS" : "FAIL"}] ${nombre} — ${detalle}`);
    if (!ok) fallos++;
  };

  try {
    // Test 1: Postgres completamente caído (toda consulta rechaza), sin
    // filtros navegables -- antes de la corrección esto tumbaba el turno con
    // una excepción no capturada desde queryFullText/queryTrigram.
    const poolCaido = envolverPoolConFallo(poolReal, null, "simulated total postgres outage");
    const consultaSimple: ConsultaRetrieval = { semanticQuery: "globos plateados para cumpleaños" };
    let error1: unknown = null;
    try {
      await buscarHibrido(poolCaido, consultaSimple);
    } catch (error) {
      error1 = error;
    }
    reportar(
      error1 instanceof RagUnavailableError,
      "Test 1: Postgres totalmente caído no fabrica NO_MATCH",
      error1 instanceof Error ? `${error1.name}: ${error1.message}` : "no lanzó el error estable",
    );
    if (error1 instanceof RagUnavailableError) {
      reportar(
        error1.branchStatus.fts === "ERROR",
        "Test 1b: branchStatus.fts queda en ERROR, nunca READY, cuando la consulta FTS falla",
        `fts=${error1.branchStatus.fts}`,
      );
      reportar(
        error1.branchStatus.trigram === "ERROR",
        "Test 1c: branchStatus.trigram queda en ERROR, nunca READY, cuando la consulta trigram falla",
        `trigram=${error1.branchStatus.trigram}`,
      );
    }

    // Test 2: solo la rama FTS falla (p.ej. índice GIN corrupto o timeout en
    // esa query puntual); trigram y el resto de Postgres siguen sanos.
    const poolFtsCaido = envolverPoolConFallo(poolReal, /plainto_tsquery/, "simulated fts branch outage");
    let respuesta2: Awaited<ReturnType<typeof buscarHibrido>> | null = null;
    let lanzoExcepcion2 = false;
    try {
      respuesta2 = await buscarHibrido(poolFtsCaido, consultaSimple);
    } catch {
      lanzoExcepcion2 = true;
    }
    reportar(
      !lanzoExcepcion2 && respuesta2 !== null,
      "Test 2: solo FTS caído no tumba el turno",
      lanzoExcepcion2 ? "lanzó excepción no capturada" : `branchStatus=${JSON.stringify(respuesta2?.branchStatus)}`,
    );
    if (respuesta2) {
      reportar(
        respuesta2.branchStatus?.fts === "ERROR",
        "Test 2b: branchStatus.fts = ERROR cuando solo esa rama falla",
        `fts=${respuesta2.branchStatus?.fts}`,
      );
      reportar(
        respuesta2.branchStatus?.trigram === "READY" || respuesta2.branchStatus?.trigram === "EMPTY",
        "Test 2c: branchStatus.trigram sigue reportando su estado real (READY/EMPTY), no arrastrado a ERROR por la caída de FTS",
        `trigram=${respuesta2.branchStatus?.trigram}`,
      );
    }

    // Test 3: solo la rama trigram falla; FTS y el resto de Postgres sanos.
    const poolTrigramCaido = envolverPoolConFallo(poolReal, /title_candidates/, "simulated trigram branch outage");
    let respuesta3: Awaited<ReturnType<typeof buscarHibrido>> | null = null;
    let lanzoExcepcion3 = false;
    try {
      respuesta3 = await buscarHibrido(poolTrigramCaido, consultaSimple);
    } catch {
      lanzoExcepcion3 = true;
    }
    reportar(
      !lanzoExcepcion3 && respuesta3 !== null,
      "Test 3: solo trigram caído no tumba el turno",
      lanzoExcepcion3 ? "lanzó excepción no capturada" : `branchStatus=${JSON.stringify(respuesta3?.branchStatus)}`,
    );
    if (respuesta3) {
      reportar(
        respuesta3.branchStatus?.trigram === "ERROR",
        "Test 3b: branchStatus.trigram = ERROR cuando solo esa rama falla",
        `trigram=${respuesta3.branchStatus?.trigram}`,
      );
      reportar(
        respuesta3.branchStatus?.fts === "READY" || respuesta3.branchStatus?.fts === "EMPTY",
        "Test 3c: branchStatus.fts sigue reportando su estado real, no arrastrado a ERROR por la caída de trigram",
        `fts=${respuesta3.branchStatus?.fts}`,
      );
    }

    // Test 4: control -- con Postgres sano de verdad, ambas ramas deben
    // reportar READY/EMPTY (nunca ERROR) para la misma consulta. Confirma que
    // el arnés de fallo inyectado en los tests 1-3 es la única causa del
    // ERROR observado ahí, no un efecto secundario del wrapper en sí.
    const consultaControl: ConsultaRetrieval = { semanticQuery: "globos plateados para cumpleaños" };
    const respuestaControl = await buscarHibrido(poolReal, consultaControl);
    reportar(
      respuestaControl.branchStatus?.fts !== "ERROR" && respuestaControl.branchStatus?.trigram !== "ERROR",
      "Test 4: control con Postgres sano -- ninguna rama reporta ERROR",
      `branchStatus=${JSON.stringify(respuestaControl.branchStatus)}`,
    );
  } finally {
    await poolReal.end();
  }

  console.log(`\n${fallos === 0 ? "OK" : `${fallos} FALLO(S)`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
