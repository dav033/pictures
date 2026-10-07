import assert from "node:assert/strict";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { WidgetGuiadoSchema } from "../../src/lib/ia/guiado/widgets";
import type { EdicionPlan } from "../../src/lib/plan/edicion-esquemas";
import type { CandidatoDelServidor } from "../../src/components/plan/ajuste/ajuste-propuesta";
import {
  admiteColorNuevo,
  avisoEnCurso,
  cambiaTodasLasPiezas,
  coloresDelPlanVista,
  coloresParaAgregar,
  confirmacionDelCambio,
  contenidoPlanAjustado,
  describirCambio,
  edicionProtagonismo,
  edicionQuitarColor,
  edicionTamano,
  elegirGloboLiso,
  piezaConArticulo,
  piezasAjustables,
  type GloboElegido,
  type PlanGuiado,
} from "../../src/components/guiado/ajuste/ajuste-plan-guiado";
import { CATALOGO_ERRORES_UI_V1 } from "../../src/lib/ia/contracts/ui-error-v1";
import { separarEstructurasRepetidas } from "../../src/lib/plan/piezas-individuales";
import { FalloPlanEditar, MENSAJE_EDICION_LENTA } from "../../src/lib/plan/peticion-plan-editar";
import { ejecutarCambio, mensajeAjuste, type DependenciasAjuste } from "../../src/components/guiado/ajuste/ejecutar-ajuste";

/**
 * «Ajustar mi plan» de la vista guiada, sin red ni modelo: el plan de prueba copia la forma de uno real de la guiada
 * (2026-10-06: semiarco orgánico con su armado del motor y dos columnas con patrón ombré) y le suma una pared sin
 * armado para la edición `repartir`. Ninguna prueba llama a Python ni a Gemini. «Quitar pieza» y «Añadir un color»
 * ya no rehacen el plan con el modelo: van al servidor (`quitar_pieza`, `agregar_color`) y aquí se prueban con dobles.
 * Las dos columnas del plan viejo vienen con repeticiones 2; las piezas individuales se prueban con el mismo plan separado.
 */

const HASH = "a".repeat(64);
const AZUL = "8634239385895";
const PLATA = "8634257211687";
const BLANCO = "8634235781415";

function linea(estructura: string, product: string, variant: string, color: string, diam: number, unidades: number, acabado = "fashion") {
  return { estructura_id: estructura, product_id: product, variant_id: variant, color, diam_pulg: diam, unidades, acabado, titulo: `B2b Globo Latex Redondo ${acabado} ${color} — R-${diam}` };
}

const materiales = [
  { product_id: AZUL, color: "azul", participacion: 0.4, rol_material: "principal" as const },
  { product_id: PLATA, color: "plateado", participacion: 0.3, rol_material: "secundario" as const },
  { product_id: BLANCO, color: "blanco", participacion: 0.3, rol_material: "acento" as const },
];

