import { existsSync } from "node:fs";
for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

import { crearEstadoConversacion, crearRegistroHerramientas } from "../src/lib/ia/registro-herramientas";

/**
 * Prueba de integración manual de F3 (PLAN_TAMANOS_GLOBO.md): ejercita el
 * registro de herramientas real — buscar_catalogo_rag → calcular_medidas →
 * confirmar_seleccion_rag con usar_despiece — contra Postgres + SQLite
 * reales, no mocks. Confirma que la "mezcla de diseñador" completa (LLM
 * elige producto/color, backend elige tamaño/cantidad/paquete) funciona
 * de punta a punta a través del mismo código que usa el chat en producción.
 */
async function main() {
  const estado = crearEstadoConversacion({});
  const registro = crearRegistroHerramientas(estado);
  const llamada = { nombre: "test", args: {} };

  console.log("1) buscar_catalogo_rag('globo latex redondo liso rojo')");
  const busqueda = await registro.buscar_catalogo_rag({ mensaje: "globo latex redondo liso rojo" }, llamada);
  const candidatos = busqueda.candidatos as Array<{ product_id: string; titulo: string; variantes: Array<{ tamano: string | null }> }>;
  console.log(`   ${candidatos.length} candidatos: ${candidatos.map((c) => c.titulo).join(", ")}`);
  // Elige el primer candidato que de verdad tenga más de un tamaño (un
  // producto de globo redondo suelto), no un kit/decoración prearmada que
  // el ranking semántico haya colado primero — la prueba debe reflejar el
  // caso real que F3 arregla, no depender de que el ranking acierte.
  const candidatoRedondo = candidatos.find((c) => new Set(c.variantes.map((v) => v.tamano)).size > 1);
  if (!candidatoRedondo) throw new Error("Ningún candidato con múltiples tamaños — ajusta la consulta de prueba.");
  const productId = candidatoRedondo.product_id;
  console.log(`   usando producto: ${candidatoRedondo.titulo} (${productId})`);

  console.log("\n2) calcular_medidas(arco 3x2.5m)");
  const medidas = await registro.calcular_medidas({ figura: "arco", ancho_m: 3, alto_m: 2.5 }, llamada);
  console.log(`   total_globos=${medidas.total_globos}, despiece=${JSON.stringify(medidas.despiece)}`);

  console.log(`\n3) confirmar_seleccion_rag([{product_id: ${productId}, usar_despiece: true}])`);
  const confirmacion = await registro.confirmar_seleccion_rag({ seleccion: [{ product_id: productId, usar_despiece: true }] }, llamada);
  console.log(JSON.stringify(confirmacion, null, 2));

  const validados = confirmacion.validados as Array<{ variant_id: string; cantidad: number }>;
  const tamanosDistintos = new Set(validados.map((v) => v.variant_id));
  console.log(`\n[${validados.length > 1 ? "PASS" : "FAIL"}] la selección se expandió en múltiples variantes reales: ${validados.length} líneas, ${tamanosDistintos.size} variantes distintas`);

  console.log("\n3b) F4 — ¿estado.seleccionFinalIA (lo que llega a /api/generate) trae diamPulg/forma?");
  const productosFinal = estado.seleccionFinalIA ?? [];
  for (const p of productosFinal) console.log(`   ${p.nombre}: diamPulg=${p.diamPulg} forma=${p.forma} tamanoCodigo=${p.tamanoCodigo} paquetes=${p.paquetes} unidadesPaquete=${p.unidadesPaquete} familiaId=${p.familiaId}`);
  console.log(`[${productosFinal.every((p) => p.diamPulg != null) ? "PASS" : "FAIL"}] todos los productos finales tienen diamPulg poblado`);
  console.log(`[${new Set(productosFinal.map((p) => p.familiaId)).size === 1 ? "PASS" : "FAIL"}] todos comparten la misma familiaId (para agrupación visual F4)`);

  console.log("\n4) Caso de error: usar_despiece sin calcular_medidas (estado nuevo)");
  const estado2 = crearEstadoConversacion({});
  const registro2 = crearRegistroHerramientas(estado2);
  await registro2.buscar_catalogo_rag({ mensaje: "globos rojos para un arco" }, llamada);
  const confirmacion2 = await registro2.confirmar_seleccion_rag({ seleccion: [{ product_id: productId, usar_despiece: true }] }, llamada);
  console.log(JSON.stringify(confirmacion2.rechazados, null, 2));
  const rechazados2 = confirmacion2.rechazados as Array<{ motivo: string }>;
  console.log(`[${rechazados2.some((r) => r.motivo.includes("calcular_medidas")) ? "PASS" : "FAIL"}] rechaza usar_despiece sin calcular_medidas previo`);
}

main().catch((error) => {
  console.error("[FAIL]", error);
  process.exitCode = 1;
});
