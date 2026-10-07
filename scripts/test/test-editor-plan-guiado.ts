import assert from "node:assert/strict";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import type { EdicionPlan } from "../../src/lib/plan/edicion-esquemas";
import { patronConColor, planAdmiteColorNuevo, planConColor, planConColorReemplazado } from "../../src/lib/plan/ajuste-estructural";
import { PlanDecoracionSchema } from "../../src/lib/plan/tipos";
import { separarEstructurasRepetidas } from "../../src/lib/plan/piezas-individuales";
import type { CandidatoDelServidor } from "../../src/components/plan/ajuste/ajuste-propuesta";
import {
  confirmacionDelCambio,
  describirCambio,
  edicionCantidad,
  edicionMedidas,
  globosDeColor,
  medidasEditables,
  motivoSinColorNuevo,
  parejaDe,
  piezasAjustables,
  piezasDelCambio,
  type PlanGuiado,
} from "../../src/components/guiado/ajuste/ajuste-plan-guiado";
import { ejecutarCambio, type DependenciasAjuste, type PlanFirmado } from "../../src/components/guiado/ajuste/ejecutar-ajuste";
import { agruparGlobos, filtrarGlobos, globosDeCandidatos, planConImpresos } from "../../src/components/guiado/ajuste/selector-globos";

/**
 * El editor de «Tu plan» (pedidos del dueño 4, 6 y 7 y hallazgos 88/97), sin red ni modelo: cuántos globos de cada color
 * (la cifra se convierte en la parte del color y Python cuenta), medidas escritas y pasos del 10 %, piezas pareja,
 * «Cambiar» un color por otro globo del catálogo (mismo lugar, misma parte, todas sus medidas), «Añadir color» en
 * piezas con patrón, el selector del catálogo y la ejecución (con dobles: ninguna prueba llama a Python ni a Gemini).
 */

const HASH = "a".repeat(64);
const AZUL = "8634239385895";
const PLATA = "8634257211687";
const BLANCO = "8634235781415";
const DORADO = "8634000000001";

function linea(estructura: string, product: string, variant: string, color: string, diam: number, unidades: number, acabado = "fashion") {
  return { estructura_id: estructura, product_id: product, variant_id: variant, color, diam_pulg: diam, unidades, acabado, titulo: `B2b Globo Latex Redondo ${acabado} ${color} — R-${diam}` };
}

const materiales = [
  { product_id: AZUL, color: "azul", participacion: 0.4, rol_material: "principal" as const },
  { product_id: PLATA, color: "plateado", participacion: 0.3, rol_material: "secundario" as const, variant_id: "pl5", acabado: "reflex" },
  { product_id: BLANCO, color: "blanco", participacion: 0.3, rol_material: "acento" as const },
];

