/**
 * De lo que el cliente ya sabe pedir a las ediciones de la espec del motor 3D (REQ-007, fase 5). Sin red y sin modelo.
 * - la tabla de equivalencias: las 10 `HERRAMIENTAS_EDICION` del chat (con los argumentos que mandaría el modelo, validados por
 *   `pedidoDesdeHerramienta`) y cada tipo de `CambioPlan` del panel «Ajustar mi plan» llegan a sus operaciones; una herramienta
 *   o un tipo nuevo sin equivalencia rompe esta prueba (y, en el panel, la compilación);
 * - lo que el 3D no hace por decisión (D-020, Q4) vuelve como `no_soportado` con «No pude: …»; una pieza que no existe, como
 *   `no_encontrado`; nada se ejecuta «parecido» en silencio;
 * - `planActualDesdeEspec` es exacto: lo que el modelo del chat lee es la espec, sin pérdida, en las 46 piezas de referencia.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-motor-guiada-ediciones-mapeo.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { aCambioPanel } from "../../src/components/guiado/ajuste/ejecutar-ajuste-3d";
import type { CambioPlan, PlanGuiado } from "../../src/components/guiado/ajuste/ajuste-plan-guiado";
import { PlanActualGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { HERRAMIENTAS_EDICION, pedidoDesdeHerramienta, type HerramientaEdicion, type PedidoEdicionPlan } from "../../src/lib/ia/guiado/edicion-plan-chat";
import {
  aplicarEdiciones, armarDesdeEspec, CambioPanelV1Schema, cotizarBom, crosswalkIncluido, edicionDesdeCambio, edicionDesdePedido, especDesdePropuesta,
  planActualDesdeEspec, sobreDelMotor, TIPOS_CAMBIO_PANEL, type CambioPanelV1, type EdicionEspecV1, type EspecClienteV1,
} from "../../src/lib/globos3d/motor/v1";
import { todosLosCasos } from "../lib/casos-motor-guiada";
import { pythonDoble } from "../lib/python-doble-precio";

const BASE: EspecClienteV1 = especDesdePropuesta({ frase: "x", colores: ["azul", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] }).espec;
const [ARCO, IZQ, DER] = ["EST_01_ARCO", "EST_02_COLUMNA", "EST_03_COLUMNA"];
const CON_FLORES: EspecClienteV1 = { ...BASE, piezas: BASE.piezas.map((p) => (p.id === ARCO ? { ...p, flores: { cantidad: 2, petalos: 3, codigo: "970" } } : p)) };
const actual = planActualDesdeEspec(BASE, { totalGlobos: 300 });

function pedido(herramienta: HerramientaEdicion, args: Record<string, unknown>, de = BASE): PedidoEdicionPlan {
  const r = pedidoDesdeHerramienta(herramienta, args, { plan: planActualDesdeEspec(de), ultimoUsuario: "", deteccion: { estado: "ninguna" } });
  assert.ok(r.ok, `${herramienta}: el pedido del modelo es válido (${r.ok ? "" : r.motivo})`);
  return r.pedido;
}
function ediciones(de: EspecClienteV1, p: PedidoEdicionPlan): EdicionEspecV1[] {
  const r = edicionDesdePedido(de, p);
  assert.ok(r.ok, `se esperaban ediciones y fue ${r.ok ? "" : r.mensaje}`);
  return r.ediciones;
}
/** Lo que el mapeo deja hecho: las ediciones se aplican, la espec cambia y el motor la vuelve a armar. */
function aplicables(de: EspecClienteV1, lista: EdicionEspecV1[]) {
  const r = aplicarEdiciones(de, lista);
  assert.ok(r.aplicadas > 0, `ninguna edición cambió nada: ${r.noAplicadas.join(" ")}`);
  assert.deepEqual(armarDesdeEspec(r.espec).noRepresentable, []);
  return r;
}

