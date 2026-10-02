/**
 * Las herramientas del motor del diseñador en el agente de chat (ADR-0034 §5), del lado de Next.
 *
 * - detrás de `ARMADO_ARCO_COLUMNA_V1` el modelo ve `consultar_opciones_armado` y `armar_estructura`, y con
 *   la bandera apagada no las ve;
 * - la consulta devuelve los catorce patrones del arco con sus mandos, y los acabados y repartos de la
 *   guirnalda orgánica —que no tiene patrón—, tal como los publica el motor
 *   (`scripts/fixtures/armado-estructura-ia/respuestas.json`, generado con `services/ai-api`);
 * - un armado válido pasa y queda guardado en el estado del turno; uno con un patrón inexistente o con un
 *   color que la pieza no lleva se rechaza con su motivo, y el estado no guarda nada;
 * - un plan confirmado sin armado sale con el armado que completó el servidor, y ese armado llega al plan que
 *   Python resuelve y sobrevive a la resolución;
 * - una guirnalda puede traer **los dos** armados (el de ADR-0032 y el del motor) y escribir el del motor no
 *   toca el viejo, ni encendida ni apagada la bandera;
 * - si el servicio de armado no responde, la confirmación sigue devolviendo `ok: true`, el plan va sin
 *   armado y el fallo queda anotado: el armado enriquece una propuesta, no la autoriza;
 * - con la bandera apagada, un `armado_arco` en los argumentos del modelo no entra en el plan.
 *
 * Qué NO se prueba aquí: qué patrón elige el motor, cómo coloca los globos ni si un armado se sostiene. Eso
 * es de `app/arco/`, `app/columna/` y `tests/test_omoikane_armado_estructura.py`. Offline, sin proveedores.
 * Run: npx tsx --conditions=react-server scripts/test/test-armado-estructura-ia.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import {
  instalarResolutorPythonFalso,
  prepararEntornoPythonFalso,
  SNAPSHOT_FALSO,
  type LlamadaPython,
} from "../lib/resolutor-python-falso";

prepararEntornoPythonFalso();

type Json = Record<string, unknown>;

const RUTA_ARMADO = "/internal/v1/omoikane/armado-estructura";
const RESPUESTAS = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/fixtures/armado-estructura-ia/respuestas.json"), "utf8"),
) as Record<string, Json>;

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

/** La envoltura operativa con la que Python contesta, con los ids que el adaptador exige de vuelta. */
function respuestaPython(llamada: LlamadaPython, payload: unknown): Response {
  const contexto = llamada.body.context as Json;
  return Response.json({
    schema_version: "operational.v1",
    request_id: contexto.request_id,
    correlation_id: contexto.correlation_id,
    payload,
  });
}

/** Un rechazo de dominio de Python, con la forma que `upstreamDomainDetails` sabe leer. */
function rechazoPython(motivo: string, mensaje: string, estructuraId: string): Response {
  return Response.json(
    { detail: { code: "armado_invalido", motivo, mensaje, estructura_id: estructuraId } },
    { status: 422 },
  );
}

const FILAS = [
  { product_id: "P-GLOBOS", variant_id: "V-R-12-ROSA", sku: "SKU-ROSA", producto_titulo: "Globo rosado", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["rosado"], colores_variante: ["rosado"], acabados_producto: [], descripcion: "Globo látex rosado R-12.", imagen: null },
  { product_id: "P-GLOBOS", variant_id: "V-R-12-BLANCO", sku: "SKU-BLANCO", producto_titulo: "Globo blanco", variante_titulo: "R-12", precio: 10500, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["blanco"], colores_variante: ["blanco"], acabados_producto: [], descripcion: "Globo látex blanco R-12.", imagen: null },
];
const POOL = { query: async (sql: string) => (sql.includes("catalog_variants") ? { rows: FILAS } : { rows: [] }) } as unknown as Pool;

/** Un pool que además recuerda el `status` de cada fila de `plan_audit_log`, para poder mirar lo que se anotó. */
function poolQueAnota(): { pool: Pool; auditoria: string[] } {
  const auditoria: string[] = [];
  const pool = {
    query: async (sql: string, parametros?: unknown[]) => {
      if (sql.includes("plan_audit_log") && Array.isArray(parametros)) auditoria.push(String(parametros[15]));
      return sql.includes("catalog_variants") ? { rows: FILAS } : { rows: [] };
    },
  } as unknown as Pool;
  return { pool, auditoria };
}
const LLAMADA = { nombre: "armar_estructura", args: {} };

const ARCO: Json = {
  estructura_id: "EST_01_ARCO",
  nombre: "Arco de cumpleaños",
  tipo: "arco",
  rol_escena: "focal",
  ubicacion: "arco_central",
  medidas: { ancho_m: 3.2, alto_m: 2.3 },
  repeticiones: 1,
  densidad: "media",
  mezcla: "clasica",
  materiales: [
    { product_id: "P-GLOBOS", color: "rosado", participacion: 0.6, rol_material: "principal" },
    { product_id: "P-GLOBOS", color: "blanco", participacion: 0.4, rol_material: "secundario" },
  ],
  porque: "Arco principal.",
};

/** Un `armado-guirnalda.v1` de ADR-0032: el que NO es del motor. Está aquí para comprobar que convive. */
const ARMADO_GUIRNALDA_ADR_0032: Json = {
  version: "armado-guirnalda.v1",
  origen: "sugerido",
  soporte: "pared",
  forma: "recta",
  racimo: { unidad: "cuarteto", tamano_pulg_base: 12 },
  relleno: null,
  remates: [],
};

const GUIRNALDA: Json = {
  estructura_id: "EST_02_GUIRNALDA",
  nombre: "Guirnalda del mesón",
  tipo: "guirnalda",
  estructura_oficial: "guirnalda",
  rol_escena: "focal",
  ubicacion: "fondo_pared",
  medidas: { largo_m: 4.5 },
  repeticiones: 1,
  densidad: "media",
  mezcla: "clasica",
  materiales: [
    { product_id: "P-GLOBOS", color: "rosado", participacion: 0.6, rol_material: "principal" },
    { product_id: "P-GLOBOS", color: "blanco", participacion: 0.4, rol_material: "secundario" },
  ],
  porque: "Acompaña la mesa.",
};