const SEMIARCO = "EST_01_SEMIARCO_ASIMETRICO";
const COLUMNA = "EST_02_COLUMNA";
const PARED = "EST_03_PARED";

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
          estructura_id: SEMIARCO, nombre: "Semiarco orgánico", tipo: "semiarco", rol_escena: "focal", ubicacion: "fondo_pared",
          medidas: { ancho_m: 1.58, alto_m: 2.23 }, repeticiones: 1, densidad: "media", mezcla: "organica_fina", materiales, porque: "Enmarca el espacio.",
          estructura_oficial: "semiarco_asimetrico",
          armado_arco_organico: {
            version: "armado-arco-organico.v1", origen: "sugerido",
            forma: { anchoM: 2.16, altoM: 2.2, cima: 0.4, curva: 2.1, ondulacion: 0.35, carga: -0.7, corte: 0.6, espejo: false, suelo: true },
            volumen: { grosorPatasM: 1.15, grosorCimaM: 0.6, irregularidad: 0.4, relleno: 0.68, racimo: 4, salientes: 0.4 },
            tamanos: { mezcla: { 5: 21, 9: 18, 12: 54, 18: 5, 24: 2, 36: 0 }, grandesAbajo: 0.9, inflado: 1, variacion: 0.12 },
            colores: { paleta: [{ material: 0, peso: 40, acabado: "mate", rol: "normal" }, { material: 1, peso: 30, acabado: "cromado", rol: "normal" }, { material: 2, peso: 30, acabado: "mate", rol: "normal" }], reparto: "azar", mezcla: 0.5 },
            adornos: { follaje: 0.8, flores: 0 },
            aspecto: { brillo: 0.6, sombra: 0.2, contorno: 0.8, profundidad: 0.5, semilla: 21 },
          },
        },
        {
          estructura_id: COLUMNA, nombre: "Columna", tipo: "columna", rol_escena: "soporte", ubicacion: "entrada",
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
          estructura_id: PARED, nombre: "Pared de globos", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo",
          medidas: { alto_m: 2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Rellena el lateral.",
          estructura_oficial: "columna",
        },
      ],
    },
    plan_hash: HASH,
    approval_token: "token-de-prueba",
    estructuras: [
      { estructura_id: SEMIARCO, lineas: [linea(SEMIARCO, AZUL, "az5", "azul", 5, 11), linea(SEMIARCO, AZUL, "az12", "azul", 12, 20), linea(SEMIARCO, PLATA, "pl5", "plateado", 5, 24, "reflex"), linea(SEMIARCO, BLANCO, "bl5", "blanco", 5, 24)] },
      { estructura_id: COLUMNA, lineas: [linea(COLUMNA, AZUL, "az12", "azul", 12, 22), linea(COLUMNA, PLATA, "pl12", "plateado", 12, 24, "reflex"), linea(COLUMNA, BLANCO, "bl12", "blanco", 12, 26)] },
      { estructura_id: PARED, lineas: [linea(PARED, AZUL, "az12", "azul", 12, 40), linea(PARED, PLATA, "pl12", "plateado", 12, 30, "reflex"), linea(PARED, BLANCO, "bl12", "blanco", 12, 30)] },
    ],
    compras: [{ product_id: AZUL, variant_id: "az12" }],
  });
}

const plan = planDePrueba();
const piezas = piezasAjustables(plan);

function campo<T extends EdicionPlan["accion"]>(edicion: EdicionPlan | null, accion: T): Extract<EdicionPlan, { accion: T }> {
  assert.ok(edicion, `se esperaba una edición ${accion}`);
  assert.equal(edicion.accion, accion);
  return edicion as Extract<EdicionPlan, { accion: T }>;
}

// --- Cuántos globos de cada color (pedido 4) ---
const arco = piezas[0]!;
assert.equal(arco.globos, 79, "la cifra de la pieza es la suma de lo que resolvió Python");
assert.deepEqual(arco.colores[0]!.tamanos, [{ pulgadas: 5, unidades: 11 }, { pulgadas: 12, unidades: 20 }], "cada color dice sus globos por tamaño");
assert.deepEqual(arco.colores[0]!.cantidad, { minimo: 1, maximo: 77 }, "se escribe entre 1 y lo que deja un globo a cada otro color");
assert.equal(piezas[1]!.colores[0]!.cantidad, null, "una columna de patrón no deja escribir la cifra (el patrón la decide)");
assert.ok(piezas[2]!.colores[0]!.cantidad, "una pieza con reparto sí");