type Fila = { herramienta: HerramientaEdicion; args: Record<string, unknown>; de?: EspecClienteV1; esperado: EdicionEspecV1[] };
const FILAS: Fila[] = [
  { herramienta: "cambiar_color_plan", args: { color_actual: "azul", color_nuevo: "celeste", piezas: ["Columna izquierda"] }, esperado: [{ op: "reemplazar_color", de: "azul", a: "celeste", piezas: [IZQ] }] },
  { herramienta: "cambiar_color_plan", args: { color_actual: "azul", color_nuevo: "rojo" }, esperado: [{ op: "reemplazar_color", de: "azul", a: "rojo" }] },
  { herramienta: "agregar_color_plan", args: { color: "rosado" }, esperado: [{ op: "agregar_color", color: "rosado" }] },
  { herramienta: "quitar_color_plan", args: { color: "dorado", piezas: ["Arco"] }, esperado: [{ op: "quitar_color", color: "dorado", piezas: [ARCO] }] },
  { herramienta: "mas_o_menos_color", args: { color: "dorado", direccion: "mas" }, esperado: [{ op: "mas_menos_color", color: "dorado", direccion: 1 }] },
  { herramienta: "mas_o_menos_color", args: { color: "azul", direccion: "menos", piezas: ["Arco"] }, esperado: [{ op: "mas_menos_color", color: "azul", direccion: -1, piezas: [ARCO] }] },
  { herramienta: "quitar_pieza_plan", args: { piezas: ["Columna derecha"] }, esperado: [{ op: "quitar_pieza", pieza: DER }] },
  { herramienta: "cambiar_tamano_plan", args: { cambio: "agrandar", piezas: ["Arco"] }, esperado: [{ op: "tamano_pieza", pieza: ARCO, direccion: 1 }] },
  { herramienta: "cambiar_tamano_plan", args: { cambio: "achicar" }, esperado: [ARCO, IZQ, DER].map((pieza): EdicionEspecV1 => ({ op: "tamano_pieza", pieza, direccion: -1 })) },
  { herramienta: "cambiar_tamano_plan", args: { cambio: "medida", piezas: ["Columna izquierda"], alto_m: 2.5 }, esperado: [{ op: "tamano_pieza", pieza: IZQ, medidas: { altoM: 2.5 } }] },
  { herramienta: "agregar_pieza_plan", args: { estructura: "guirnalda", ubicacion: "centro", medida_m: 3, colores: ["rojo"] }, esperado: [{ op: "agregar_pieza", oficial: "guirnalda", lugar: "centro", medidas: { largoM: 3 }, colores: ["rojo"] }] },
  { herramienta: "agregar_pieza_plan", args: { estructura: "arco" }, esperado: [{ op: "agregar_pieza", oficial: "arco" }] },
  { herramienta: "colores_pieza_plan", args: { piezas: ["Arco"], colores: ["rojo"] }, esperado: [{ op: "reemplazar_color", de: "040", a: "015", piezas: [ARCO] }, { op: "quitar_color", color: "970", piezas: [ARCO] }] },
  { herramienta: "colores_pieza_plan", args: { piezas: ["Arco"], colores: ["dorado", "rosado"] }, esperado: [{ op: "reemplazar_color", de: "040", a: "009", piezas: [ARCO] }] },
  { herramienta: "flores_plan", args: { piezas: ["Arco"], cantidad: 3, color_petalo: "dorado", color_centro: "azul" }, esperado: [{ op: "flores", pieza: ARCO, flores: { cantidad: 3, petalos: 3, codigo: "970", centro: "040" } }] },
  { herramienta: "flores_plan", args: { piezas: ["Arco"], quitar: true }, de: CON_FLORES, esperado: [{ op: "flores", pieza: ARCO, flores: null }] },
  { herramienta: "editar_pieza_plan", args: { pieza: "Columna izquierda", ubicacion: "derecha" }, esperado: [{ op: "lado", pieza: IZQ, lado: "derecha" }] },
];

test("la tabla de equivalencias cubre las 10 herramientas de edición del chat y cada fila llega a sus operaciones", () => {
  assert.deepEqual([...new Set(FILAS.map((f) => f.herramienta))].sort(), [...HERRAMIENTAS_EDICION].sort(), "una herramienta sin fila rompe la prueba");
  assert.equal(HERRAMIENTAS_EDICION.length, 10);
  for (const fila of FILAS) {
    const de = fila.de ?? BASE;
    const lista = ediciones(de, pedido(fila.herramienta, fila.args, de));
    assert.deepEqual(lista, fila.esperado, `${fila.herramienta} ${JSON.stringify(fila.args)}`);
    for (const e of lista) assert.equal(typeof e.op, "string");
    aplicables(de, lista);
  }
});

