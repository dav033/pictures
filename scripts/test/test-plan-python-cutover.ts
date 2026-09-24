import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { abrirContextoPlan } from "../../src/lib/plan/aprobacion";
import { crearEstadoConversacion, crearRegistroHerramientas } from "../../src/lib/ia/herramientas/registro-herramientas";
import { isPythonAdapterError } from "../../src/lib/ia/nucleo/python-adapter";
import { decidirSmoke, exigirReadyz, problemaPostgresLocal } from "../lib/python-smoke-preflight";

function esObjeto(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objetos(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !esObjeto(item))) {
    throw new Error(`${label} no es una lista de objetos`);
  }
  return value;
}

function texto(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} no es texto válido`);
  return value;
}

function planDeHerramienta(productId: string): Record<string, unknown> {
  return {
    concepto: {
      titulo: "Smoke test de conversación Python",
      descripcion: "Plan local producido después de una búsqueda real.",
      paleta: [],
    },
    espacio: { tipo: "salon", fuente: "supuesto" },
    estructuras: [1, 2, 3].map((index) => ({
      estructura_id: `EST_0${index}_SMOKE`,
      nombre: `Arco de conversación ${index}`,
      tipo: "arco",
      rol_escena: index === 1 ? "focal" : "soporte",
      ubicacion: index === 1 ? "arco_central" : index === 2 ? "lateral_izquierdo" : "lateral_derecho",
      medidas: { ancho_m: 3, alto_m: 2.4 },
      repeticiones: 1,
      densidad: "media",
      mezcla: "clasica",
      materiales: [{ product_id: productId, participacion: 1, rol_material: "principal" }],
      porque: "Fixture de verificación del camino de herramientas.",
    })),
  };
}

async function main(): Promise<void> {
  // Only a genuinely unconfigured run may skip; a required smoke fails. Both
  // databases must be loopback: the tool path queries the catalog and writes
  // audit rows through the application pool.
  const decision = decidirSmoke((env) => problemaPostgresLocal("CATALOG_DATABASE_URL", env) ?? problemaPostgresLocal("DATABASE_URL", env));
  if (decision.accion === "saltar") {
    console.log(`[SKIP] ${decision.motivo}`);
    return;
  }
  if (decision.accion === "fallar") throw new Error(decision.motivo);
  await exigirReadyz(decision.backendUrl);
  const pool = new Pool({ connectionString: process.env.CATALOG_DATABASE_URL });
  try {
    const solicitud = "un globo";
    const consulta = "globo redondo latex";
    const estado = crearEstadoConversacion({}, solicitud);
    const llamada = { nombre: "test-plan-python-cutover", args: {} };
    const registro = crearRegistroHerramientas(estado, {
      pool,
      correlationId: randomUUID(),
    });
    const busqueda = await registro.buscar_catalogo_rag({ mensaje: consulta }, llamada);
    assert.equal(busqueda.status, "OK");
    assert.ok(estado.ragCatalogSnapshotId, "la búsqueda Python debe fijar el snapshot del turno");
    const candidatos = objetos(busqueda.candidatos, "candidatos");
    const candidato = candidatos.find((item) => objetos(item.variantes, "variantes").some((variant) =>
      variant.forma === "redondo" && variant.diametro_pulgadas === 12));
    assert.ok(candidato, "la búsqueda debe devolver una familia con R-12 redondo");
    const productId = texto(candidato.product_id, "candidato.product_id");

    const confirmado = await registro.confirmar_plan_decoracion(planDeHerramienta(productId), llamada);
    assert.equal(confirmado.ok, true);
    const planResuelto = estado.planResuelto;
    assert.ok(planResuelto?.approval_token, "el plan confirmado debe incluir approval_token");
    const contexto = abrirContextoPlan(planResuelto.approval_token);
    assert.ok(contexto, "el approval_token debe abrirse");
    assert.equal(contexto.backend, "python");
    assert.equal(contexto.catalogSnapshotId, estado.ragCatalogSnapshotId);
    assert.ok(contexto.allowlist.length > 0, "el token debe conservar la allowlist del turno");

    const estadoSinBusqueda = crearEstadoConversacion({}, solicitud);
    const registroSinBusqueda = crearRegistroHerramientas(estadoSinBusqueda, {
      pool,
      correlationId: randomUUID(),
    });
    const sinSnapshot = await registroSinBusqueda.confirmar_plan_decoracion(planDeHerramienta(productId), llamada);
    assert.equal(sinSnapshot.ok, false);
    assert.equal(sinSnapshot.status, "BACKEND_NO_DISPONIBLE");
    assert.match(String(sinSnapshot.accion_requerida), /buscar_catalogo_rag/);
    console.log(`[PASS] camino de herramientas con snapshot=${estado.ragCatalogSnapshotId}; backend=python; allowlist firmada; guardia sin snapshot=BACKEND_NO_DISPONIBLE`);
  } catch (error) {
    if (isPythonAdapterError(error) && (error.code === "PYTHON_UNAVAILABLE" || error.code === "PYTHON_BACKEND_TIMEOUT")) {
      throw new Error("el servicio Python o su catálogo local no respondió", { cause: error });
    }
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[FAIL] camino de herramientas del cutover Python — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