// 31 azules → 21: la paleta toma esa parte (21/79) y los demás conservan su proporción entre sí, en la escala más fina.
const menosAzul = campo(edicionCantidad(plan, SEMIARCO, 0, 21), "armado_arco_organico");
const pesos = menosAzul.armado_arco_organico!.colores.paleta.map((color) => color.peso);
assert.deepEqual(pesos, [72, 100, 100], "azul 21 de 79; plata y blanco (24 y 24) quedan iguales entre sí y el mayor vale 100");
assert.equal(menosAzul.armado_arco_organico!.origen, "decorador");
assert.ok(Math.abs(pesos[0]! / (pesos[0]! + pesos[1]! + pesos[2]!) - 21 / 79) < 0.01, "la parte pedida es la de la cifra");
assert.equal(edicionCantidad(plan, SEMIARCO, 0, 31), null, "la misma cifra no pide nada");
assert.equal(edicionCantidad(plan, SEMIARCO, 0, 0), null, "cero no: para ninguno se quita el color");
assert.equal(edicionCantidad(plan, SEMIARCO, 0, 79), null, "todos no: los demás colores necesitan al menos uno");
assert.equal(edicionCantidad(plan, COLUMNA, 0, 10), null, "en un patrón de posiciones no se escribe la cifra");
const menosAzulPared = campo(edicionCantidad(plan, PARED, 0, 30), "repartir");
assert.deepEqual(menosAzulPared.participaciones, [0.3, 0.35, 0.35], "sin motor, el reparto lleva la parte de la cifra");

// --- Medidas: una sola, la de la tarjeta; se escriben en metros (hallazgo 97) ---
assert.deepEqual(medidasEditables(plan, SEMIARCO).map((medida) => [medida.campo, medida.valor, medida.pedida]), [["ancho_m", 1.58, 2.16], ["alto_m", 2.23, 2.2]], "se ve la medida armada (la de la tarjeta), no la pedida al motor");
const tresMetros = campo(edicionMedidas(plan, SEMIARCO, { ancho_m: 3 }), "armado_arco_organico");
assert.equal(tresMetros.armado_arco_organico!.forma.anchoM, 4.1, "para que la pieza armada mida 3 m se le piden 3 × 2,16/1,58");
assert.equal(tresMetros.armado_arco_organico!.forma.altoM, 2.2, "la medida que no se escribe queda igual");
assert.equal(edicionMedidas(plan, SEMIARCO, { ancho_m: 1.58 }), null, "la misma medida no pide nada");
assert.equal(campo(edicionMedidas(plan, COLUMNA, { alto_m: 2.4 }), "armado_columna").armado_columna!.cuerpo.alto_m, 2.4);
assert.deepEqual(campo(edicionMedidas(plan, PARED, { alto_m: 2.6 }), "propiedades").medidas, { alto_m: 2.6 });
assert.equal(campo(edicionMedidas(plan, SEMIARCO, { ancho_m: 40 }), "armado_arco_organico").armado_arco_organico!.forma.anchoM, 10, "dentro del rango del motor");

// --- Piezas pareja: «a las dos» (hallazgo 97) ---
const separado = separarEstructurasRepetidas({ ...plan.plan, estructuras: plan.plan.estructuras.slice(0, 2) }).plan;
const IZQUIERDA = separado.estructuras[1]!.estructura_id;
const DERECHA = separado.estructuras[2]!.estructura_id;
const individual = PlanGuiadoSchema.parse({ ...plan, plan: separado, estructuras: [plan.estructuras[0]!, { ...plan.estructuras[1]!, estructura_id: IZQUIERDA }, { ...plan.estructuras[1]!, estructura_id: DERECHA }] });
assert.equal(parejaDe(individual, IZQUIERDA)?.estructura_id, DERECHA, "la columna izquierda tiene pareja: la derecha");
assert.equal(parejaDe(individual, DERECHA)?.estructura_id, IZQUIERDA);
assert.equal(parejaDe(individual, SEMIARCO), null, "el semiarco no tiene pareja");
assert.deepEqual(piezasAjustables(individual)[1]!.pareja, { estructuraId: DERECHA, titulo: "Columna derecha", iguales: true }, "las dos columnas llevan lo mismo: «Hacer lo mismo» viene marcado");
assert.deepEqual(piezasDelCambio(individual, { tipo: "tamano", estructuraId: IZQUIERDA, direccion: 1, pareja: true }), [IZQUIERDA, DERECHA], "con «a las dos», las dos esperan el plan nuevo");
assert.equal(describirCambio(individual, { tipo: "tamano", estructuraId: IZQUIERDA, direccion: 1, pareja: true }), "la columna izquierda y la columna derecha más grandes");