test("«colores_pieza»: lo que ya lleva se conserva, lo que sobra se reemplaza o se quita y lo que falta se suma, solo en esa pieza", () => {
  const r = aplicables(BASE, ediciones(BASE, pedido("colores_pieza_plan", { piezas: ["Arco"], colores: ["rojo"] })));
  assert.deepEqual(r.espec.piezas.find((p) => p.id === ARCO)!.colores.map((c) => c.nombre.toLocaleLowerCase("es")), ["rojo"]);
  assert.deepEqual(r.espec.piezas.filter((p) => p.id !== ARCO), BASE.piezas.filter((p) => p.id !== ARCO), "las demás piezas no cambian");
  assert.deepEqual(r.tocadas, [ARCO]);
  const ya = edicionDesdePedido(BASE, { tipo: "colores_pieza", colores: ["azul", "dorado"], piezas: ["Arco"] });
  assert.equal(ya.ok, false);
  assert.match(ya.ok ? "" : ya.mensaje, /^No pude: esas piezas ya van en esos colores/);
});

test("lo que el 3D no hace por decisión vuelve como no_soportado con «No pude: …»; una pieza que no existe, como no_encontrado", () => {
  const sinSoporte: Array<[PedidoEdicionPlan, RegExp]> = [
    [{ tipo: "renombrar_pieza", pieza: "Arco", nombre: "Cascada" }, /cambiarle el nombre/],
    [{ tipo: "mover_pieza", pieza: "Arco", ubicacion: "arriba" }, /izquierda o a la derecha/],
    [{ tipo: "mover_pieza", pieza: "Arco", ubicacion: "piso" }, /izquierda o a la derecha/],
    [{ tipo: "mover_pieza", pieza: "Arco", ubicacion: "centro" }, /izquierda o a la derecha/],
  ];
  for (const [p, patron] of sinSoporte) {
    const r = edicionDesdePedido(BASE, p);
    assert.equal(r.ok, false, JSON.stringify(p));
    if (r.ok) continue;
    assert.equal(r.tipo, "no_soportado");
    assert.ok(r.mensaje.startsWith("No pude: ") && patron.test(r.mensaje), r.mensaje);
  }
  for (const p of [
    { tipo: "quitar_pieza", piezas: ["Estatua"] }, { tipo: "tamano", direccion: 1, piezas: ["Estatua"] }, { tipo: "mover_pieza", pieza: "Estatua", ubicacion: "izquierda" },
    { tipo: "medidas", medidas: { alto_m: 2 }, piezas: ["Estatua"] }, { tipo: "flores", quitar: false, cantidad: 2, colorPetalo: null, colorCentro: null, piezas: ["Estatua"] },
  ] satisfies PedidoEdicionPlan[]) {
    const r = edicionDesdePedido(BASE, p);
    assert.equal(r.ok, false);
    assert.equal(r.ok ? "" : r.tipo, "no_encontrado", JSON.stringify(p));
    assert.match(r.ok ? "" : r.mensaje, /^No pude: no encontré esa pieza/);
  }
  const todas = edicionDesdePedido(BASE, { tipo: "quitar_pieza", piezas: ["Arco", "Columna izquierda", "Columna derecha"] });
  assert.equal(todas.ok ? "" : todas.tipo, "no_aplicable");
  assert.match(todas.ok ? "" : todas.mensaje, /al menos una pieza/);
  const sinFlores = edicionDesdePedido(BASE, { tipo: "flores", quitar: true, cantidad: null, colorPetalo: null, colorCentro: null, piezas: [] });
  assert.match(sinFlores.ok ? "" : sinFlores.mensaje, /^No pude: tu plan no lleva flores de globo/);
  const colorRaro = edicionDesdePedido(BASE, { tipo: "flores", quitar: false, cantidad: 2, colorPetalo: "zzz", colorCentro: null, piezas: ["Arco"] });
  assert.match(colorRaro.ok ? "" : colorRaro.mensaje, /^No pude: no reconozco el color zzz/);
});

// ── El panel ─────────────────────────────────────────────────────────────────────────────────────────────────────

