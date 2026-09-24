/**
 * A4 (docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md): el texto que el asistente puede
 * trasladar al cliente no contiene jerga interna.
 *
 * Invariantes deterministas, sin red ni proveedores. El plan lo resuelve
 * Python desde el paso 5 del ADR-0023, así que esa llamada la responde un doble
 * de transporte (scripts/lib/resolutor-python-falso.ts): el sujeto de este
 * fichero es el texto que ve el cliente, no el conteo.
 *
 * - el detector reconoce la jerga prohibida y deja pasar el texto normal;
 * - cada `mensaje_cliente` y cada error de restricciones está limpio;
 * - las ramas ok:false reales de confirmar_plan_decoracion traen mensaje_cliente limpio;
 * - el prompt del sistema prohíbe citar lo interno y ya no pide SKU ni status.
 *
 * Run: npx tsx --conditions=react-server scripts/test-jerga-herramientas.ts
 */
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  instalarResolutorPythonFalso,
  prepararEntornoPythonFalso,
  SNAPSHOT_FALSO,
  type VeredictoResolucion,
} from "./lib/resolutor-python-falso";

prepararEntornoPythonFalso();

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

async function main(): Promise<void> {
  const { detectarJergaInterna } = await import("../src/lib/ia/omoikane/jerga-interna");
  const mensajes = await import("../src/lib/ia/herramientas/mensajes-cliente");
  const { validarRestriccionesPlan, validarCardinalidadEventoAbierto, extraerRestriccionesUsuario } = await import("../src/lib/plan/restricciones");
  const { PlanDecoracionSchema } = await import("../src/lib/plan/tipos");
  const { crearEstadoConversacion, crearRegistroHerramientas } = await import("../src/lib/ia/herramientas/registro-herramientas");
  const { construirSistema } = await import("../src/lib/ia/omoikane/prompt-sistema");
  const { HERRAMIENTAS_RAG, HERRAMIENTAS_PLAN } = await import("../src/lib/ia/herramientas/herramientas");

  const limpio = (texto: string, contexto: string) => assert.deepEqual(detectarJergaInterna(texto), [], `${contexto}: "${texto}"`);

  // 1. Detector.
  for (const sucio of [
    "El plan falló por SIN_COBERTURA en el arco.",
    "LORA_PREFLIGHT_FAILED: longitud 845",
    "Usé el SKU 12345 para el arco.",
    "Faltan globos para EST_01_ARCO:R-12.",
    "La cortina REF_01_E02 queda fuera.",
    "El variant_id no coincide.",
    "La variante 46594221277479 no está disponible.",
    "No hay cobertura de ese tamaño.",
    "Superaste el límite del prompt.",
    "El backend no respondió.",
    "Llamé a confirmar_plan_decoracion.",
  ]) assert.ok(detectarJergaInterna(sucio).length > 0, `debería detectar jerga: ${sucio}`);
  for (const normal of [
    "Te propongo un arco orgánico en dorado y blanco con globos de 12 pulgadas.",
    "La propuesta cuesta $ 450.000 y supera tu presupuesto de $ 400.000 por $ 50.000.",
    "Puedo poner una guirnalda en el techo y dos columnas a los lados.",
    "Usaré globos R-12 y R-5 para dar volumen.",
  ]) limpio(normal, "texto normal marcado como jerga");
  ok("detector: reconoce códigos, ids, SKU, términos técnicos y deja pasar texto de decoración");

  // 2. Mensajes para el cliente (dueño: mensajes-cliente.ts).
  for (const [nombre, valor] of Object.entries(mensajes)) {
    if (typeof valor === "string") limpio(valor, nombre);
  }
  const nombres = new Map([["EST_01_ARCO", "Arco orgánico principal (3 m)"], ["EST_02_COLUMNAS", "Columnas laterales"]]);
  const sinCobertura = mensajes.mensajeClienteSinCobertura([
    { estructura_id: "EST_01_ARCO", tamano: "R-24" },
    { estructura_id: "EST_01_ARCO", tamano: "R-5" },
    { estructura_id: "EST_02_COLUMNAS", tamano: "R-12" },
    { estructura_id: "EST_09_DESCONOCIDA", tamano: "LOL" },
  ], nombres);
  limpio(sinCobertura, "mensajeClienteSinCobertura");
  assert.match(sinCobertura, /globos de 5 y 24 pulgadas para arco orgánico principal/);
  assert.match(sinCobertura, /globos de 12 pulgadas para columnas laterales/);
  assert.match(sinCobertura, /algunos tamaños de globo para una de las decoraciones/);
  const presupuesto = mensajes.mensajeClientePresupuesto(450_000, 400_000, 50_000);
  limpio(presupuesto, "mensajeClientePresupuesto");
  assert.match(presupuesto, /450\.000/);
  assert.match(presupuesto, /50\.000/);
  limpio(mensajes.mensajeClientePresupuesto(450_000, null, null), "presupuesto sin techo");
  ok("mensajes para el cliente sin jerga, con tamaños en pulgadas, nombres de estructura y pesos");

  // 3. Errores de restricciones redactados para el cliente.
  const plan = PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: "66666666-6666-4666-8666-666666666666",
    concepto: { titulo: "XV años", descripcion: "Decoración glamour.", paleta: ["rosa"] },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras: [{
      estructura_id: "EST_01_GUIRNALDA",
      nombre: "Guirnalda",
      tipo: "guirnalda",
      rol_escena: "focal",
      ubicacion: "fondo_pared",
      medidas: { ancho_m: 3 },
      repeticiones: 1,
      densidad: "media",
      mezcla: "clasica",
      materiales: [{ product_id: "P-ROSA", color: "rosa", participacion: 1, rol_material: "principal" }],
      porque: "Prueba",
    }],
    supuestos: [],
  });
  const restricciones = extraerRestriccionesUsuario("Quiero 2 arcos dorados con acabado cromado y 1 columna plateada");
  const erroresRestricciones = validarRestriccionesPlan(plan, restricciones);
  assert.ok(erroresRestricciones.length >= 3, erroresRestricciones.join(" | "));
  for (const error of erroresRestricciones) limpio(error, "validarRestriccionesPlan");
  assert.ok(erroresRestricciones.some((error) => error === "Pediste 2 arcos y la propuesta tiene 0 arcos."), erroresRestricciones.join(" | "));
  assert.ok(erroresRestricciones.some((error) => /Pediste el color dorado/.test(error)));
  for (const error of validarCardinalidadEventoAbierto(plan, "open", "fiesta de cumpleaños elegante", true)) limpio(error, "validarCardinalidadEventoAbierto");
  ok("errores de restricciones en español de cliente, sin tipos snake_case ni 'plan declara'");

  // 4. Ramas reales de confirmar_plan_decoracion (backend Next, Pool falso).
  const filas = [
    { product_id: "P-GLOBOS", variant_id: "V-R-12-ROJO", sku: "SKU-R-12-ROJO", producto_titulo: "Globo rojo", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["rojo"], colores_variante: ["rojo"], acabados_producto: [], descripcion: "Globo látex rojo R-12.", imagen: null },
    { product_id: "P-GLOBOS", variant_id: "V-R-12-DORADO", sku: "SKU-R-12-DORADO", producto_titulo: "Globo dorado", variante_titulo: "R-12", precio: 10500, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["dorado"], colores_variante: ["dorado"], acabados_producto: [], descripcion: "Globo látex dorado R-12.", imagen: null },
  ];
  const pool = { query: async (sql: string) => (sql.includes("catalog_variants") ? { rows: filas } : { rows: [] }) } as unknown as Pool;
  const llamada = { nombre: "confirmar_plan_decoracion", args: {} };
  const estructuraArco = (extra: Record<string, unknown> = {}) => ({
    estructura_id: "EST_01_ARCO",
    nombre: "Arco de cumpleaños",
    tipo: "arco",
    rol_escena: "focal",
    ubicacion: "arco_central",
    medidas: { ancho_m: 3, alto_m: 2.4 },
    repeticiones: 1,
    densidad: "lujosa",
    mezcla: "clasica",
    materiales: [
      { product_id: "P-GLOBOS", color: "rojo", participacion: 0.6, rol_material: "principal" },
      { product_id: "P-GLOBOS", color: "dorado", participacion: 0.4, rol_material: "secundario" },
    ],
    porque: "Arco principal.",
    ...extra,
  });
  const argsPlan = (estructuras: unknown[]) => ({
    concepto: { titulo: "Cumpleaños rojo y dorado", descripcion: "Arco de globos.", paleta: ["rojo", "dorado"] },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras,
    supuestos: [],
  });
  const registroPara = (solicitud: string, opciones: { catalogoLoraNoDisponible?: string; veredicto?: VeredictoResolucion } = {}) => {
    const { veredicto, ...resto } = opciones;
    instalarResolutorPythonFalso(veredicto ? { veredicto: () => veredicto } : {});
    const estado = crearEstadoConversacion({}, solicitud);
    estado.ragCatalogSnapshotId = SNAPSHOT_FALSO;
    estado.ragIdsRecuperados.add("P-GLOBOS");
    estado.ragVariantIdsRecuperados.set("P-GLOBOS", new Set(filas.map((fila) => fila.variant_id)));
    return crearRegistroHerramientas(estado, { pool, ...resto }).confirmar_plan_decoracion!;
  };
  const revisarRechazo = (salida: unknown, contexto: string): string => {
    assert.ok(typeof salida === "object" && salida !== null, contexto);
    const resultado = salida as Record<string, unknown>;
    assert.equal(resultado.ok, false, `${contexto}: ${JSON.stringify(resultado).slice(0, 300)}`);
    assert.equal(typeof resultado.mensaje_cliente, "string", `${contexto} sin mensaje_cliente: ${JSON.stringify(resultado).slice(0, 300)}`);
    limpio(String(resultado.mensaje_cliente), contexto);
    return String(resultado.status ?? "SIN_STATUS");
  };

  const statusVistos = new Set<string>();
  statusVistos.add(revisarRechazo(await registroPara("un arco rojo")({ concepto: {} }, llamada), "plan inválido"));
  statusVistos.add(revisarRechazo(await registroPara("Quiero 2 arcos rojos")(argsPlan([estructuraArco()]), llamada), "restricciones"));
  // El techo y el delta los decide el resolutor Python; lo que se comprueba
  // aquí es que el mensaje con el que Next se lo cuenta al cliente está limpio.
  statusVistos.add(revisarRechazo(await registroPara("un arco rojo y dorado, presupuesto máximo 5.000 pesos", {
    veredicto: { comercial: { estado: "PRESUPUESTO_EXCEDIDO", techo_cop: 5_000, delta_cop: 19_000 } },
  })(argsPlan([estructuraArco()]), llamada), "presupuesto"));
  statusVistos.add(revisarRechazo(await registroPara("un arco rojo", { catalogoLoraNoDisponible: "LORA_VOCABULARY_ALLOWLIST_EMPTY" })(argsPlan([estructuraArco()]), llamada), "catálogo LoRA bloqueado"));
  assert.ok(statusVistos.has("RESTRICCIONES_INCONSISTENTES"), [...statusVistos].join(","));
  assert.ok(statusVistos.has("PRESUPUESTO_EXCEDIDO"), [...statusVistos].join(","));
  assert.ok(statusVistos.has("CATALOGO_LORA_NO_DISPONIBLE"), [...statusVistos].join(","));
  ok(`confirmar_plan_decoracion: rechazos reales con mensaje_cliente limpio (${[...statusVistos].join(", ")})`);

  // 4b. Texto al agotar vueltas: con un plan ya verificado no se dice "me enredé".
  const { textoAlAgotarVueltas } = await import("../src/lib/ia/herramientas/registro-herramientas");
  instalarResolutorPythonFalso();
  const estadoConPlan = crearEstadoConversacion({}, "un arco rojo");
  estadoConPlan.ragCatalogSnapshotId = SNAPSHOT_FALSO;
  estadoConPlan.ragIdsRecuperados.add("P-GLOBOS");
  estadoConPlan.ragVariantIdsRecuperados.set("P-GLOBOS", new Set(filas.map((fila) => fila.variant_id)));
  const confirmada = await crearRegistroHerramientas(estadoConPlan, { pool }).confirmar_plan_decoracion!(argsPlan([estructuraArco({ nombre: "Arco rojo", densidad: "sencilla", medidas: { ancho_m: 1.5, alto_m: 1.8 } })]), llamada);
  assert.ok(estadoConPlan.planResuelto, `el plan de prueba debe quedar verificado: ${JSON.stringify(confirmada).slice(0, 300)}`);
  const textoPlan = textoAlAgotarVueltas(estadoConPlan);
  assert.doesNotMatch(textoPlan, /me enredé/);
  limpio(textoPlan, "textoAlAgotarVueltas con plan");
  assert.match(textoAlAgotarVueltas(crearEstadoConversacion({}, "hola")), /me enredé/);
  ok("al agotar vueltas con un plan verificado, el texto remite a la propuesta en pantalla");

  // 5. Prompt del sistema y descripciones de herramientas.
  const sistema = construirSistema({ ragEnabled: true });
  assert.match(sistema, /CÓMO HABLAS DE LO INTERNO/);
  assert.match(sistema, /mensaje_cliente/);
  assert.doesNotMatch(sistema, /usa su status\/errores\/accion_requerida/);
  assert.doesNotMatch(sistema, /SKU exacto/);
  assert.doesNotMatch(sistema, /son el vocabulario para referirte a la escena/);
  for (const herramienta of [...HERRAMIENTAS_RAG, ...HERRAMIENTAS_PLAN]) assert.doesNotMatch(herramienta.descripcion, /SKU exacto/, herramienta.nombre);
  ok("prompt del sistema: prohíbe citar lo interno, remite a mensaje_cliente y ya no pide SKU ni status");

  console.log(`\n${casos} casos OK (jerga interna)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