// --- Cambiar un color por otro globo del catálogo (pedido 7) ---
const reflexDorado = { product_id: DORADO, color: "dorado", acabadoMotor: "cromado" as const };
const reemplazo = planConColorReemplazado(plan.plan, { color: "plateado" }, reflexDorado);
assert.deepEqual(reemplazo.piezas, [SEMIARCO, COLUMNA, PARED], "el color cambia en todas las piezas que lo llevan");
for (const estructura of reemplazo.plan.estructuras) {
  const antes = plan.plan.estructuras.find((item) => item.estructura_id === estructura.estructura_id)!;
  assert.deepEqual(estructura.medidas, antes.medidas, "las medidas no cambian");
  assert.deepEqual(estructura.materiales[1], { product_id: DORADO, color: "dorado", participacion: 0.3, rol_material: "secundario" }, "mismo lugar, misma parte y papel; sin variante ni acabado fijos (Python elige cada tamaño)");
  assert.deepEqual([estructura.materiales[0], estructura.materiales[2]], [antes.materiales[0], antes.materiales[2]], "los demás colores quedan igual");
  assert.equal(estructura.nombre, antes.nombre);
}
assert.deepEqual(reemplazo.plan.estructuras[0]!.armado_arco_organico!.colores.paleta.map((color) => [color.material, color.peso, color.acabado]), [[0, 40, "mate"], [1, 30, "cromado"], [2, 30, "mate"]], "la paleta del motor conserva pesos y pinta el globo nuevo con su acabado");
assert.deepEqual(reemplazo.plan.estructuras[1]!.armado_columna, plan.plan.estructuras[1]!.armado_columna, "el patrón de la columna queda igual (apunta al mismo lugar)");
assert.deepEqual(reemplazo.plan.concepto.paleta, ["azul", "dorado", "blanco"], "la paleta del concepto dice el color nuevo en su lugar");
assert.ok(PlanDecoracionSchema.safeParse(reemplazo.plan).success, "el plan sigue cumpliendo su contrato");
const soloArco = planConColorReemplazado(plan.plan, { color: "plateado", product_id: PLATA, estructuras: new Set([SEMIARCO]) }, reflexDorado);
assert.deepEqual(soloArco.piezas, [SEMIARCO]);
assert.deepEqual(soloArco.plan.estructuras.slice(1), plan.plan.estructuras.slice(1), "en una pieza: las demás quedan idénticas");
assert.deepEqual(soloArco.plan.concepto.paleta, ["azul", "plateado", "blanco", "dorado"], "el plata sigue en otras piezas: el dorado se suma");
const repetido = planConColorReemplazado(plan.plan, { color: "plateado" }, { product_id: AZUL, color: "azul", acabadoMotor: "mate" });
assert.equal(repetido.piezas.length, 0, "no se repite un globo que la pieza ya lleva");

