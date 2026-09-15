/**
 * A6 (docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md): un plan SIN_COBERTURA le dice al
 * modelo qué tamaños tiene cada producto y qué mezcla sí cabe, para que el
 * reintento converja en vez de cambiar productos a ciegas.
 *
 * Sin red ni proveedores. Run: npx tsx --conditions=react-server scripts/test-plan-cobertura-tamanos.ts
 */
import assert from "node:assert/strict";
import type { Pool } from "pg";

process.env.PYTHON_BACKEND_ENABLED = "false";
process.env.PYTHON_BACKEND_KILL_SWITCH = "true";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

async function main(): Promise<void> {
  const { mezclasCompatiblesConDiametros } = await import("../src/lib/plan/resolver");
  const { coberturaPorProducto, crearEstadoConversacion, crearRegistroHerramientas } = await import("../src/lib/ia/registro-herramientas");
  const { detectarJergaInterna } = await import("../src/lib/ia/jerga-interna");
  type ProductoCandidato = import("../src/lib/rag/chat/buscar").ProductoCandidato;

  // 1. Mezclas compatibles con la misma sustitución admisible del resolver.
  assert.deepEqual(mezclasCompatiblesConDiametros([12]), ["clasica"]);
  assert.deepEqual(mezclasCompatiblesConDiametros([5, 9, 12, 18, 24]), ["clasica", "organica_fina", "organica_gruesa", "solo_grandes"]);
  assert.deepEqual(mezclasCompatiblesConDiametros([12, 18]), ["clasica", "organica_gruesa", "solo_grandes"], "R-9→R-12 y R-24→R-18 son admisibles; R-5 no tiene vecino admisible");
  assert.deepEqual(mezclasCompatiblesConDiametros([9, 12, 18, 24]), ["clasica", "organica_gruesa", "solo_grandes"], "sin R-5 no hay organica_fina");
  assert.deepEqual(mezclasCompatiblesConDiametros([]), []);
  ok("mezclas compatibles: R-5 exacto para organica_fina; vecinos admisibles para el resto");

  // 2. Cobertura por producto desde los candidatos del turno.
  const candidato = (productId: string, diametros: number[], color: string): ProductoCandidato => ({
    productId,
    titulo: `Globo ${color}`,
    categoria: "globo_latex",
    colores: [color],
    acabados: [],
    ocasiones: [],
    disponible: true,
    imagen: null,
    variantes: diametros.map((diametro) => ({ variantId: `${productId}-R${diametro}`, sku: null, titulo: `R-${diametro}`, precio: 10000, disponible: true, codigoTamano: `R-${diametro}`, diamPulg: diametro, forma: "redondo", colores: [color] })),
  });
  const soloDoce = candidato("P-ROJO", [12], "rojo");
  const cobertura = coberturaPorProducto([
    { estructura_id: "EST_01_ARCO", product_id: "P-ROJO", tamano: "R-5" },
    { estructura_id: "EST_01_ARCO", product_id: "P-ROJO", tamano: "R-24" },
    { estructura_id: "EST_01_ARCO", product_id: "P-DESCONOCIDO", tamano: "R-5" },
  ], [soloDoce]);
  assert.deepEqual(cobertura, [
    { estructura_id: "EST_01_ARCO", product_id: "P-ROJO", tamanos_faltantes: ["R-5", "R-24"], tamanos_disponibles: ["R-12"], mezclas_compatibles: ["clasica"] },
    { estructura_id: "EST_01_ARCO", product_id: "P-DESCONOCIDO", tamanos_faltantes: ["R-5"], tamanos_disponibles: [], mezclas_compatibles: [] },
  ]);
  ok("cobertura por producto: faltantes, disponibles del turno y mezclas que caben");

  // 3. Rechazo real y reintento que converge (backend Next, Pool falso).
  const filas = [
    { product_id: "P-ROJO", variant_id: "P-ROJO-R12", sku: "SKU-R12", producto_titulo: "Globo rojo", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["rojo"], colores_variante: ["rojo"], acabados_producto: [], descripcion: "Globo rojo R-12", imagen: null },
  ];
  const pool = { query: async (sql: string) => (sql.includes("catalog_variants") ? { rows: filas } : { rows: [] }) } as unknown as Pool;
  const confirmar = () => {
    const estado = crearEstadoConversacion({}, "un arco rojo");
    estado.ragCandidatos = [soloDoce];
    estado.ragIdsRecuperados.add("P-ROJO");
    estado.ragVariantIdsRecuperados.set("P-ROJO", new Set(["P-ROJO-R12"]));
    return { estado, herramienta: crearRegistroHerramientas(estado, { pool }).confirmar_plan_decoracion! };
  };
  const plan = (mezcla: string) => ({
    concepto: { titulo: "Arco rojo", descripcion: "Arco", paleta: ["rojo"] },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras: [{
      estructura_id: "EST_01_ARCO",
      nombre: "Arco rojo",
      tipo: "arco",
      rol_escena: "focal",
      ubicacion: "arco_central",
      medidas: { ancho_m: 2.5, alto_m: 2.2 },
      repeticiones: 1,
      densidad: "media",
      mezcla,
      materiales: [{ product_id: "P-ROJO", color: "rojo", participacion: 1, rol_material: "principal" }],
      porque: "Arco principal",
    }],
    supuestos: [],
  });
  const llamada = { nombre: "confirmar_plan_decoracion", args: {} };
  const primero = confirmar();
  const rechazo = await primero.herramienta(plan("organica_fina"), llamada) as Record<string, unknown>;
  assert.equal(rechazo.status, "SIN_COBERTURA", JSON.stringify(rechazo).slice(0, 400));
  assert.deepEqual(rechazo.cobertura_por_producto, [
    { estructura_id: "EST_01_ARCO", product_id: "P-ROJO", tamanos_faltantes: ["R-5", "R-9", "R-18", "R-24"].filter((tamano) => (rechazo.sin_cobertura as Array<{ tamano: string }>).some((item) => item.tamano === tamano)), tamanos_disponibles: ["R-12"], mezclas_compatibles: ["clasica"] },
  ]);
  assert.match(String(rechazo.accion_requerida), /mezclas_compatibles/);
  assert.deepEqual(detectarJergaInterna(String(rechazo.mensaje_cliente)), [], String(rechazo.mensaje_cliente));
  const segundo = confirmar();
  const reintento = await segundo.herramienta(plan("clasica"), llamada) as Record<string, unknown>;
  assert.notEqual(reintento.status, "SIN_COBERTURA", JSON.stringify(reintento).slice(0, 400));
  assert.ok(segundo.estado.planResuelto, `el reintento con la mezcla sugerida debe verificar el plan: ${JSON.stringify(reintento).slice(0, 300)}`);
  ok("SIN_COBERTURA con organica_fina sugiere clasica; el reintento con clasica verifica el plan");

  // 4. Colores del cliente al vocabulario del catálogo (causa real del bucle
  //    "corporativo": "azul rey" nunca coincidía con variantes de color "azul").
  const { colorDeCatalogo, canonizarColoresPlan } = await import("../src/lib/plan/colores-catalogo");
  const { PlanDecoracionSchema } = await import("../src/lib/plan/tipos");
  assert.equal(colorDeCatalogo("azul rey"), "azul");
  assert.equal(colorDeCatalogo("Rosa"), "rosado");
  assert.equal(colorDeCatalogo("plata"), "plateado");
  assert.equal(colorDeCatalogo("oro rosa"), "dorado rosa");
  assert.equal(colorDeCatalogo("azul y blanco"), "azul y blanco", "varios colores se dejan tal cual");
  assert.equal(colorDeCatalogo("color secreto"), "color secreto", "un color desconocido se deja tal cual");
  const planAzulRey = PlanDecoracionSchema.parse({ plan_version: "1.0", plan_id: "99999999-9999-4999-8999-999999999999", ...plan("clasica"), estructuras: plan("clasica").estructuras.map((estructura) => ({ ...estructura, materiales: [{ ...estructura.materiales[0], color: "azul rey" }], variant_overrides: [{ objetivo_variant_id: "A", product_id: "P-AZUL", variant_id: "B", color: "Rosa" }] })) });
  const canonico = canonizarColoresPlan(planAzulRey);
  assert.equal(canonico.plan.estructuras[0]!.materiales[0]!.color, "azul");
  assert.equal(canonico.plan.estructuras[0]!.variant_overrides?.[0]?.color, "rosado");
  assert.deepEqual(canonico.cambios, [{ original: "azul rey", catalogo: "azul" }, { original: "Rosa", catalogo: "rosado" }]);
  assert.equal(planAzulRey.estructuras[0]!.materiales[0]!.color, "azul rey", "no muta el plan original");

  const filaAzul = { ...filas[0]!, product_id: "P-AZUL", variant_id: "P-AZUL-R12", producto_titulo: "Globo Fashion Azul Rey", colores_producto: ["azul"], colores_variante: ["azul"] };
  const poolAzul = { query: async (sql: string) => (sql.includes("catalog_variants") ? { rows: [filaAzul] } : { rows: [] }) } as unknown as Pool;
  const estadoAzul = crearEstadoConversacion({}, "Evento corporativo: un arco de globos azul rey");
  estadoAzul.ragCandidatos = [candidato("P-AZUL", [12], "azul")];
  estadoAzul.ragIdsRecuperados.add("P-AZUL");
  estadoAzul.ragVariantIdsRecuperados.set("P-AZUL", new Set(["P-AZUL-R12"]));
  const argsAzul = { ...plan("clasica"), estructuras: plan("clasica").estructuras.map((estructura) => ({ ...estructura, materiales: [{ product_id: "P-AZUL", color: "azul rey", participacion: 1, rol_material: "principal" }] })) };
  const resultadoAzul = await crearRegistroHerramientas(estadoAzul, { pool: poolAzul }).confirmar_plan_decoracion!(argsAzul, llamada) as Record<string, unknown>;
  assert.notEqual(resultadoAzul.status, "SIN_COBERTURA", JSON.stringify(resultadoAzul).slice(0, 400));
  assert.ok(estadoAzul.planResuelto, `material "azul rey" debe resolver contra variantes "azul": ${JSON.stringify(resultadoAzul).slice(0, 300)}`);
  assert.equal(estadoAzul.planResuelto.plan.estructuras[0]!.materiales[0]!.color, "azul");
  ok("colores del cliente al vocabulario del catálogo: 'azul rey' resuelve contra variantes 'azul'");

  // 5. W2.4 (D8): el color real de la variante manda sobre el color de familia
  //    que aportan los tags del producto. "Fashion Violeta" está etiquetado
  //    MORADOS, así que la regla 1 no disparaba y el plan cotizaba globos
  //    violeta como "morado", con ese color en la cotización y en el prompt.
  const { coloresRealesVariante } = await import("../src/lib/plan/colores-producto");
  const { disponibilidadDelTurno } = await import("../src/lib/ia/convergencia-plan");
  assert.deepEqual(coloresRealesVariante("Globo Latex Redondo Fashion Violeta", ["violeta"], ["violeta", "morado"]), ["violeta"]);
  assert.deepEqual(coloresRealesVariante("Globo Latex Redondo Fashion Merlot", [], ["rojo", "burdeos"]), ["rojo", "burdeos"], "sin colores de variante se conserva el conjunto del producto, nunca vacío");
  assert.deepEqual(coloresRealesVariante("Globo Latex Redondo Fashion Gris", [], ["plateado"]), ["gris"], "la corrección de gris sigue aplicando");

  const violeta: ProductoCandidato = {
    productId: "P-VIOLETA",
    titulo: "Globo Latex Redondo Fashion Violeta",
    categoria: "globo_latex",
    colores: ["violeta", "morado"],
    acabados: [],
    ocasiones: [],
    disponible: true,
    imagen: null,
    variantes: [{ variantId: "P-VIOLETA-R12", sku: null, titulo: "R-12", precio: 10000, disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: ["violeta"] }],
  };
  const disponibilidadVioleta = disponibilidadDelTurno([violeta]).get("P-VIOLETA")!;
  assert.deepEqual(disponibilidadVioleta.coloresVariante, ["violeta"], "la regla 1 lee los colores de las variantes redondas");
  assert.deepEqual(disponibilidadVioleta.colores, ["violeta", "morado"], "el producto conserva el color de familia: decide qué variantes acepta un color pedido");

  const filaVioleta = { ...filas[0]!, product_id: "P-VIOLETA", variant_id: "P-VIOLETA-R12", producto_titulo: "Globo Latex Redondo Fashion Violeta", colores_producto: ["violeta", "morado"], colores_variante: ["violeta"] };
  const poolVioleta = { query: async (sql: string) => (sql.includes("catalog_variants") ? { rows: [filaVioleta] } : { rows: [] }) } as unknown as Pool;
  const estadoVioleta = crearEstadoConversacion({}, "Quiero un arco morado");
  estadoVioleta.ragCandidatos = [violeta];
  estadoVioleta.ragIdsRecuperados.add("P-VIOLETA");
  estadoVioleta.ragVariantIdsRecuperados.set("P-VIOLETA", new Set(["P-VIOLETA-R12"]));
  const argsVioleta = { ...plan("clasica"), estructuras: plan("clasica").estructuras.map((estructura) => ({ ...estructura, materiales: [{ product_id: "P-VIOLETA", color: "morado", participacion: 1, rol_material: "principal" }] })) };
  const resultadoVioleta = await crearRegistroHerramientas(estadoVioleta, { pool: poolVioleta }).confirmar_plan_decoracion!(argsVioleta, llamada) as Record<string, unknown>;
  assert.equal(resultadoVioleta.ok, true, JSON.stringify(resultadoVioleta).slice(0, 400));
  assert.ok(estadoVioleta.planResuelto, JSON.stringify(resultadoVioleta).slice(0, 300));
  assert.equal(estadoVioleta.planResuelto.plan.estructuras[0]!.materiales[0]!.color, "violeta", "la regla 1 corrige el color de familia");
  const lineasVioleta = estadoVioleta.planResuelto.estructuras[0]!.lineas;
  assert.ok(lineasVioleta.length > 0 && lineasVioleta.every((linea) => linea.color === "violeta"), JSON.stringify(lineasVioleta.map((linea) => linea.color)));
  // El cliente pidió "morado" y el servidor mismo cambió ese color: el globo
  // comprado es el que su color eligió, así que la restricción sigue cubierta.
  assert.deepEqual(estadoVioleta.restriccionesUsuario.colores.map((color) => color.valor), ["morado"]);
  assert.notEqual(resultadoVioleta.status, "RESTRICCIONES_INCONSISTENTES");
  ok("color real de la variante: 'morado' (color de familia de los tags) se cotiza violeta sin rechazar la restricción del cliente");

  console.log(`\n${casos} casos OK (A6)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
