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

  // 1b. W3.5: lo que la descripción de `mezcla` le recomienda al modelo tiene
  //     que ser lo que el resolver puede cubrir (sustitucionAdmisible), o el
  //     plan sale directo a SIN_COBERTURA.
  const { HERRAMIENTAS_PLAN: herramientasPlan } = await import("../src/lib/ia/herramientas");
  const descripcionMezcla = String((herramientasPlan[0]!.esquema as { properties: { estructuras: { items: { properties: Record<string, { description?: string }> } } } }).properties.estructuras.items.properties.mezcla!.description);
  const recomendaciones = [
    { diametros: [5, 9, 12, 18], mezcla: "organica_fina" as const, organicaFina: true },
    { diametros: [5, 9, 12, 24], mezcla: "organica_fina" as const, organicaFina: true },
    { diametros: [5, 9, 12], mezcla: "clasica" as const, organicaFina: false },
    { diametros: [9, 12], mezcla: "clasica" as const, organicaFina: false },
    // Revisión W3-3: las 5 pulgadas y una grande no bastan; la pedida de 9 solo
    // la cubren el 9 o el 12, así que el texto tiene que nombrarlas también.
    { diametros: [5, 18, 24], mezcla: "clasica" as const, organicaFina: false },
    { diametros: [5, 24], mezcla: "solo_grandes" as const, organicaFina: false },
  ];
  for (const caso of recomendaciones) {
    const compatibles = mezclasCompatiblesConDiametros(caso.diametros);
    assert.ok(compatibles.includes(caso.mezcla), `${caso.diametros.join("/")} debería admitir ${caso.mezcla}: ${compatibles.join(", ")}`);
    assert.equal(compatibles.includes("organica_fina"), caso.organicaFina, `${caso.diametros.join("/")}: ${compatibles.join(", ")}`);
  }
  assert.doesNotMatch(descripcionMezcla, /aunque falten 18 o 24/, "el texto ya no recomienda una mezcla que el resolver no cubre");
  assert.match(descripcionMezcla, /5 pulgadas exactas, al menos una de 9 o 12, y al menos una de 18 o 24/);
  assert.match(descripcionMezcla, /solo tiene 5, 9 y 12 pulgadas \(o solo 9 y 12\) no cabe en organica_fina/);
  ok("descripción de mezcla alineada con sustitucionAdmisible (tabla de conjuntos de tamaños)");

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

  // 5. W3.2: ruido de redondeo de las participaciones y rol principal coherente
  //    con la participación, antes de que el esquema gaste un rechazo.
  const { normalizarParticipacionesPlan } = await import("../src/lib/ia/registro-herramientas");
  const conMateriales = (materiales: Array<Record<string, unknown>>) => ({
    estructuras: [{ estructura_id: "EST_01_ARCO", materiales }],
  });
  const tercios = normalizarParticipacionesPlan(conMateriales([
    { product_id: "A", participacion: 0.33, rol_material: "principal" },
    { product_id: "B", participacion: 0.33, rol_material: "secundario" },
    { product_id: "C", participacion: 0.33, rol_material: "acento" },
  ]));
  const cuotasTercios = (tercios.args.estructuras as Array<{ materiales: Array<{ participacion: number }> }>)[0]!.materiales.map((material) => material.participacion);
  assert.ok(Math.abs(cuotasTercios.reduce((suma, cuota) => suma + cuota, 0) - 1) < 1e-9, cuotasTercios.join(", "));
  assert.deepEqual(tercios.ajustes, [{ tipo: "participacion_reescalada", estructura_id: "EST_01_ARCO", suma_declarada: 0.33 * 3 }]);
  assert.ok(PlanDecoracionSchema.safeParse({ plan_version: "1.0", plan_id: "99999999-9999-4999-8999-999999999999", ...plan("clasica"), estructuras: [{ ...plan("clasica").estructuras[0]!, materiales: (tercios.args.estructuras as Array<{ materiales: unknown[] }>)[0]!.materiales }] }).success, "el plan reescalado pasa el esquema");
  assert.ok(!PlanDecoracionSchema.safeParse({ plan_version: "1.0", plan_id: "99999999-9999-4999-8999-999999999999", ...plan("clasica"), estructuras: [{ ...plan("clasica").estructuras[0]!, materiales: [{ product_id: "A", participacion: 0.33, rol_material: "principal" }, { product_id: "B", participacion: 0.33, rol_material: "secundario" }, { product_id: "C", participacion: 0.33, rol_material: "acento" }] }] }).success, "sin normalizar, 0,33 × 3 es un rechazo del esquema");

  const desviado = conMateriales([{ product_id: "A", participacion: 0.5, rol_material: "principal" }, { product_id: "B", participacion: 0.3, rol_material: "acento" }]);
  assert.deepEqual(normalizarParticipacionesPlan(desviado), { args: desviado, ajustes: [] }, "una desviación mayor a 0,02 la sigue rechazando el esquema");
  const exacto = conMateriales([{ product_id: "A", participacion: 0.6, rol_material: "principal" }, { product_id: "B", participacion: 0.4, rol_material: "acento" }]);
  assert.deepEqual(normalizarParticipacionesPlan(exacto), { args: exacto, ajustes: [] }, "un plan coherente no se toca");
  assert.deepEqual(normalizarParticipacionesPlan({ estructuras: "no es una lista" }).ajustes, [], "argumentos con otra forma quedan para zod");

  const rolInvertido = normalizarParticipacionesPlan(conMateriales([
    { product_id: "A", participacion: 0.2, rol_material: "principal" },
    { product_id: "B", participacion: 0.8, rol_material: "acento" },
  ]));
  assert.deepEqual((rolInvertido.args.estructuras as Array<{ materiales: Array<{ rol_material: string }> }>)[0]!.materiales.map((material) => material.rol_material), ["secundario", "principal"]);
  assert.deepEqual(rolInvertido.ajustes, [{ tipo: "rol_principal_reasignado", estructura_id: "EST_01_ARCO", product_id: "B" }]);
  const { HERRAMIENTAS_PLAN } = await import("../src/lib/ia/herramientas");
  const materialPlan = (HERRAMIENTAS_PLAN[0]!.esquema as { properties: { estructuras: { items: { properties: { materiales: { items: { properties: Record<string, { description?: string; minimum?: number }> } } } } } } }).properties.estructuras.items.properties.materiales.items.properties;
  assert.match(String(materialPlan.participacion!.description), /suman exactamente 1/);
  assert.match(String(materialPlan.rol_material!.description), /principal = el material con mayor participacion/);
  assert.equal(materialPlan.participacion!.minimum, 0, "el mínimo del esquema de herramienta no cambia");
  ok("participaciones: 0,33 × 3 se reescala a 1 y el rol principal pasa al material de mayor participación");

  // 6. W3.2: al quitar el principal, la regla 3 de cobertura lo reasigna al de
  //    mayor participación reescalada, no al primero de la lista.
  const { ajustarCoberturaPlan } = await import("../src/lib/plan/cobertura-materiales");
  const disponibilidad = new Map([
    ["P-MENOR", { titulo: "Globo blanco", colores: ["blanco"], mezclas: ["organica_fina", "organica_gruesa"] as const, acabados: [] }],
    ["P-SIN-COBERTURA", { titulo: "Globo dorado", colores: ["dorado"], mezclas: ["clasica"] as const, acabados: [] }],
    ["P-MAYOR", { titulo: "Globo rosado", colores: ["rosado"], mezclas: ["organica_fina", "organica_gruesa"] as const, acabados: [] }],
  ]);
  const planSinPrincipal = PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: "88888888-8888-4888-8888-888888888888",
    ...plan("organica_fina"),
    estructuras: [{
      ...plan("organica_fina").estructuras[0]!,
      materiales: [
        { product_id: "P-MENOR", color: "blanco", participacion: 0.2, rol_material: "secundario" },
        { product_id: "P-SIN-COBERTURA", color: "dorado", participacion: 0.1, rol_material: "acento" },
        { product_id: "P-MAYOR", color: "rosado", participacion: 0.7, rol_material: "acento" },
      ],
    }],
  });
  const ajustado = ajustarCoberturaPlan(planSinPrincipal, disponibilidad);
  const materialesAjustados = ajustado.plan.estructuras[0]!.materiales;
  assert.deepEqual(materialesAjustados.map((material) => material.product_id), ["P-MENOR", "P-MAYOR"], JSON.stringify(materialesAjustados));
  assert.equal(materialesAjustados.find((material) => material.rol_material === "principal")?.product_id, "P-MAYOR", JSON.stringify(materialesAjustados));
  ok("cobertura regla 3: el principal quitado deja el rol al material de mayor participación reescalada");

  // 7. W3.6: los ajustes de acabado y de color que hace el servidor llegan al
  //    modelo como avisos_cliente, sin duplicar lo que ya reporta otra vía.
  const { avisosClienteAjustes } = await import("../src/lib/plan/cobertura-materiales");
  const nombresEstructura = new Map([["EST_01_ARCO", "Arco rojo"]]);
  const ajustesAviso = [
    { tipo: "acabado_material" as const, estructura_id: "EST_01_ARCO", product_id: "P-ROJO", antes: "reflex", color: "dorado" },
    { tipo: "color_material" as const, estructura_id: "EST_01_ARCO", product_id: "P-ROJO", antes: "plateado", despues: "gris" },
  ];
  const avisos = avisosClienteAjustes(ajustesAviso, { nombres: nombresEstructura });
  assert.deepEqual(avisos, [
    "Los globos dorado de arco rojo no vienen en acabado reflex en el catálogo: van en su acabado normal.",
    "En arco rojo los globos plateado van en gris, que es el color real de ese producto.",
  ]);
  for (const aviso of avisos) assert.deepEqual(detectarJergaInterna(aviso), [], aviso);
  assert.deepEqual(avisosClienteAjustes(ajustesAviso, { nombres: nombresEstructura, coloresReportados: [{ estructura_id: "EST_01_ARCO", color: "Plateado" }] }), [avisos[0]], "el color ya reportado por una sustitución de la foto no se repite");
  assert.deepEqual(avisosClienteAjustes(ajustesAviso, { nombres: nombresEstructura, coloresDelCliente: ["plateado"] }), [avisos[0]], "un color exigido por el cliente lo reporta la validación de restricciones");
  assert.deepEqual(avisosClienteAjustes([{ tipo: "mezcla", estructura_id: "EST_01_ARCO", antes: "organica_fina", despues: "clasica" }], { nombres: nombresEstructura }), [], "un cambio de mezcla no es un aviso para el cliente");

  const conAcabado = confirmar();
  const planAcabado = plan("clasica");
  const respuestaAcabado = await conAcabado.herramienta({
    ...planAcabado,
    estructuras: [{ ...planAcabado.estructuras[0]!, materiales: [{ product_id: "P-ROJO", color: "rojo", acabado: "reflex", participacion: 1, rol_material: "principal" }] }],
  }, llamada) as Record<string, unknown>;
  assert.equal(respuestaAcabado.ok, true, JSON.stringify(respuestaAcabado).slice(0, 300));
  const avisosRespuesta = respuestaAcabado.avisos_cliente as string[];
  assert.ok(avisosRespuesta.some((aviso) => /no vienen en acabado reflex/.test(aviso)), JSON.stringify(avisosRespuesta));
  for (const aviso of avisosRespuesta) assert.deepEqual(detectarJergaInterna(aviso), [], aviso);
  ok("ok:true avisa el acabado que el catálogo no tiene en vez de dejar que el resumen lo prometa");

  console.log(`\n${casos} casos OK (A6)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