// --- Añadir un color en piezas con patrón (verificador: «ya tiene cinco colores» falso) ---
const patron = { version: "patron-color.v1" as const, origen: "referencia" as const, base: { modo: "espiral" as const, racimo: [0, 1, 0, 1], trazo: "espiral" as const }, globos_por_racimo: 4 };
assert.deepEqual(patronConColor(patron, 2)?.base, { modo: "espiral", racimo: [0, 1, 2, 1], trazo: "espiral" }, "la espiral da al color nuevo una posición del que más se repite");
assert.deepEqual(patronConColor({ ...patron, base: { modo: "aleatorio", pesos: [{ material: 0, peso: 60 }, { material: 1, peso: 40 }], semilla: 3 } }, 2)?.base, { modo: "aleatorio", pesos: [{ material: 0, peso: 60 }, { material: 1, peso: 40 }, { material: 2, peso: 25 }], semilla: 3 });
assert.equal(patronConColor({ ...patron, base: { modo: "espiral", racimo: [0, 1], trazo: "espiral" } }, 2), null, "sin una posición que sobre, no se borra un color");
const dosColores = { product_id: AZUL, color: "azul", participacion: 0.5, rol_material: "principal" as const };
const columnaConPatron = {
  ...plan.plan.estructuras[2]!, estructura_id: "EST_04_COLUMNA", nombre: "Columna de espiral", rol_escena: "focal" as const,
  materiales: [dosColores, { product_id: PLATA, color: "plateado", participacion: 0.5, rol_material: "secundario" as const }],
  patron_color: patron,
};
const conPatron = PlanDecoracionSchema.parse({ ...plan.plan, estructuras: [columnaConPatron] });
assert.equal(planAdmiteColorNuevo(conPatron), true, "una columna con patrón (sin motor) admite un color más");
const agregado = planConColor(conPatron, { product_id: BLANCO, color: "blanco", acabadoMotor: "mate" });
assert.deepEqual(agregado.piezas, ["EST_04_COLUMNA"]);
assert.deepEqual(agregado.plan.estructuras[0]!.patron_color?.base, { modo: "espiral", racimo: [0, 1, 2, 1], trazo: "espiral" });
const planDos = PlanGuiadoSchema.parse({ ...plan, plan: { ...plan.plan, estructuras: [{ ...plan.plan.estructuras[1]!, rol_escena: "focal" as const, armado_columna: { ...plan.plan.estructuras[1]!.armado_columna!, patron: "solido" }, materiales: [dosColores, { ...dosColores, product_id: PLATA, color: "plateado", rol_material: "secundario" as const }] }] }, estructuras: [plan.estructuras[1]!] });
const motivo = motivoSinColorNuevo(planDos);
assert.ok(motivo && !/cinco/.test(motivo), `un plan de dos colores no dice «cinco colores»: ${motivo}`);
assert.match(motivo!, /Cambiar/, "y ofrece cambiar un color por otro");

// --- El selector del catálogo ---
const candidatos: CandidatoDelServidor[] = [
  { productId: "ref-dor", titulo: "B2b Globo Latex Redondo Reflex Dorado", imagen: "https://cdn.shopify.com/x.png", variantes: [
    { variantId: "rd5", titulo: "R-5", disponible: true, codigoTamano: "R-5", diamPulg: 5, forma: "redondo", colores: ["dorado"] },
    { variantId: "rd12", titulo: "R-12 / PAQUETE X 50", disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: ["dorado"] },
    { variantId: "rd12b", titulo: "R-12 / PAQUETE X 12", disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: ["dorado"] },
    { variantId: "rd18", titulo: "R-18", disponible: false, codigoTamano: "R-18", diamPulg: 18, forma: "redondo", colores: ["dorado"] },
  ] },
  { productId: "imp", titulo: "B2b Globo Latex Redondo 2 Caras Feliz Cumpleaños Reflex Dorado", imagen: null, variantes: [{ variantId: "imp12", titulo: "R-12", disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: ["dorado"] }] },
  { productId: "silk-bl", titulo: "B2b Globo Latex Redondo Silk Blanco Nácar", imagen: null, variantes: [{ variantId: "sb12", titulo: "R-12", disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: ["blanco"] }] },
  { productId: "perla", titulo: "B2b Globo Latex Redondo Satin Perla", imagen: null, variantes: [{ variantId: "sp12", titulo: "R-12", disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: [] }] },
  { productId: "fas-ros", titulo: "B2b Globo Latex Redondo Fashion Rosado", imagen: null, variantes: [{ variantId: "fr12", titulo: "R-12", disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: ["rosado"] }, { variantId: "frc", titulo: "Corazón", disponible: true, codigoTamano: null, diamPulg: 12, forma: "corazon", colores: ["rosado"] }] },
];
const globos = globosDeCandidatos(candidatos);
assert.deepEqual(globos.map((globo) => globo.productId), ["ref-dor", "silk-bl", "fas-ros"], "solo lisos con color: ni impresos ni productos sin color");
assert.deepEqual(globos[0]!.tamanos, [5, 12], "los tamaños disponibles (el agotado no)");
assert.deepEqual(globos[0]!.variantIds, ["rd5", "rd12", "rd12b"], "todas las variantes del color, para comprarlo en cada medida");
assert.equal(globos[0]!.nombre, "Reflex Dorado", "el nombre Sempertex");
assert.deepEqual(globos[2]!.tamanos, [12], "solo redondos");
assert.equal(globosDeCandidatos(candidatos, { conImpresos: true }).length, 4, "con un plan de foto con impresos, también se ofrecen");
assert.equal(planConImpresos(["B2b Globo Latex Redondo Impreso 2 Caras Copa Dorada"]), true);
const grupos = agruparGlobos(globos, [{ valor: "rosado", total: 99 }, { valor: "dorado", total: 130 }, { valor: "blanco", total: 74 }]);
assert.deepEqual(grupos.map((grupo) => grupo.nombre), ["Dorados", "Rosados", "Blancos, negros y neutros"], "las familias de la más vendida a la menos");
assert.deepEqual(filtrarGlobos(globos, "nácar").map((globo) => globo.productId), ["silk-bl"], "se busca por nombre, color o acabado, sin tildes");
assert.deepEqual(agruparGlobos(globos, [], new Set(["ref-dor|dorado"])).flatMap((grupo) => grupo.globos.map((globo) => globo.productId)).includes("ref-dor"), false, "el globo que ya está no se ofrece");