const GLOBO_ROJO = { productId: "sempertex-015", color: "Rojo", variantIds: ["015"], nombre: "Fashion Rojo" };
type FilaPanel = { cambio: CambioPlan; esperado: EdicionEspecV1[] };
/** Una fila por tipo de `CambioPlan`: el `Record` obliga a que un tipo nuevo del panel tenga la suya al compilar. */
const PANEL: Record<CambioPlan["tipo"], FilaPanel[]> = {
  protagonismo: [
    { cambio: { tipo: "protagonismo", estructuraId: ARCO, indice: 1, direccion: 1 }, esperado: [{ op: "mas_menos_color", color: "970", direccion: 1, piezas: [ARCO] }] },
    { cambio: { tipo: "protagonismo", estructuraId: IZQ, indice: 0, direccion: -1, pareja: true }, esperado: [{ op: "mas_menos_color", color: "040", direccion: -1, piezas: [IZQ, DER] }] },
  ],
  cantidad: [
    { cambio: { tipo: "cantidad", estructuraId: ARCO, indice: 0, objetivo: 30, desde: 20 }, esperado: [{ op: "proporcion_color", pieza: ARCO, pesos: [0.75, 0.25] }] },
    { cambio: { tipo: "cantidad", estructuraId: IZQ, indice: 1, objetivo: 10, desde: 20, pareja: true }, esperado: [{ op: "proporcion_color", pieza: IZQ, pesos: [0.75, 0.25] }, { op: "proporcion_color", pieza: DER, pesos: [0.75, 0.25] }] },
  ],
  tamano: [
    { cambio: { tipo: "tamano", estructuraId: ARCO, direccion: 1 }, esperado: [{ op: "tamano_pieza", pieza: ARCO, direccion: 1 }] },
    { cambio: { tipo: "tamano", estructuraId: IZQ, direccion: -1, pareja: true }, esperado: [{ op: "tamano_pieza", pieza: IZQ, direccion: -1 }, { op: "tamano_pieza", pieza: DER, direccion: -1 }] },
  ],
  medidas: [
    { cambio: { tipo: "medidas", estructuraId: IZQ, medidas: { alto_m: 2.5 } }, esperado: [{ op: "tamano_pieza", pieza: IZQ, medidas: { altoM: 2.5 } }] },
    { cambio: { tipo: "medidas", estructuraId: ARCO, medidas: { ancho_m: 3.5, alto_m: 2.6 } }, esperado: [{ op: "tamano_pieza", pieza: ARCO, medidas: { anchoM: 3.5, altoM: 2.6 } }] },
  ],
  "quitar-color": [
    { cambio: { tipo: "quitar-color", estructuraId: IZQ, indice: 1 }, esperado: [{ op: "quitar_color", color: "970", piezas: [IZQ] }] },
  ],
  "agregar-color": [
    { cambio: { tipo: "agregar-color", color: "Rojo", globo: GLOBO_ROJO, estructuraIds: [ARCO] }, esperado: [{ op: "agregar_color", color: "015", piezas: [ARCO] }] },
    { cambio: { tipo: "agregar-color", color: "rosado" }, esperado: [{ op: "agregar_color", color: "rosado" }] },
  ],
  "reemplazar-color": [
    { cambio: { tipo: "reemplazar-color", color: "azul", globo: GLOBO_ROJO }, esperado: [{ op: "reemplazar_color", de: "azul", a: "015" }] },
    { cambio: { tipo: "reemplazar-color", color: "dorado", globo: GLOBO_ROJO, estructuraIds: [IZQ, DER] }, esperado: [{ op: "reemplazar_color", de: "dorado", a: "015", piezas: [IZQ, DER] }] },
  ],
  "tamano-todo": [
    { cambio: { tipo: "tamano-todo", direccion: 1 }, esperado: [ARCO, IZQ, DER].map((pieza): EdicionEspecV1 => ({ op: "tamano_pieza", pieza, direccion: 1 })) },
  ],
  "quitar-pieza": [
    { cambio: { tipo: "quitar-pieza", estructuraId: DER }, esperado: [{ op: "quitar_pieza", pieza: DER }] },
  ],
  "tamano-globos": [
    { cambio: { tipo: "tamano-globos", estructuraId: ARCO, direccion: 1 }, esperado: [{ op: "tamano_globos", pieza: ARCO, direccion: 1 }] },
    { cambio: { tipo: "tamano-globos", estructuraId: IZQ, direccion: -1, pareja: true }, esperado: [{ op: "tamano_globos", pieza: IZQ, direccion: -1 }, { op: "tamano_globos", pieza: DER, direccion: -1 }] },
  ],
};

test("cada tipo de CambioPlan del panel llega a sus operaciones, y el esquema del servidor cubre justo esos tipos", () => {
  assert.deepEqual(Object.keys(PANEL).sort(), [...TIPOS_CAMBIO_PANEL].sort(), "el esquema del servidor y el panel dicen los mismos tipos");
  for (const [tipo, filas] of Object.entries(PANEL)) {
    for (const fila of filas) {
      assert.equal(fila.cambio.tipo, tipo);
      const enviado: CambioPanelV1 = aCambioPanel(fila.cambio);
      assert.ok(CambioPanelV1Schema.safeParse(JSON.parse(JSON.stringify(enviado))).success, `${tipo}: lo que sale del navegador cumple el esquema del servidor`);
      assert.ok(!JSON.stringify(enviado).includes("productId"), `${tipo}: del navegador no sale nada del catálogo de Python`);
      const r = edicionDesdeCambio(BASE, enviado);
      assert.ok(r.ok, `${tipo}: ${r.ok ? "" : r.mensaje}`);
      assert.deepEqual(r.ok ? r.ediciones : null, fila.esperado, `${tipo} ${JSON.stringify(fila.cambio)}`);
      aplicables(BASE, fila.esperado);
    }
  }
});