function argsPlan(estructuras: Json[]): Json {
  return {
    concepto: { titulo: "Cumpleaños rosado", descripcion: "Arco de globos.", paleta: ["rosado", "blanco"] },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras,
    supuestos: [],
  };
}

async function main(): Promise<void> {
  const { crearEstadoConversacion, crearRegistroHerramientas, herramientasActivas, HERRAMIENTAS_SOLO_LECTURA } = await import("../../src/lib/ia/herramientas/registro-herramientas");
  const { ARMAR_ESTRUCTURA, CONSULTAR_OPCIONES_ARMADO } = await import("../../src/lib/ia/herramientas/herramientas");
  const { CLAVES_ARMADO_MOTOR, CLAVE_ARMADO, TIPOS_ARMADO_MOTOR, aplicarArmadosCompletados, piezaDeEstructura, sinArmadosDeMotor, sinColumnaOrganicaDelModelo, CLAVES_FUERA_DEL_MODELO } = await import("../../src/lib/plan/armado-estructura-ia");
  const { PlanDecoracionSchema } = await import("../../src/lib/plan/tipos");

  // ---------------------------------------------------------------------------
  // 1. Las herramientas solo existen con la bandera encendida.
  const conBandera = herramientasActivas({ armadoMotor: true, estimarConteo: false }).map((herramienta) => herramienta.nombre);
  // `estimarConteo: false`: esta prueba es de la bandera del armado; estimar_conteo_globos tiene la suya (test-estimar-conteo-globos.ts).
  const sinBandera = herramientasActivas({ armadoMotor: false, estimarConteo: false }).map((herramienta) => herramienta.nombre);
  assert.ok(conBandera.includes("consultar_opciones_armado") && conBandera.includes("armar_estructura"), conBandera.join(","));
  assert.ok(!sinBandera.includes("consultar_opciones_armado") && !sinBandera.includes("armar_estructura"), sinBandera.join(","));
  assert.deepEqual(sinBandera, ["guardar_brief", "buscar_catalogo_rag", "confirmar_seleccion_rag", "confirmar_plan_decoracion"]);
  // La consulta es de solo lectura (no toca el estado del turno); armar no, porque lo guarda.
  assert.ok(HERRAMIENTAS_SOLO_LECTURA.has("consultar_opciones_armado"));
  assert.ok(!HERRAMIENTAS_SOLO_LECTURA.has("armar_estructura"));
  ok("las dos herramientas entran detrás de ARMADO_ARCO_COLUMNA_V1 y solo la consulta es de lectura");

  // ---------------------------------------------------------------------------
  // 1b. Los tres tipos con motor, y qué campo del plan lleva cada uno. `armado_guirnalda` (ADR-0032) no es
  //     de esta capacidad y por eso no está entre las claves que decide.
  assert.deepEqual([...TIPOS_ARMADO_MOTOR], ["arco", "columna", "guirnalda"]);
  assert.deepEqual(CLAVE_ARMADO, { arco: "armado_arco", columna: "armado_columna", guirnalda: "armado_guirnalda_organica" });
  assert.ok(!(CLAVES_ARMADO_MOTOR as readonly string[]).includes("armado_guirnalda"));
  ok("los tres tipos con motor y su campo del plan; el armado de ADR-0032 no es de esta capacidad");

  // ---------------------------------------------------------------------------
  // 2. Los esquemas que ve el modelo: ningún id de patrón escrito a mano aquí.
  const esquemaArmar = JSON.stringify(ARMAR_ESTRUCTURA.esquema);
  assert.deepEqual((CONSULTAR_OPCIONES_ARMADO.esquema.required as string[]), ["tipo"]);
  assert.deepEqual(((CONSULTAR_OPCIONES_ARMADO.esquema.properties as Json).tipo as Json).enum, ["arco", "columna", "guirnalda"]);
  // `patron` y `materiales` dejan de ser obligatorios: una guirnalda no tiene patrón. La condición por tipo
  // la exige el Zod del handler y la cuenta la descripción, porque el proveedor no respeta un `oneOf`.
  assert.deepEqual(ARMAR_ESTRUCTURA.esquema.required, ["estructura_id", "tipo", "colores"]);
  // Ninguna lista que el motor publique se copia aquí: ni los ids de patrón, ni los acabados del látex, ni
  // los repartos de color. El modelo los pide con consultar_opciones_armado y Python los comprueba.
  for (const valor of ["espiral", "chevron", "arcoiris", "floral", "mate", "cromado", "confeti", "azar", "tramos", "racimos", "acento"]) {
    assert.doesNotMatch(esquemaArmar, new RegExp(`"${valor}"`), `el esquema no fija ninguna lista del motor: ${valor}`);
  }
  // Los mandos del patrón van como pares porque cada patrón tiene los suyos...
  const opciones = (ARMAR_ESTRUCTURA.esquema.properties as Json).opciones as Json;
  assert.equal(opciones.type, "array");
  assert.deepEqual(((opciones.items as Json).required as string[]), ["clave", "valor"]);
  // ...y los bloques de la guirnalda no, porque sus claves son fijas y las publica el contrato.
  const propiedades = ARMAR_ESTRUCTURA.esquema.properties as Json;
  assert.equal((propiedades.forma as Json).type, "object");
  assert.deepEqual(Object.keys((propiedades.forma as Json).properties as Json), ["largo_m", "altura_m", "pendiente_m", "onda_m", "ondas", "colgado_m", "festones", "carga", "suelo"]);
  assert.deepEqual(Object.keys((propiedades.volumen as Json).properties as Json), ["grosor_extremos_m", "grosor_centro_m", "irregularidad", "relleno", "racimo", "salientes"]);
  assert.deepEqual(Object.keys((propiedades.adornos as Json).properties as Json), ["follaje", "flores"]);
  assert.deepEqual(((propiedades.paleta as Json).items as Json).required, ["material"]);
  // Los adornos no se cobran, y el esquema se lo dice al modelo donde no pueda no verlo.
  assert.match(String((propiedades.adornos as Json).description), /NO se cotizan/);
  ok("el esquema de armar_estructura: patrón y materiales opcionales por tipo, y ninguna lista del motor");

  // ---------------------------------------------------------------------------
  // 2b. El prompt nombra las dos herramientas solo con la bandera encendida, y
  //     no repite la lista de patrones: esa la publica el motor.
  const { construirSistema, BLOQUE_ARMADO_MOTOR } = await import("../../src/lib/ia/omoikane/prompt-sistema");
  const previo = process.env.ARMADO_ARCO_COLUMNA_V1;
  process.env.ARMADO_ARCO_COLUMNA_V1 = "true";
  assert.match(construirSistema({ ragEnabled: true }), /consultar_opciones_armado[\s\S]{0,400}armar_estructura/);
  process.env.ARMADO_ARCO_COLUMNA_V1 = "false";
  assert.doesNotMatch(construirSistema({ ragEnabled: true }), /consultar_opciones_armado|armar_estructura/);
  if (previo === undefined) delete process.env.ARMADO_ARCO_COLUMNA_V1; else process.env.ARMADO_ARCO_COLUMNA_V1 = previo;
  for (const patron of ["espiral", "chevron", "arcoiris", "floral", "doslados"]) {
    assert.doesNotMatch(BLOQUE_ARMADO_MOTOR, new RegExp(patron), `el prompt no repite la lista de patrones: ${patron}`);
  }
  ok("el prompt explica el flujo detrás de la bandera y no copia la lista de patrones del motor");

  // ---------------------------------------------------------------------------
  // 3. La consulta devuelve los catorce patrones del arco, con sus mandos.
  const registroConsulta = (payload: unknown) => {
    instalarResolutorPythonFalso({ otrasRutas: (llamada) => respuestaPython(llamada, payload) });
    return crearRegistroHerramientas(crearEstadoConversacion({}, "un arco rosado"), { pool: POOL });
  };
  const catalogo = await registroConsulta(RESPUESTAS.catalogo_arco)
    .consultar_opciones_armado!({ tipo: "arco" }, LLAMADA);
  assert.equal(catalogo.ok, true, JSON.stringify(catalogo).slice(0, 300));
  const patrones = ((catalogo.opciones as Json).patrones as Json[]);
  assert.equal(patrones.length, 14, "los catorce patrones del diseñador");
  assert.deepEqual(patrones.map((patron) => patron.id), [
    "solido", "bloques", "apilado", "espiral", "espiralPunteada", "zigzag", "chevron",
    "diamante", "punteado", "franjas", "floral", "ombre", "arcoiris", "doslados",
  ]);
  const solido = patrones.find((patron) => patron.id === "solido")!;
  assert.deepEqual([solido.min_colores, solido.max_colores], [1, 1]);
  const espiral = patrones.find((patron) => patron.id === "espiral")!;
  assert.deepEqual((espiral.controles as Json[]).map((control) => control.clave), ["ancho", "inclinacion", "inversion", "espejo"]);
  assert.ok((espiral.controles as Json[]).every((control) => typeof control.min === "number" && typeof control.max === "number" && typeof control.defecto === "number"));
  const columna = await registroConsulta(RESPUESTAS.catalogo_columna)
    .consultar_opciones_armado!({ tipo: "columna" }, LLAMADA);
  assert.equal(((columna.opciones as Json).patrones as Json[]).length, 9);
  ok("consultar_opciones_armado: los catorce patrones del arco con sus mandos, y los nueve de la columna");

  // ---------------------------------------------------------------------------
  // 4b. La guirnalda no tiene patrones: lo que publica son acabados, repartos y papeles.
  const catalogoGuirnalda = await registroConsulta(RESPUESTAS.catalogo_guirnalda)
    .consultar_opciones_armado!({ tipo: "guirnalda" }, LLAMADA);
  assert.equal(catalogoGuirnalda.ok, true, JSON.stringify(catalogoGuirnalda).slice(0, 300));
  const opcionesGuirnalda = catalogoGuirnalda.opciones as Json;
  assert.equal(opcionesGuirnalda.patrones, undefined, "una guirnalda orgánica no tiene patrón");
  assert.deepEqual((opcionesGuirnalda.acabados as Json[]).map((acabado) => acabado.valor), ["mate", "cromado", "confeti", "transparente"]);
  assert.deepEqual((opcionesGuirnalda.repartos as Json[]).map((reparto) => reparto.valor), ["azar", "tramos", "racimos"]);
  // Cada reparto llega con su ayuda, que es lo que el modelo no puede adivinar.
  assert.ok((opcionesGuirnalda.repartos as Json[]).every((reparto) => typeof reparto.ayuda === "string"));
  assert.deepEqual(opcionesGuirnalda.roles, ["normal", "acento"]);
  assert.equal(typeof (opcionesGuirnalda.largo_m as Json).max, "number");
  ok("consultar_opciones_armado: la guirnalda publica acabados, repartos y papeles, no patrones");

  // ---------------------------------------------------------------------------
  // 4. Un tipo sin motor migrado no llega a Python: una pared o un centro de mesa siguen por el camino de
  //    siempre, y `armado_guirnalda` de ADR-0032 no es un "tipo" que se pueda consultar.
  for (const tipo of ["pared", "centro_mesa", "bouquet", "armado_guirnalda"]) {
    const llamadas = instalarResolutorPythonFalso({ otrasRutas: (llamada) => respuestaPython(llamada, RESPUESTAS.catalogo_arco) });
    const sinTipo = await crearRegistroHerramientas(crearEstadoConversacion({}, "una pared"), { pool: POOL })
      .consultar_opciones_armado!({ tipo }, LLAMADA);
    assert.equal(sinTipo.ok, false, tipo);
    assert.equal(sinTipo.status, "ARGUMENTOS_INVALIDOS", tipo);
    assert.equal(llamadas.length, 0, `no se llama a Python por ${tipo}`);
  }
  ok("un tipo sin motor se rechaza en la frontera, sin llamar a Python");

  // ---------------------------------------------------------------------------
  // 5. Un armado válido pasa, devuelve lo que lleva y queda guardado en el turno.
  const estadoArmado = crearEstadoConversacion({}, "un arco rosado y blanco");
  const llamadasArmado = instalarResolutorPythonFalso({ otrasRutas: (llamada) => respuestaPython(llamada, RESPUESTAS.armar_arco) });
  const armado = await crearRegistroHerramientas(estadoArmado, { pool: POOL })
    .armar_estructura!({ estructura_id: "EST_01_ARCO", tipo: "arco", colores: 2, patron: "chevron", materiales: [0, 1], opciones: [{ clave: "ancho", valor: 3 }] }, LLAMADA);
  assert.equal(armado.ok, true, JSON.stringify(armado).slice(0, 400));
  assert.equal(armado.status, "ARMADO_VALIDO");
  assert.equal(armado.patron, "chevron");
  assert.ok((armado.resumen as Json).total_globos as number > 0);
  assert.equal(typeof (armado.resumen as Json).largo_m, "number");
  // El cuerpo que viajó: los mandos como mapa, la pieza con sus medidas, nada más.
  const cuerpoArmado = llamadasArmado.find((llamada) => llamada.path === RUTA_ARMADO)!.body;
  assert.equal(cuerpoArmado.accion, "armar");
  assert.deepEqual(cuerpoArmado.opciones, { ancho: 3 });
  assert.deepEqual(cuerpoArmado.pieza, { tipo: "arco", colores: 2 });
  assert.deepEqual(cuerpoArmado.materiales, [0, 1]);
  assert.equal(estadoArmado.armadosEstructura?.get("EST_01_ARCO")?.tipo, "arco");
  const guardado = estadoArmado.armadosEstructura?.get("EST_01_ARCO")?.armado;
  assert.equal(guardado && "patron" in guardado ? guardado.patron : undefined, "chevron");
  ok("armar_estructura: un armado válido pasa, dice lo que lleva y queda guardado para la confirmación");

  // ---------------------------------------------------------------------------
  // 6b. Y una guirnalda, que se arma con su paleta en vez de con un patrón.
  const estadoGuirnalda = crearEstadoConversacion({}, "una guirnalda rosada y blanca");
  const llamadasGuirnalda = instalarResolutorPythonFalso({ otrasRutas: (llamada) => respuestaPython(llamada, RESPUESTAS.armar_guirnalda) });
  const guirnalda = await crearRegistroHerramientas(estadoGuirnalda, { pool: POOL })
    .armar_estructura!({
      estructura_id: "EST_02_GUIRNALDA",
      tipo: "guirnalda",
      colores: 2,
      paleta: [{ material: 0 }, { material: 1, rol: "acento" }],
      reparto: "racimos",
      tamanos: [{ tamano: 5, peso: 30 }, { tamano: 12, peso: 50 }, { tamano: 18, peso: 20 }],
      forma: { ondas: 2 },
      adornos: { follaje: 1 },
    }, LLAMADA);
  assert.equal(guirnalda.ok, true, JSON.stringify(guirnalda).slice(0, 500));
  // No hay patrón que devolver: lo que la describe es su reparto de color.
  assert.equal(guirnalda.patron, undefined);
  assert.equal(guirnalda.reparto, "racimos");
  assert.deepEqual(guirnalda.colores_usados, [0, 1]);
  const resumenGuirnalda = guirnalda.resumen as Json;
  assert.ok((resumenGuirnalda.total_globos as number) > 0);
  assert.equal(resumenGuirnalda.sueltos, 0, "el motor separa los globos hasta que todos se tocan");
  assert.equal(typeof (resumenGuirnalda.adornos as Json).ramas, "number");
  assert.equal(estadoGuirnalda.armadosEstructura?.get("EST_02_GUIRNALDA")?.tipo, "guirnalda");
  // El cuerpo que viajó: la paleta y los bloques de la guirnalda, y nada del patrón.
  const cuerpoGuirnalda = llamadasGuirnalda.find((llamada) => llamada.path === RUTA_ARMADO)!.body;
  assert.deepEqual(cuerpoGuirnalda.paleta, [{ material: 0 }, { material: 1, rol: "acento" }]);
  assert.deepEqual(cuerpoGuirnalda.tamanos, [{ tamano: 5, peso: 30 }, { tamano: 12, peso: 50 }, { tamano: 18, peso: 20 }]);
  assert.deepEqual(cuerpoGuirnalda.forma, { ondas: 2 });
  assert.equal(cuerpoGuirnalda.patron, undefined);
  assert.equal(cuerpoGuirnalda.materiales, undefined);
  assert.equal(cuerpoGuirnalda.opciones, undefined);
  ok("armar_estructura: una guirnalda se arma con su paleta y su línea, sin patrón");

  // ---------------------------------------------------------------------------
  // 6c. Sin paleta no se llama a Python: una guirnalda sin colores no es un armado.
  const sinPaleta = await crearRegistroHerramientas(crearEstadoConversacion({}, "una guirnalda"), { pool: POOL })
    .armar_estructura!({ estructura_id: "EST_02_GUIRNALDA", tipo: "guirnalda", colores: 2 }, LLAMADA);
  assert.equal(sinPaleta.ok, false);
  assert.equal(sinPaleta.status, "ARGUMENTOS_INVALIDOS");
  assert.ok((sinPaleta.errores as string[]).some((error) => error.startsWith("paleta:")), JSON.stringify(sinPaleta.errores));
  // Y un arco sin patrón tampoco.
  const sinPatron = await crearRegistroHerramientas(crearEstadoConversacion({}, "un arco"), { pool: POOL })
    .armar_estructura!({ estructura_id: "EST_01_ARCO", tipo: "arco", colores: 2, materiales: [0, 1] }, LLAMADA);
  assert.equal(sinPatron.status, "ARGUMENTOS_INVALIDOS");
  assert.ok((sinPatron.errores as string[]).some((error) => error.startsWith("patron:")));
  ok("la condición por tipo se exige en la frontera: guirnalda sin paleta y arco sin patrón no llegan a Python");

  // ---------------------------------------------------------------------------
  // 6. Un patrón inexistente y un color fuera de la pieza se rechazan con su motivo.
  for (const [motivo, mensaje, args] of [
    ["patron_desconocido", "«mirlo» no es un patron de arco.", { estructura_id: "EST_01_ARCO", tipo: "arco", colores: 2, patron: "mirlo", materiales: [0, 1] }],
    ["material_fuera_de_rango", "La pieza lleva 2 colores y el armado nombra el indice 5.", { estructura_id: "EST_01_ARCO", tipo: "arco", colores: 2, patron: "espiral", materiales: [0, 5] }],
  ] as const) {
    const estado = crearEstadoConversacion({}, "un arco rosado");
    instalarResolutorPythonFalso({ otrasRutas: () => rechazoPython(motivo, mensaje, "EST_01_ARCO") });
    const rechazo = await crearRegistroHerramientas(estado, { pool: POOL }).armar_estructura!(args as unknown as Json, LLAMADA);
    assert.equal(rechazo.ok, false, JSON.stringify(rechazo).slice(0, 300));
    assert.equal(rechazo.status, "ARMADO_INVALIDO");
    assert.equal(rechazo.motivo, motivo);
    assert.equal(rechazo.detalle, mensaje);
    assert.equal(estado.armadosEstructura, undefined, "un armado rechazado no se guarda");
  }
  ok("armar_estructura: patrón inexistente y color fuera de la pieza se rechazan con el motivo del motor");

  // ---------------------------------------------------------------------------
  // 7b. Lo mismo en la guirnalda: un acabado o un reparto que el motor no conoce.
  for (const [motivo, mensaje, args] of [
    ["acabado_desconocido", "«reflex» no es un acabado. Los que hay: mate, cromado, confeti, transparente.", { estructura_id: "EST_02_GUIRNALDA", tipo: "guirnalda", colores: 2, paleta: [{ material: 0, acabado: "reflex" }] }],
    ["reparto_desconocido", "«espiral» no es un reparto. Los que hay: azar, tramos, racimos.", { estructura_id: "EST_02_GUIRNALDA", tipo: "guirnalda", colores: 2, paleta: [{ material: 0 }], reparto: "espiral" }],
  ] as const) {
    const estado = crearEstadoConversacion({}, "una guirnalda");
    instalarResolutorPythonFalso({ otrasRutas: () => rechazoPython(motivo, mensaje, "EST_02_GUIRNALDA") });
    const rechazo = await crearRegistroHerramientas(estado, { pool: POOL }).armar_estructura!(args as unknown as Json, LLAMADA);
    assert.equal(rechazo.status, "ARMADO_INVALIDO", JSON.stringify(rechazo).slice(0, 300));
    assert.equal(rechazo.motivo, motivo);
    assert.equal(rechazo.detalle, mensaje);
    assert.equal(estado.armadosEstructura, undefined);
  }
  ok("armar_estructura: un acabado o un reparto que el motor no conoce se rechaza con su motivo");

  // ---------------------------------------------------------------------------
  // 7. Un plan confirmado sin armado sale con el armado que completó el servidor,
  //    y ese armado llega al plan que Python resuelve.
  const recetaArco = (RESPUESTAS.completar_receta as Json).armados as Json[];
  const estadoConfirmar = crearEstadoConversacion({}, "un arco rosado y blanco");
  estadoConfirmar.ragCatalogSnapshotId = SNAPSHOT_FALSO;
  estadoConfirmar.ragIdsRecuperados.add("P-GLOBOS");
  estadoConfirmar.ragVariantIdsRecuperados.set("P-GLOBOS", new Set(FILAS.map((fila) => fila.variant_id)));
  const llamadas = instalarResolutorPythonFalso({
    otrasRutas: (llamada) => respuestaPython(llamada, {
      operation_schema_version: "omoikane-armado-estructura-result.v1",
      accion: "completar",
      // Solo el arco: el plan de esta prueba no tiene columna.
      armados: recetaArco.filter((completado) => completado.tipo === "arco"),
    }),
  });
  const confirmado = await crearRegistroHerramientas(estadoConfirmar, { pool: POOL })
    .confirmar_plan_decoracion!(argsPlan([ARCO]), LLAMADA);
  assert.equal(confirmado.ok, true, JSON.stringify(confirmado).slice(0, 400));
  const completar = llamadas.find((llamada) => llamada.path === RUTA_ARMADO);
  assert.ok(completar, `no se pidió el armado: ${llamadas.map((llamada) => llamada.path).join(",")}`);
  assert.equal(completar.body.accion, "completar");
  assert.equal((completar.body.armados as unknown), undefined, "sin armados del modelo no viaja la lista");
  const resuelve = llamadas.filter((llamada) => llamada.path === "/internal/v1/plan/resolve");
  assert.equal(resuelve.length, 1);
  const estructuraEnviada = ((resuelve[0]!.body.plan as Json).estructuras as Json[])[0]!;
  assert.ok(estructuraEnviada.armado_arco, "el armado llega al plan que Python resuelve");
  assert.equal((estructuraEnviada.armado_arco as Json).version, "armado-arco.v1");
  assert.equal((estructuraEnviada.armado_arco as Json).origen, "sugerido");
  // Sobrevive a la resolución: el plan con su armado sigue siendo un plan válido.
  assert.equal(PlanDecoracionSchema.safeParse(resuelve[0]!.body.plan).success, true);
  assert.ok(estadoConfirmar.planResuelto, "el plan quedó verificado con su armado dentro");
  ok("un plan confirmado sin armado sale con el del servidor, y ese armado llega al plan resuelto");

  // ---------------------------------------------------------------------------
  // 8. El armado que el modelo armó en el turno viaja a Python para revalidarse.
  const estadoConArmado = crearEstadoConversacion({}, "un arco rosado y blanco");
  estadoConArmado.ragCatalogSnapshotId = SNAPSHOT_FALSO;
  estadoConArmado.ragIdsRecuperados.add("P-GLOBOS");
  estadoConArmado.ragVariantIdsRecuperados.set("P-GLOBOS", new Set(FILAS.map((fila) => fila.variant_id)));
  const armadoDelModelo = (RESPUESTAS.armar_arco as Json).armado as Json;
  estadoConArmado.armadosEstructura = new Map([["EST_01_ARCO", { tipo: "arco", armado: armadoDelModelo as never }]]);
  const llamadasConArmado = instalarResolutorPythonFalso({
    otrasRutas: (llamada) => respuestaPython(llamada, {
      operation_schema_version: "omoikane-armado-estructura-result.v1",
      accion: "completar",
      armados: [{ estructura_id: "EST_01_ARCO", tipo: "arco", clave: "armado_arco", origen: "modelo", armado: armadoDelModelo, avisos: [] }],
    }),
  });
  await crearRegistroHerramientas(estadoConArmado, { pool: POOL }).confirmar_plan_decoracion!(argsPlan([ARCO]), LLAMADA);
  const completarConArmado = llamadasConArmado.find((llamada) => llamada.path === RUTA_ARMADO)!;
  assert.deepEqual(completarConArmado.body.armados, [{ estructura_id: "EST_01_ARCO", tipo: "arco", armado: armadoDelModelo }]);
  const planResuelto = llamadasConArmado.find((llamada) => llamada.path === "/internal/v1/plan/resolve")!;
  assert.deepEqual(((planResuelto.body.plan as Json).estructuras as Json[])[0]!.armado_arco, armadoDelModelo);
  ok("lo que armó el modelo viaja a Python para revalidarse y, si se sostiene, entra en la pieza");

  // ---------------------------------------------------------------------------
  // 9. Y el que el modelo escriba directamente en los argumentos de
  //    confirmar_plan_decoracion: el contrato del plan lo admite, Python lo
  //    revalida y de ahí sale lo que entra en la pieza.
  const estadoEnArgs = crearEstadoConversacion({}, "un arco rosado y blanco");
  estadoEnArgs.ragCatalogSnapshotId = SNAPSHOT_FALSO;
  estadoEnArgs.ragIdsRecuperados.add("P-GLOBOS");
  estadoEnArgs.ragVariantIdsRecuperados.set("P-GLOBOS", new Set(FILAS.map((fila) => fila.variant_id)));
  const llamadasEnArgs = instalarResolutorPythonFalso({
    otrasRutas: (llamada) => respuestaPython(llamada, {
      operation_schema_version: "omoikane-armado-estructura-result.v1",
      accion: "completar",
      armados: [{ estructura_id: "EST_01_ARCO", tipo: "arco", clave: "armado_arco", origen: "modelo", armado: armadoDelModelo, avisos: [] }],
    }),
  });
  const confirmadoEnArgs = await crearRegistroHerramientas(estadoEnArgs, { pool: POOL })
    .confirmar_plan_decoracion!(argsPlan([{ ...ARCO, armado_arco: armadoDelModelo }]), LLAMADA);
  assert.equal(confirmadoEnArgs.ok, true, JSON.stringify(confirmadoEnArgs).slice(0, 400));
  const completarEnArgs = llamadasEnArgs.find((llamada) => llamada.path === RUTA_ARMADO)!;
  // Viajó dentro de la estructura del plan, para que Python lo valide contra la pieza de verdad.
  assert.deepEqual(((completarEnArgs.body.plan as Json).estructuras as Json[])[0]!.armado_arco, armadoDelModelo);
  const resueltoEnArgs = llamadasEnArgs.find((llamada) => llamada.path === "/internal/v1/plan/resolve")!;
  assert.deepEqual(((resueltoEnArgs.body.plan as Json).estructuras as Json[])[0]!.armado_arco, armadoDelModelo);
  ok("confirmar_plan_decoracion puede llevar el armado_arco de la estructura y llega al plan resuelto");

  // ---------------------------------------------------------------------------
  // 10. Con la bandera apagada, un armado en los argumentos del modelo no entra en el plan.
  const estadoApagado = crearEstadoConversacion({}, "un arco rosado y blanco");
  estadoApagado.ragCatalogSnapshotId = SNAPSHOT_FALSO;
  estadoApagado.ragIdsRecuperados.add("P-GLOBOS");
  estadoApagado.ragVariantIdsRecuperados.set("P-GLOBOS", new Set(FILAS.map((fila) => fila.variant_id)));
  const anterior = process.env.ARMADO_ARCO_COLUMNA_V1;
  process.env.ARMADO_ARCO_COLUMNA_V1 = "false";
  const llamadasApagado = instalarResolutorPythonFalso();
  await crearRegistroHerramientas(estadoApagado, { pool: POOL })
    .confirmar_plan_decoracion!(argsPlan([{ ...ARCO, armado_arco: armadoDelModelo }]), LLAMADA);
  if (anterior === undefined) delete process.env.ARMADO_ARCO_COLUMNA_V1; else process.env.ARMADO_ARCO_COLUMNA_V1 = anterior;
  assert.ok(!llamadasApagado.some((llamada) => llamada.path === RUTA_ARMADO), "apagada no se pide el armado");
  const planApagado = llamadasApagado.find((llamada) => llamada.path === "/internal/v1/plan/resolve")!;
  assert.equal(((planApagado.body.plan as Json).estructuras as Json[])[0]!.armado_arco, undefined);
  ok("con la bandera apagada el armado no se pide y no entra en el plan, venga de donde venga");


  // ---------------------------------------------------------------------------
  // 17. El servicio de armado caído NO tumba la confirmación. Completar el armado es enriquecimiento, no una
  //     puerta: un plan válido se confirma igual, por el camino de siempre y sin armado. Es el mismo criterio
  //     que `_completar_armados_guirnalda` en plan.py, donde una pieza que no se puede arreglar simplemente
  //     se queda sin armado; lo único duro allá es resolver un armado que la pieza YA declara.
  //     El respaldo es deliberado, así que queda anotado con su motivo.
  const { esperarObservabilidadPendiente } = await import("../../src/lib/rag/observability/log");
  for (const [caso, caido] of [
    ["sin respuesta del servicio", () => new Response("sin armado", { status: 503 })],
    ["el servicio contesta algo que no es un armado", (llamada: LlamadaPython) => respuestaPython(llamada, { operation_schema_version: "otra-cosa.v1" })],
  ] as const) {
    const { pool, auditoria } = poolQueAnota();
    const estadoCaido = crearEstadoConversacion({}, "un arco rosado y blanco");
    estadoCaido.ragCatalogSnapshotId = SNAPSHOT_FALSO;
    estadoCaido.ragIdsRecuperados.add("P-GLOBOS");
    estadoCaido.ragVariantIdsRecuperados.set("P-GLOBOS", new Set(FILAS.map((fila) => fila.variant_id)));
    // El modelo armó algo en el turno y además lo escribió en los argumentos: con el motor caído no entra
    // ninguno de los dos, porque la puerta no los validó contra la pieza.
    estadoCaido.armadosEstructura = new Map([["EST_01_ARCO", { tipo: "arco", armado: armadoDelModelo as never }]]);
    const llamadasCaido = instalarResolutorPythonFalso({ otrasRutas: caido });
    const confirmadoCaido = await crearRegistroHerramientas(estadoCaido, { pool })
      .confirmar_plan_decoracion!(argsPlan([{ ...ARCO, armado_arco: armadoDelModelo }]), LLAMADA);
    assert.equal(confirmadoCaido.ok, true, `${caso}: ${JSON.stringify(confirmadoCaido).slice(0, 400)}`);
    assert.ok(estadoCaido.planResuelto, `${caso}: el plan queda verificado igual`);
    // Se intentó, falló, y la resolución siguió sin armado.
    assert.ok(llamadasCaido.some((llamada) => llamada.path === RUTA_ARMADO), caso);
    const resueltoCaido = llamadasCaido.find((llamada) => llamada.path === "/internal/v1/plan/resolve")!;
    assert.equal(((resueltoCaido.body.plan as Json).estructuras as Json[])[0]!.armado_arco, undefined, `${caso}: un armado que nadie validó no entra en el plan`);
    // Y el respaldo quedó anotado con su propio estado, no disfrazado de fallo de backend.
    await esperarObservabilidadPendiente();
    assert.ok(auditoria.includes("ARMADO_MOTOR_NO_DISPONIBLE"), `${caso}: ${auditoria.join(",")}`);
    assert.ok(!auditoria.includes("BACKEND_NO_DISPONIBLE"), `${caso}: no es un fallo de la resolución`);
  }
  ok("el servicio de armado caído no tumba la confirmación: plan sin armado, ok:true y el respaldo anotado");

  // ---------------------------------------------------------------------------
  // 18. Una guirnalda con los DOS armados: el de ADR-0032 ya puesto y el del motor completado encima. El
  //     viejo no se toca, ni al escribir el nuevo ni al quitarlo con la bandera apagada.
  const armadoGuirnaldaDelMotor = (RESPUESTAS.armar_guirnalda as Json).armado as Json;
  const estadoDos = crearEstadoConversacion({}, "una guirnalda rosada y blanca");
  estadoDos.ragCatalogSnapshotId = SNAPSHOT_FALSO;
  estadoDos.ragIdsRecuperados.add("P-GLOBOS");
  estadoDos.ragVariantIdsRecuperados.set("P-GLOBOS", new Set(FILAS.map((fila) => fila.variant_id)));
  const llamadasDos = instalarResolutorPythonFalso({
    otrasRutas: (llamada) => respuestaPython(llamada, {
      operation_schema_version: "omoikane-armado-estructura-result.v1",
      accion: "completar",
      armados: [{ estructura_id: "EST_02_GUIRNALDA", tipo: "guirnalda", clave: "armado_guirnalda_organica", origen: "receta", armado: armadoGuirnaldaDelMotor, avisos: [] }],
    }),
  });
  const confirmadoDos = await crearRegistroHerramientas(estadoDos, { pool: POOL })
    .confirmar_plan_decoracion!(argsPlan([{ ...GUIRNALDA, armado_guirnalda: ARMADO_GUIRNALDA_ADR_0032 }]), LLAMADA);
  assert.equal(confirmadoDos.ok, true, JSON.stringify(confirmadoDos).slice(0, 400));
  const resueltoDos = llamadasDos.find((llamada) => llamada.path === "/internal/v1/plan/resolve")!;
  const piezaDos = ((resueltoDos.body.plan as Json).estructuras as Json[])[0]!;
  // Los dos conviven: el del motor escrito por esta capacidad y el de ADR-0032 intacto.
  assert.deepEqual(piezaDos.armado_guirnalda_organica, armadoGuirnaldaDelMotor);
  assert.deepEqual(piezaDos.armado_guirnalda, ARMADO_GUIRNALDA_ADR_0032, "el armado de ADR-0032 no se pisa");
  // Y con la bandera apagada se quita el del motor, no el viejo.
  const estadoDosApagado = crearEstadoConversacion({}, "una guirnalda rosada y blanca");
  estadoDosApagado.ragCatalogSnapshotId = SNAPSHOT_FALSO;
  estadoDosApagado.ragIdsRecuperados.add("P-GLOBOS");
  estadoDosApagado.ragVariantIdsRecuperados.set("P-GLOBOS", new Set(FILAS.map((fila) => fila.variant_id)));
  const previoDos = process.env.ARMADO_ARCO_COLUMNA_V1;
  process.env.ARMADO_ARCO_COLUMNA_V1 = "false";
  const llamadasDosApagado = instalarResolutorPythonFalso();
  await crearRegistroHerramientas(estadoDosApagado, { pool: POOL }).confirmar_plan_decoracion!(
    argsPlan([{ ...GUIRNALDA, armado_guirnalda: ARMADO_GUIRNALDA_ADR_0032, armado_guirnalda_organica: armadoGuirnaldaDelMotor }]),
    LLAMADA,
  );
  if (previoDos === undefined) delete process.env.ARMADO_ARCO_COLUMNA_V1; else process.env.ARMADO_ARCO_COLUMNA_V1 = previoDos;
  const piezaApagada = ((llamadasDosApagado.find((llamada) => llamada.path === "/internal/v1/plan/resolve")!.body.plan as Json).estructuras as Json[])[0]!;
  assert.equal(piezaApagada.armado_guirnalda_organica, undefined, "apagada, el del motor no entra");
  assert.deepEqual(piezaApagada.armado_guirnalda, ARMADO_GUIRNALDA_ADR_0032, "pero el de ADR-0032 sigue, no es de esta capacidad");
  ok("una guirnalda puede traer los dos armados: el del motor entra o no, y el de ADR-0032 nunca se toca");

  // ---------------------------------------------------------------------------
  // 19. Las traducciones de frontera, sin red.
  const plan = PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0",
    ...argsPlan([
      ARCO,
      { ...GUIRNALDA, materiales: [{ product_id: "P-GLOBOS", color: "rosado", acabado: "cromado", participacion: 1, rol_material: "principal" }] },
      { ...ARCO, estructura_id: "EST_03_PARED", tipo: "pared", rol_escena: "relleno", ubicacion: "lateral_izquierdo" },
    ]),
  });
  // La pieza se transcribe: medidas y, solo en una guirnalda, participaciones y acabados declarados. Aquí no
  // se decide nada. Un arco no los lleva porque su patrón no los lee: no se manda ruido a la frontera.
  assert.deepEqual(piezaDeEstructura(plan.estructuras[0]!), {
    tipo: "arco",
    colores: 2,
    ancho_m: 3.2,
    alto_m: 2.3,
  });
  assert.deepEqual(piezaDeEstructura(plan.estructuras[1]!), {
    tipo: "guirnalda",
    colores: 1,
    largo_m: 4.5,
    pesos: [1],
    acabados: ["cromado"],
  });
  assert.equal(piezaDeEstructura(plan.estructuras[2]!), null, "una pared no tiene motor migrado");
  const conArmado = aplicarArmadosCompletados(plan, [
    { estructura_id: "EST_01_ARCO", tipo: "arco", clave: "armado_arco", origen: "receta", armado: armadoDelModelo as never, avisos: [] },
    { estructura_id: "EST_02_GUIRNALDA", tipo: "guirnalda", clave: "armado_guirnalda_organica", origen: "receta", armado: armadoGuirnaldaDelMotor as never, avisos: [] },
    // Para una estructura que el plan no tiene, o de otro tipo: se ignora.
    { estructura_id: "EST_99_NO_EXISTE", tipo: "arco", clave: "armado_arco", origen: "receta", armado: armadoDelModelo as never, avisos: [] },
    { estructura_id: "EST_03_PARED", tipo: "arco", clave: "armado_arco", origen: "receta", armado: armadoDelModelo as never, avisos: [] },
  ]);
  assert.deepEqual(conArmado.estructuras[0]!.armado_arco, armadoDelModelo);
  assert.deepEqual(conArmado.estructuras[1]!.armado_guirnalda_organica, armadoGuirnaldaDelMotor);
  assert.equal(conArmado.estructuras[1]!.armado_arco, undefined, "cada tipo escribe solo su campo");
  assert.equal(conArmado.estructuras[2]!.armado_arco, undefined);
  assert.equal(PlanDecoracionSchema.safeParse(conArmado).success, true, "el plan con armado sigue siendo válido");
  const limpio = sinArmadosDeMotor(conArmado);
  assert.equal(limpio.estructuras[0]!.armado_arco, undefined);
  assert.equal(limpio.estructuras[1]!.armado_guirnalda_organica, undefined);
  assert.equal(sinArmadosDeMotor(plan), plan, "sin armados no se copia el plan");
  ok("piezaDeEstructura, aplicarArmadosCompletados y sinArmadosDeMotor: traducción, no decisión");

  // ---------------------------------------------------------------------------
  // 9. La columna orgánica (ADR-0034) la escribe el decorador, no el modelo: ninguna herramienta la completa.
  const columnaOrganica = JSON.parse(readFileSync(path.join(process.cwd(), "scripts/fixtures/columna-organica-ui/vista-columna-organica.json"), "utf8")) as { peticion: { armado_columna_organica: never } };
  assert.deepEqual([...CLAVES_FUERA_DEL_MODELO], [...CLAVES_ARMADO_MOTOR, "armado_columna_organica"]);
  assert.ok(!(CLAVES_ARMADO_MOTOR as readonly string[]).includes("armado_columna_organica"), "no es una de las que la capacidad decide");
  const conColumnaOrganica: typeof plan = {
    ...plan,
    estructuras: plan.estructuras.map((estructura, lugar) => (lugar === 0 ? { ...estructura, armado_columna_organica: columnaOrganica.peticion.armado_columna_organica } : estructura)),
  };
  assert.equal(sinArmadosDeMotor(conColumnaOrganica).estructuras[0]!.armado_columna_organica, undefined, "con la bandera apagada se descarta");
  const soloOrganica = sinColumnaOrganicaDelModelo(conColumnaOrganica);
  assert.equal(soloOrganica.estructuras[0]!.armado_columna_organica, undefined, "con la bandera encendida también");
  assert.deepEqual(soloOrganica.estructuras.slice(1), conColumnaOrganica.estructuras.slice(1), "no toca las demás piezas");
  assert.equal(sinColumnaOrganicaDelModelo(plan), plan, "sin columna orgánica no se copia el plan");
  // Y lo demás de la pieza se queda: solo se quita ese campo.
  assert.deepEqual({ ...soloOrganica.estructuras[0]!, armado_columna_organica: undefined }, { ...conColumnaOrganica.estructuras[0]!, armado_columna_organica: undefined });
  ok("la columna orgánica que trae el plan del modelo se descarta, con la bandera apagada o encendida");

  console.log(`\n${casos} casos OK`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