// --- Cómo se lleva a cabo (dobles sin coste) ---
/** Un plan «resuelto» con otra cifra de azules en el semiarco, como lo devolvería Python. */
function conAzules(base: PlanGuiado, azules: number): PlanGuiado {
  return {
    ...base,
    plan_hash: `${azules}`.padStart(64, "b"),
    estructuras: base.estructuras.map((estructura) => (estructura.estructura_id === SEMIARCO
      ? { ...estructura, lineas: [linea(SEMIARCO, AZUL, "az12", "azul", 12, azules), linea(SEMIARCO, PLATA, "pl5", "plateado", 5, 24, "reflex"), linea(SEMIARCO, BLANCO, "bl5", "blanco", 5, 79 - 24 - azules)] }
      : estructura)),
  };
}

async function probarEjecucion(): Promise<void> {
  const sinUso: Omit<DependenciasAjuste, "aplicar"> = {
    quitarPieza: async () => { throw new Error("no se esperaba"); },
    agregarColor: async () => { throw new Error("no se esperaba"); },
    buscar: async () => [],
  };

  // «−1» que Python deja igual: se vuelve a pedir con un paso mayor hasta que la cifra se mueve.
  const pedidas: Array<{ base: string; edicion: EdicionPlan }> = [];
  const respuestas = [31, 30];
  const resultado = await ejecutarCambio({ tipo: "cantidad", estructuraId: SEMIARCO, indice: 0, objetivo: 30, desde: 31 }, plan, {
    ...sinUso,
    aplicar: async (base, edicion) => { pedidas.push({ base: base.plan_hash, edicion }); return { plan: conAzules(base, respuestas.shift() ?? 30), cotizacion: null }; },
  });
  assert.equal(pedidas.length, 2, "el primer «−1» dejó 31: se pidió otra vez con −2");
  assert.ok(pedidas.every((pedida) => pedida.base === HASH), "cada intento sale del plan que se ve, no del anterior");
  assert.equal(globosDeColor(resultado.plan, SEMIARCO, "azul"), 30);
  assert.match(confirmacionDelCambio(plan, { tipo: "cantidad", estructuraId: SEMIARCO, indice: 0, objetivo: 30, desde: 31 }, undefined, resultado.plan), /^Listo: el semiarco orgánico lleva 30 globos azules.*la medida no cambió/);
  assert.match(confirmacionDelCambio(plan, { tipo: "cantidad", estructuraId: SEMIARCO, indice: 0, objetivo: 21, desde: 31 }, undefined, conAzules(plan, 22)), /lleva 22 globos azules; pediste 21/, "si Python deja otra cifra, se dice la suya");

  // «A las dos»: primero la izquierda y, sobre ESE plan, la derecha.
  const enOrden: Array<{ base: string; estructura: string }> = [];
  await ejecutarCambio({ tipo: "medidas", estructuraId: IZQUIERDA, medidas: { alto_m: 2.4 }, pareja: true }, individual, {
    ...sinUso,
    aplicar: async (base, edicion) => {
      enOrden.push({ base: base.plan_hash, estructura: edicion.estructura_id });
      const plano = PlanGuiadoSchema.parse({ ...base, plan_hash: "c".repeat(64), plan: { ...base.plan, estructuras: base.plan.estructuras.map((estructura) => (estructura.estructura_id === edicion.estructura_id ? { ...estructura, medidas: { alto_m: 2.4 } } : estructura)) } });
      return { plan: plano, cotizacion: null } satisfies PlanFirmado;
    },
  });
  assert.deepEqual(enOrden, [{ base: HASH, estructura: IZQUIERDA }, { base: "c".repeat(64), estructura: DERECHA }], "la pareja se ajusta sobre el plan que ya trae la primera, con su misma medida");

  // «Cambiar» va al servidor con el globo elegido y todas sus variantes.
  const reemplazos: unknown[] = [];
  await ejecutarCambio({ tipo: "reemplazar-color", color: "plateado", globo: { productId: "ref-dor", color: "dorado", variantIds: ["rd5", "rd12"], nombre: "Reflex Dorado" } }, plan, {
    ...sinUso,
    aplicar: async () => { throw new Error("no se esperaba"); },
    reemplazarColor: async (base, cambio) => { reemplazos.push(cambio); return { plan: base, cotizacion: null, piezas: [SEMIARCO] }; },
  });
  assert.equal(reemplazos.length, 1);
  assert.equal(describirCambio(plan, { tipo: "reemplazar-color", color: "plateado", globo: { productId: "ref-dor", color: "dorado", variantIds: ["rd5"], nombre: "Reflex Dorado" } }), "Reflex Dorado en lugar de plateado");

  // «Añadir color» con un globo del catálogo: va tal cual, sin buscar otro.
  const agregados: unknown[] = [];
  await ejecutarCambio({ tipo: "agregar-color", color: "rosado", globo: { productId: "fas-ros", color: "rosado", variantIds: ["fr12"], nombre: "Fashion Rosado" } }, plan, {
    ...sinUso,
    aplicar: async () => { throw new Error("no se esperaba"); },
    agregarColor: async (base, globo) => { agregados.push(globo); return { plan: base, cotizacion: null, piezas: [SEMIARCO] }; },
    buscar: async () => { throw new Error("no debe buscar: el globo ya está elegido"); },
  });
  assert.deepEqual(agregados, [{ productId: "fas-ros", variantId: "fr12", variantIds: ["fr12"], color: "rosado" }]);

  // «Hacerla más grande»: cada pieza un 10 %, encadenadas.
  const piezasAgrandadas: string[] = [];
  await ejecutarCambio({ tipo: "tamano-todo", direccion: 1 }, plan, { ...sinUso, aplicar: async (base, edicion) => { piezasAgrandadas.push(edicion.estructura_id); return { plan: base, cotizacion: null }; } });
  assert.deepEqual(piezasAgrandadas, [SEMIARCO, COLUMNA, PARED], "todas las piezas crecen, una tras otra");
}

probarEjecucion()
  .then(() => console.log("editor-plan-guiado: OK"))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; });