/** El plan del 3D tal como lo recibe el navegador: armado, cotizado con el doble de Python y firmado. */
async function planDelMotor(espec: EspecClienteV1): Promise<PlanGuiado> {
  const cruce = crosswalkIncluido();
  const resultado = armarDesdeEspec(espec);
  const cotizacion = await cotizarBom(resultado.bom, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista });
  assert.ok(cotizacion.ok, "el plan de prueba se cotiza");
  const sobre = sobreDelMotor({ espec, resultado, cotizacion, concepto: { titulo: "Plan de prueba", descripcion: "Plan de prueba" }, requestId: "11111111-1111-4111-8111-111111111111" });
  assert.ok(sobre.ok, sobre.ok ? "" : sobre.motivo);
  return sobre.plan;
}

test("«Cambiar» del panel manda el código del renglón: con dos colores que la tarjeta llama igual, cambia el que se tocó (A2)", async () => {
  // La columna izquierda lleva un azul rey que su tarjeta llama «azul», como el azul del arco: el nombre no basta.
  const espec: EspecClienteV1 = { ...BASE, piezas: BASE.piezas.map((p) => (p.id === IZQ ? { ...p, colores: [{ ...p.colores[0]!, codigo: "041" }, p.colores[1]!] } : p)) };
  const plan = await planDelMotor(espec);
  const renglon = plan.plan.estructuras.find((e) => e.estructura_id === IZQ)!.materiales[0]!;
  const cambio: CambioPlan = { tipo: "reemplazar-color", color: renglon.color!, productIdAnterior: renglon.product_id, globo: GLOBO_ROJO };
  const enviado = aCambioPanel(cambio, plan);
  assert.ok(enviado.tipo === "reemplazar-color" && enviado.codigo === "041", `el panel manda el código del renglón: ${JSON.stringify(enviado)}`);
  const conCodigo = edicionDesdeCambio(espec, enviado);
  assert.ok(conCodigo.ok);
  const hecho = aplicarEdiciones(espec, conCodigo.ediciones).espec;
  assert.deepEqual(hecho.piezas.map((p) => p.colores[0]!.codigo), ["040", "015", "040"], "solo el azul rey de la columna izquierda");
  // Por el nombre solo, «azul» son los dos: por eso el renglón manda su código.
  const porNombre = edicionDesdeCambio(espec, aCambioPanel(cambio));
  assert.ok(porNombre.ok);
  assert.deepEqual(aplicarEdiciones(espec, porNombre.ediciones).espec.piezas.map((p) => p.colores[0]!.codigo), ["015", "015", "015"]);
});

test("el panel: una pieza o un color que no existen, un solo color y la última pieza se dicen con «No pude: …»", () => {
  const malos: Array<[CambioPanelV1, string, RegExp]> = [
    [{ tipo: "tamano", estructuraId: "EST_09_ARCO", direccion: 1 }, "no_encontrado", /no encontré esa pieza/],
    [{ tipo: "quitar-color", estructuraId: ARCO, indice: 5 }, "no_encontrado", /no encontré ese color/],
    [{ tipo: "protagonismo", estructuraId: ARCO, indice: 4, direccion: 1 }, "no_encontrado", /no encontré ese color/],
    [{ tipo: "cantidad", estructuraId: ARCO, indice: 0, objetivo: 10, desde: 0 }, "no_aplicable", /cuántos globos lleva hoy/],
  ];
  for (const [cambio, tipo, patron] of malos) {
    const r = edicionDesdeCambio(BASE, cambio);
    assert.equal(r.ok, false, JSON.stringify(cambio));
    if (r.ok) continue;
    assert.equal(r.tipo, tipo);
    assert.ok(r.mensaje.startsWith("No pude: ") && patron.test(r.mensaje), r.mensaje);
  }
  const uno = especDesdePropuesta({ frase: "x", colores: ["azul"], piezas: [{ estructura: "arco", cantidad: 1 }] }).espec;
  const solo = edicionDesdeCambio(uno, { tipo: "cantidad", estructuraId: "EST_01_ARCO", indice: 0, objetivo: 10, desde: 10 });
  assert.match(solo.ok ? "" : solo.mensaje, /^No pude: el arco lleva un solo color/);
  const ultima = edicionDesdeCambio(uno, { tipo: "quitar-pieza", estructuraId: "EST_01_ARCO" });
  assert.match(ultima.ok ? "" : ultima.mensaje, /^No pude: tu plan necesita al menos una pieza/);
  // El esquema del servidor rechaza lo que no es un cambio del panel.
  for (const raro of [{ tipo: "arrastrar", estructuraId: ARCO }, { tipo: "tamano", estructuraId: "arco", direccion: 1 }, { tipo: "agregar-color", color: "rojo", globo: GLOBO_ROJO }]) {
    assert.equal(CambioPanelV1Schema.safeParse(raro).success, false, JSON.stringify(raro));
  }
});