function planDePrueba(): PlanGuiado {
  return PlanGuiadoSchema.parse({
    plan: {
      plan_version: "1.0",
      plan_id: "f2b5c54b-7e20-4809-b4e6-e5380f5cd8ec",
      concepto: { titulo: "Decoración Festiva Azul, Plata y Blanco", descripcion: "Semiarco orgánico y columnas.", paleta: ["azul", "plateado", "blanco"] },
      espacio: { tipo: "salón", fuente: "supuesto" },
      supuestos: [],
      estructuras: [
        {
          estructura_id: "EST_01_SEMIARCO_ASIMETRICO", nombre: "Semiarco orgánico", tipo: "semiarco", rol_escena: "focal", ubicacion: "fondo_pared",
          medidas: { ancho_m: 1.58, alto_m: 2.23 }, repeticiones: 1, densidad: "media", mezcla: "organica_fina", materiales, porque: "Enmarca el espacio.",
          estructura_oficial: "semiarco_asimetrico",
          armado_arco_organico: {
            version: "armado-arco-organico.v1", origen: "sugerido",
            forma: { anchoM: 2.16, altoM: 2.2, cima: 0.4, curva: 2.1, ondulacion: 0.35, carga: -0.7, corte: 0.6, espejo: false, suelo: true },
            volumen: { grosorPatasM: 1.15, grosorCimaM: 0.6, irregularidad: 0.4, relleno: 0.68, racimo: 4, salientes: 0.4 },
            tamanos: { mezcla: { 5: 21, 9: 18, 12: 54, 18: 5, 24: 2, 36: 0 }, grandesAbajo: 0.9, inflado: 1, variacion: 0.12 },
            colores: { paleta: [{ material: 0, peso: 40, acabado: "mate", rol: "normal" }, { material: 1, peso: 30, acabado: "mate", rol: "normal" }, { material: 2, peso: 30, acabado: "mate", rol: "normal" }], reparto: "azar", mezcla: 0.5 },
            adornos: { follaje: 0.8, flores: 0 },
            aspecto: { brillo: 0.6, sombra: 0.2, contorno: 0.8, profundidad: 0.5, semilla: 21 },
          },
        },
        {
          estructura_id: "EST_02_COLUMNA", nombre: "Columna", tipo: "columna", rol_escena: "soporte", ubicacion: "entrada",
          medidas: { alto_m: 2 }, repeticiones: 2, densidad: "media", mezcla: "clasica", materiales, porque: "Flanquean la entrada.",
          estructura_oficial: "columna",
          armado_columna: {
            version: "armado-columna.v1", origen: "sugerido", modo: "altura", patron: "ombre", opciones: { suavidad: 0.6, invertir: 0 },
            cuerpo: { alto_m: 2, globos_capa: 4, abajo: 12, arriba: 12, escalonado: true, base: true },
            inflado: { inflado: 1, tamano: 1.14, compresion: 0.8, variacion_tam: 0, variacion_tono: 0.03, desorden: 0, semilla: 7 },
            remate: { tipo: "ninguno", tamano: 24, cantidad: 5, foil_m: 0.7, material: 0 },
            capas: [], materiales: [0, 1, 2],
          },
        },
        {
          estructura_id: "EST_03_PARED", nombre: "Pared de globos", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo",
          medidas: { alto_m: 2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Rellena el lateral.",
          estructura_oficial: "columna",
        },
      ],
    },
    plan_hash: HASH,
    approval_token: "token-de-prueba",
    estructuras: [
      { estructura_id: "EST_01_SEMIARCO_ASIMETRICO", lineas: [linea("EST_01_SEMIARCO_ASIMETRICO", AZUL, "az5", "azul", 5, 31), linea("EST_01_SEMIARCO_ASIMETRICO", PLATA, "pl5", "plateado", 5, 24, "reflex"), linea("EST_01_SEMIARCO_ASIMETRICO", BLANCO, "bl5", "blanco", 5, 24)] },
      { estructura_id: "EST_02_COLUMNA", lineas: [linea("EST_02_COLUMNA", AZUL, "az12", "azul", 12, 22), linea("EST_02_COLUMNA", PLATA, "pl12", "plateado", 12, 24, "reflex"), linea("EST_02_COLUMNA", BLANCO, "bl12", "blanco", 12, 26)] },
      { estructura_id: "EST_03_PARED", lineas: [linea("EST_03_PARED", AZUL, "az12", "azul", 12, 40), linea("EST_03_PARED", PLATA, "pl12", "plateado", 12, 30, "reflex"), linea("EST_03_PARED", BLANCO, "bl12", "blanco", 12, 30)] },
    ],
    compras: [{ product_id: AZUL, variant_id: "az12" }],
  });
}

const plan = planDePrueba();
const SEMIARCO = "EST_01_SEMIARCO_ASIMETRICO";
const COLUMNA = "EST_02_COLUMNA";
const PARED = "EST_03_PARED";

function campo<T extends EdicionPlan["accion"]>(edicion: EdicionPlan | null, accion: T): Extract<EdicionPlan, { accion: T }> {
  assert.ok(edicion, `se esperaba una edición ${accion}`);
  assert.equal(edicion.accion, accion);
  return edicion as Extract<EdicionPlan, { accion: T }>;
}

// --- Lo que se ve de cada pieza ---
const piezas = piezasAjustables(plan);
assert.deepEqual(piezas.map((pieza) => pieza.modoColores), ["paleta", "posiciones", "reparto"], "cada pieza cambia sus colores por su propio camino");
assert.equal(piezas[1]!.titulo, "2 × Columna");
for (const pieza of piezas) assert.equal(pieza.colores.reduce((suma, color) => suma + color.porcentaje, 0), 100, `los porcentajes de ${pieza.titulo} suman 100`);
assert.deepEqual(piezas[0]!.colores.map((color) => [color.etiqueta, color.porcentaje]), [["Azul", 39], ["Plata cromado", 31], ["Blanco", 30]], "el porcentaje sale de los globos que resolvió Python (nombres de color-sempertex, como los chips)");
assert.equal(piezas[0]!.tamano?.texto, "1,58 × 2,23 m");
assert.equal(piezas[1]!.tamano?.texto, "2 m de alto");
assert.ok(piezas.every((pieza) => pieza.puedeQuitarPieza), "con tres piezas, cualquiera se puede quitar");
assert.ok(piezas.every((pieza) => pieza.colores.every((color) => color.puedeQuitar && color.puedeMas && color.puedeMenos)));

// --- Más o menos de un color ---
const masAzulArco = campo(edicionProtagonismo(plan, SEMIARCO, 0, 1), "armado_arco_organico");
assert.deepEqual(masAzulArco.armado_arco_organico?.colores.paleta.map((color) => color.peso), [50, 25, 25], "+ sube 10 puntos y los demás conservan su proporción");
assert.equal(masAzulArco.armado_arco_organico?.origen, "decorador");
const menosAzulArco = campo(edicionProtagonismo(plan, SEMIARCO, 0, -1), "armado_arco_organico");
assert.deepEqual(menosAzulArco.armado_arco_organico?.colores.paleta.map((color) => color.peso), [30, 35, 35]);

const masAzulColumna = campo(edicionProtagonismo(plan, COLUMNA, 0, 1), "armado_columna");
assert.deepEqual(masAzulColumna.armado_columna?.materiales, [0, 0, 1, 2], "en un patrón, más color es una posición más junto a la que ya tiene");
const menosBlancoColumna = campo(edicionProtagonismo(plan, COLUMNA, 2, -1), "armado_columna");
assert.deepEqual(menosBlancoColumna.armado_columna?.materiales, [0, 0, 1, 1, 2], "con una sola posición, los demás colores ganan una");

const masPlataPared = campo(edicionProtagonismo(plan, PARED, 1, 1), "repartir");
assert.deepEqual(masPlataPared.participaciones.map((parte) => Math.round(parte * 1000) / 1000), [0.343, 0.4, 0.257]);
assert.ok(Math.abs(masPlataPared.participaciones.reduce((suma, parte) => suma + parte, 0) - 1) < 1e-3);

// Al límite: un color al 85 % no sube más; con un solo color no hay reparto.
const casiTodo = PlanGuiadoSchema.parse({ ...plan, plan: { ...plan.plan, estructuras: plan.plan.estructuras.map((estructura) => (estructura.estructura_id === PARED ? { ...estructura, materiales: [{ ...materiales[0]!, participacion: 0.85 }, { ...materiales[1]!, participacion: 0.1 }, { ...materiales[2]!, participacion: 0.05 }] } : estructura)) } });
assert.equal(edicionProtagonismo(casiTodo, PARED, 0, 1), null, "85 % es el tope");
assert.equal(edicionProtagonismo(casiTodo, PARED, 2, -1), null, "5 % es el piso: para menos, se quita el color");
const unColor = PlanGuiadoSchema.parse({ ...plan, plan: { ...plan.plan, estructuras: plan.plan.estructuras.map((estructura) => (estructura.estructura_id === PARED ? { ...estructura, materiales: [{ ...materiales[0]!, participacion: 1 }] } : estructura)) } });
assert.equal(edicionProtagonismo(unColor, PARED, 0, 1), null);
assert.equal(edicionQuitarColor(unColor, PARED, 0), null, "el único color no se quita");

// --- Tamaño ---
const arcoMasGrande = campo(edicionTamano(plan, SEMIARCO, 1), "armado_arco_organico");
// Un 10 % de la medida que se ve (1,58 × 2,23 → 1,75 × 2,45), pedido al motor con la razón pedida/armada (2,16/1,58).
assert.deepEqual([arcoMasGrande.armado_arco_organico?.forma.anchoM, arcoMasGrande.armado_arco_organico?.forma.altoM], [2.39, 2.42], "el arco del motor crece un 10 % en su armado, no medio metro de golpe");
assert.equal(campo(edicionTamano(plan, COLUMNA, -1), "armado_columna").armado_columna?.cuerpo.alto_m, 1.8);
assert.deepEqual(campo(edicionTamano(plan, PARED, 1), "propiedades").medidas, { alto_m: 2.2 }, "sin armado, se cambian sus medidas");

// --- Quitar y añadir colores ---
assert.deepEqual(edicionQuitarColor(plan, SEMIARCO, 1), { accion: "quitar", estructura_id: SEMIARCO, objetivo_variant_id: "pl5" }, "se quita nombrando una línea de ese color");
const candidatos: CandidatoDelServidor[] = [
  { productId: "imp", titulo: "B2b Globo Latex Impreso Feliz Cumpleaños Rosado", imagen: null, variantes: [{ variantId: "imp12", titulo: "R-12", disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: ["rosado"] }] },
  { productId: "ref", titulo: "B2b Globo Latex Redondo Reflex Rosado", imagen: null, variantes: [{ variantId: "ref12", titulo: "R-12", disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: ["rosado"] }] },
  { productId: "fas", titulo: "B2b Globo Latex Redondo Fashion Rosado", imagen: null, variantes: [
    { variantId: "fas5", titulo: "R-5", disponible: true, codigoTamano: "R-5", diamPulg: 5, forma: "redondo", colores: ["rosado"] },
    { variantId: "fas12", titulo: "R-12", disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: ["rosado"] },
    { variantId: "fas18", titulo: "R-18", disponible: false, codigoTamano: "R-18", diamPulg: 18, forma: "redondo", colores: ["rosado"] },
  ] },
];
assert.deepEqual(elegirGloboLiso(candidatos, "rosado", "fashion"), { productId: "fas", variantId: "fas12", variantIds: ["fas5", "fas12"], color: "rosado" }, "liso, del acabado de la pieza y de 12″, con todos sus tamaños disponibles; nunca el impreso");
assert.equal(elegirGloboLiso(candidatos.slice(0, 1), "rosado", "fashion"), null, "un impreso no cuenta como liso");
assert.deepEqual(
  coloresParaAgregar([{ valor: "multicolor", total: 300 }, { valor: "rosado", total: 99 }, { valor: "azul", total: 132 }, { valor: "dorado", total: 130 }, { valor: "coral", total: 0 }], ["azul"]),
  ["dorado", "rosado"],
  "los colores para añadir van del más vendido al menos, sin los que ya lleva ni los que el catálogo no tiene",
);

// --- Los colores del plan ---
assert.deepEqual(coloresDelPlanVista(plan).map((color) => [color.etiqueta, color.porcentaje]), [["Azul", 37], ["Plata", 31], ["Blanco", 32]], "la parte de cada color en todo el plan");
assert.equal(admiteColorNuevo(plan), true);

// --- Quitar una pieza ---
const unaPieza = PlanGuiadoSchema.parse({ ...plan, plan: { ...plan.plan, estructuras: [plan.plan.estructuras[0]!] }, estructuras: [plan.estructuras[0]!] });
assert.equal(piezasAjustables(unaPieza)[0]!.puedeQuitarPieza, false, "la última pieza no se quita");

// --- Piezas individuales: «Columna izquierda» y «Columna derecha» (el mismo plan, separado por el servidor) ---
// (Sin la pared, que también es una columna oficial: con tres columnas los nombres van numerados.)
const separado = separarEstructurasRepetidas({ ...plan.plan, estructuras: plan.plan.estructuras.slice(0, 2) }).plan;
const individual = PlanGuiadoSchema.parse({ ...plan, plan: separado, estructuras: [...plan.estructuras.slice(0, 2), { ...plan.estructuras[1]!, estructura_id: "EST_02_COLUMNA_B" }] });
const DERECHA = "EST_02_COLUMNA_B";
assert.deepEqual(piezasAjustables(individual).map((pieza) => pieza.titulo), ["Semiarco orgánico", "Columna izquierda", "Columna derecha"]);
assert.deepEqual(separarEstructurasRepetidas(plan.plan).plan.estructuras.map((estructura) => estructura.nombre), ["Semiarco orgánico", "Columna 1", "Columna 2", "Columna 3"], "tres columnas: numeradas");
assert.equal(piezaConArticulo(individual.plan.estructuras[2]!), "la columna derecha");
assert.equal(piezasAjustables(individual)[2]!.conArticulo, "la columna derecha");
assert.equal(describirCambio(individual, { tipo: "quitar-pieza", estructuraId: DERECHA }), "sin la columna derecha");
assert.equal(avisoEnCurso(individual, { tipo: "quitar-pieza", estructuraId: DERECHA }), "Quito la columna derecha; lo demás queda igual…");
assert.equal(confirmacionDelCambio(individual, { tipo: "quitar-pieza", estructuraId: DERECHA }), "Listo: quité la columna derecha; lo demás quedó igual.");
assert.equal(avisoEnCurso(individual, { tipo: "agregar-color", color: "rosado" }), "Añado rosado a tus piezas; sus tamaños quedan igual…");
assert.equal(confirmacionDelCambio(individual, { tipo: "agregar-color", color: "rosado" }, [SEMIARCO, COLUMNA]), "Listo: añadí rosado a 2 de tus 3 piezas; sus tamaños quedaron igual.");
assert.equal(confirmacionDelCambio(individual, { tipo: "agregar-color", color: "rosado" }), "Listo: añadí rosado a tus piezas; sus tamaños quedaron igual.");
assert.equal(confirmacionDelCambio(individual, { tipo: "protagonismo", estructuraId: SEMIARCO, indice: 0, direccion: 1 }), "Listo: más azul en el semiarco orgánico.");
assert.equal(cambiaTodasLasPiezas({ tipo: "agregar-color", color: "rosado" }), true);
assert.equal(cambiaTodasLasPiezas({ tipo: "quitar-pieza", estructuraId: DERECHA }), false, "quitar una pieza solo espera en esa pieza");

// --- Lo que se dice ---
assert.equal(piezaConArticulo(plan.plan.estructuras[1]!), "las dos columnas");
assert.equal(describirCambio(plan, { tipo: "protagonismo", estructuraId: SEMIARCO, indice: 0, direccion: 1 }), "más azul en el semiarco orgánico");
assert.equal(describirCambio(plan, { tipo: "quitar-color", estructuraId: COLUMNA, indice: 2 }), "sin blanco en las dos columnas");
assert.equal(describirCambio(plan, { tipo: "tamano", estructuraId: SEMIARCO, direccion: -1 }), "el semiarco orgánico de menor tamaño");
assert.equal(describirCambio(plan, { tipo: "quitar-pieza", estructuraId: COLUMNA }), "sin las dos columnas");
assert.equal(describirCambio(plan, { tipo: "agregar-color", color: "rosado" }), "con rosado");
assert.equal(contenidoPlanAjustado("Tu plan: 1 semiarco.", ["más azul en el semiarco orgánico", "sin las dos columnas"]), "Tu plan: 1 semiarco.\nAjusté: más azul en el semiarco orgánico; sin las dos columnas.");
const textos = [...piezas.flatMap((pieza) => [pieza.titulo, pieza.motivoFijo ?? "", ...pieza.colores.map((color) => color.etiqueta)]), describirCambio(plan, { tipo: "agregar-color", color: "dorado rosa" })].join(" ");
assert.ok(!/EST_|variant|product|sku|armado|motor|R-\d/i.test(textos), `sin jerga: ${textos}`);
assert.equal(mensajeAjuste(new FalloPlanEditar("El catálogo no vende los globos que ese arco necesita (R-5). Elige otro tamaño de globo o cambia los colores: así no se puede guardar.")), "No pude hacer ese cambio en esta pieza. Tu plan sigue como estaba; prueba con otro ajuste.", "la jerga del servidor no llega al cliente");
assert.equal(mensajeAjuste(new FalloPlanEditar("Revisa tu conexión a internet.")), "Revisa tu conexión a internet.");
assert.equal(mensajeAjuste(new FalloPlanEditar(CATALOGO_ERRORES_UI_V1.SIN_CONEXION.mensaje_usuario)), "No pude conectarme para hacer ese cambio. Tu plan sigue como estaba; revisa tu conexión y vuelve a intentarlo.", "la voz de la guiada: «No pude…», y el plan sigue igual");
assert.match(mensajeAjuste(new FalloPlanEditar(MENSAJE_EDICION_LENTA)), /^Ese cambio tardó demasiado.*Tu plan sigue como estaba/);

// --- El widget guarda los ajustes ---
assert.ok(WidgetGuiadoSchema.safeParse({ tipo: "plan", plan, ajustes: ["más azul en el semiarco orgánico"] }).success);

// --- Cómo se lleva a cabo (dobles sin coste) ---
async function probarEjecucion(): Promise<void> {
  const pedidas: EdicionPlan[] = [];
  const quitadas: string[] = [];
  const globos: GloboElegido[] = [];
  const dependencias: DependenciasAjuste = {
    aplicar: async (base, edicion) => { pedidas.push(edicion); return { plan: base, cotizacion: null }; },
    quitarPieza: async (_base, estructuraId) => { quitadas.push(estructuraId); return { plan: unaPieza, cotizacion: null }; },
    agregarColor: async (base, globo) => { globos.push(globo); return { plan: base, cotizacion: null, piezas: [SEMIARCO] }; },
    buscar: async () => candidatos,
  };
  await ejecutarCambio({ tipo: "protagonismo", estructuraId: SEMIARCO, indice: 0, direccion: 1 }, plan, dependencias);
  assert.deepEqual(pedidas.map((edicion) => edicion.accion), ["armado_arco_organico"], "un toque es UNA edición de Python");

  const conColor = await ejecutarCambio({ tipo: "agregar-color", color: "rosado" }, plan, dependencias);
  assert.deepEqual(globos, [{ productId: "fas", variantId: "fas12", variantIds: ["fas5", "fas12"], color: "rosado" }], "con globo liso, el color va al servidor con todos sus tamaños (sin modelo)");
  assert.deepEqual(conColor.piezas, [SEMIARCO], "el servidor dice qué piezas lo recibieron");
  await assert.rejects(ejecutarCambio({ tipo: "agregar-color", color: "azul" }, plan, dependencias), /ya lleva ese color/);

  const descartados: string[] = [];
  await assert.rejects(
    ejecutarCambio({ tipo: "agregar-color", color: "rosado" }, plan, { ...dependencias, buscar: async () => candidatos.slice(0, 1), alDescartarColor: (color) => descartados.push(color) }),
    /No encontré globos lisos rosados disponibles/,
  );
  assert.deepEqual(descartados, ["rosado"], "un color sin globo liso deja de ofrecerse");
  assert.equal(globos.length, 1, "y no se pide nada al servidor");

  const sinDerecha = await ejecutarCambio({ tipo: "quitar-pieza", estructuraId: DERECHA }, individual, dependencias);
  assert.equal(sinDerecha.plan, unaPieza);
  assert.deepEqual(quitadas, [DERECHA], "quitar la columna derecha pide quitar SOLO esa pieza");
  await assert.rejects(ejecutarCambio({ tipo: "quitar-pieza", estructuraId: SEMIARCO }, unaPieza, dependencias), /al menos una/, "la última pieza no se pide quitar");
  assert.deepEqual(quitadas, [DERECHA]);
  await assert.rejects(ejecutarCambio({ tipo: "quitar-pieza", estructuraId: COLUMNA }, plan, { ...dependencias, quitarPieza: async () => { throw new FalloPlanEditar("No pude hacer ese cambio. Tu plan sigue como estaba."); } }), /sigue como estaba/);
  await assert.rejects(ejecutarCambio({ tipo: "protagonismo", estructuraId: PARED, indice: 0, direccion: 1 }, casiTodo, dependencias), /límite/);
  await assert.rejects(ejecutarCambio({ tipo: "tamano", estructuraId: SEMIARCO, direccion: 1 }, plan, { ...dependencias, aplicar: async () => { throw new FalloPlanEditar("Sin conexión."); } }), /Sin conexión/, "si Python falla, el error sube y el plan que se ve no cambia");
}

probarEjecucion()
  .then(() => console.log("ajuste-plan-guiado: OK"))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; });