// ── El plan para el chat ─────────────────────────────────────────────────────────────────────────────────────────

test("planActualDesdeEspec es una proyección exacta: nombres, lados, medidas con que se arma y la parte de cada color", () => {
  const casos = todosLosCasos();
  for (const caso of casos) {
    const proyectado = planActualDesdeEspec(caso.espec, { totalGlobos: 123 });
    assert.ok(PlanActualGuiadoSchema.safeParse(proyectado).success, `${caso.id}: cumple el contrato del chat`);
    assert.equal(proyectado.piezas.length, caso.espec.piezas.length);
    assert.equal(proyectado.totalGlobos, 123);
    caso.espec.piezas.forEach((pieza, i) => {
      const leida = proyectado.piezas[i]!;
      assert.equal(leida.estructura, pieza.oficial);
      assert.equal(leida.nombre, pieza.nombre.slice(0, 120));
      assert.equal(leida.cantidad, 1);
      assert.equal(leida.ubicacion, pieza.lugar === "izquierda" ? "lateral_izquierdo" : pieza.lugar === "derecha" ? "lateral_derecho" : undefined);
      assert.deepEqual(leida.participacion, pieza.colores.map((c) => ({ color: c.nombre.slice(0, 40), parte: c.peso })), `${caso.id} ${pieza.id}: las partes son los pesos de la espec`);
      for (const [campo, valor] of Object.entries(leida.medidas ?? {})) assert.ok(typeof valor === "number" && valor > 0, `${caso.id} ${campo}`);
    });
    assert.ok(proyectado.colores.length >= 1 && proyectado.colores.length <= 8);
    assert.ok((proyectado.resumen ?? "").length <= 400 && proyectado.resumen!.startsWith("Tu plan: "));
  }
  // Con medidas por defecto de la oficial incluidas: el modelo lee con qué se arma, no solo lo que se escribió.
  assert.deepEqual(actual.piezas[0]!.medidas, { ancho_m: 3, alto_m: 2.4 });
  assert.deepEqual(actual.piezas[1]!.medidas, { alto_m: 1.8 });
  assert.equal(actual.resumen, "Tu plan: arco de 3 × 2,4 m, columna izquierda de 1,8 m de alto y columna derecha de 1,8 m de alto, en azul y dorado; 300 globos en total.");
  assert.deepEqual(actual.colores, ["azul", "dorado"]);
});

test("los nombres de pieza y de color del plan que lee el chat son los que el mapeo vuelve a encontrar (ida y vuelta)", () => {
  for (const caso of todosLosCasos()) {
    const proyectado = planActualDesdeEspec(caso.espec);
    for (const [i, pieza] of caso.espec.piezas.entries()) {
      const nombre = proyectado.piezas[i]!.nombre!;
      const r = edicionDesdePedido(caso.espec, { tipo: "tamano", direccion: 1, piezas: [nombre] });
      if (!r.ok) continue;
      assert.ok(r.ediciones.every((e) => e.op === "tamano_pieza" && caso.espec.piezas.some((p) => p.id === e.pieza && p.nombre === nombre)), `${caso.id}: «${nombre}» se vuelve a encontrar`);
      const color = proyectado.piezas[i]!.participacion![0]!.color;
      const c = edicionDesdePedido(caso.espec, { tipo: "quitar_color", color, piezas: [nombre] });
      assert.ok(c.ok && c.ediciones[0]!.op === "quitar_color", `${caso.id} ${pieza.id}: el color «${color}»`);
    }
  }
});
