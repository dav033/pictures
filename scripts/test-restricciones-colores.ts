/**
 * Vocabulario de colores del cliente (W2.1, D6).
 *
 * Antes, `ALIAS_COLORES_CLIENTE` era una lista escrita a mano de 13 palabras:
 * "amarillo", "fucsia", "turquesa", "coral" o "vino" nunca llegaban a ser
 * restricción obligatoria, `validarRestriccionesPlan` no podía reclamarlos y la
 * conversación no detectaba que se retiraran. Ahora el vocabulario se deriva de
 * la taxonomía del catálogo, que es la dueña de los sinónimos de color.
 *
 * Puro: sin proveedor, HTTP, base de datos ni entorno.
 */
import assert from "node:assert/strict";
import { ALIAS_COLORES_CLIENTE, canonizarColorCliente, extraerRestriccionesUsuario, validarRestriccionesPlan } from "../src/lib/plan/restricciones";
import { coloresVigentes, extraerRestriccionesConversacion } from "../src/lib/plan/restricciones-conversacion";
import { PALETA_COLORES_V2 } from "../src/lib/rag/taxonomy/v2";
import { PlanDecoracionSchema } from "../src/lib/plan/tipos";

const colores = (texto: string): string[] => extraerRestriccionesUsuario(texto).colores.map((color) => color.valor);

// 1. Todo color del catálogo (menos "multicolor", que es surtido) se puede exigir.
const VALOR_CLIENTE: Readonly<Record<string, string>> = { rosado: "rosa" };
for (const color of PALETA_COLORES_V2) {
  if (color === "multicolor") continue;
  assert.deepEqual(colores(`quiero globos ${color}`), [VALOR_CLIENTE[color] ?? color], `"${color}" debe quedar como restricción obligatoria`);
}

// 2. Escenarios de falla verificados: la propuesta se firmaba sin estos colores.
assert.deepEqual(colores("Quiero un arco amarillo y azul con detalles fucsia").sort(), ["amarillo", "azul", "fucsia"]);
assert.deepEqual(colores("arco turquesa y coral").sort(), ["coral", "turquesa"]);
assert.deepEqual(colores("globos color vino y champagne para boda").sort(), ["burdeos", "champagne"]);
assert.deepEqual(colores("globos naranjas con detalles dorados").sort(), ["dorado", "naranja"]);

// 3. Plurales y femeninos son como el cliente escribe el color.
assert.deepEqual(colores("globos amarillas y turquesas").sort(), ["amarillo", "turquesa"]);
assert.deepEqual(colores("detalles corales").sort(), ["coral"]);

// 4. Los alias de varias palabras se emparejan primero y tapan al corto.
assert.deepEqual(colores("globos oro rosa y blancos").sort(), ["blanco", "dorado rosa"]);
assert.deepEqual(colores("globos rojo vino"), ["burdeos"]);
assert.deepEqual(colores("globos rosa y oro rosa").sort(), ["dorado rosa", "rosa"]);

// 5. Usos que no son color: exigirlos dejaría un rechazo imposible de corregir.
assert.deepEqual(colores("hay una torta de crema en la mesa principal"), []);
assert.deepEqual(colores("cada mesa lleva una copa de vino"), []);
assert.deepEqual(colores("el centro de mesa lleva rosas naturales"), []);
assert.deepEqual(colores("un ramo de rosas en la entrada"), []);
// El color sí se exige cuando el cliente lo nombra como color.
assert.deepEqual(colores("globos color crema"), ["crema"]);
assert.deepEqual(colores("globos color vino"), ["burdeos"]);

// 6. La negación existente se conserva, también con los alias compuestos: el
//    tramo negado se tapa, así que el alias corto que vive dentro del largo no
//    convierte el "sin" del cliente en la restricción obligatoria contraria.
assert.deepEqual(colores("un arco azul, sin amarillo"), ["azul"]);
assert.deepEqual(colores("Arco azul y blanco sin oro rosa").sort(), ["azul", "blanco"]);
assert.deepEqual(colores("Arco azul sin dorado rosa"), ["azul"]);
assert.deepEqual(colores("Arco azul sin rojo vino"), ["azul"]);
assert.deepEqual(colores("Arco azul sin wine red"), ["azul"]);

// 7. Valores canónicos que ya usan los planes firmados y `colorDeCatalogo`.
assert.deepEqual(colores("globos rosados y plateados").sort(), ["plateado", "rosa"]);
assert.equal(canonizarColorCliente("plateadas"), "plateado");
assert.equal(canonizarColorCliente("rosada"), "rosa");
assert.equal(canonizarColorCliente("oro rosa"), "dorado rosa");
assert.ok(ALIAS_COLORES_CLIENTE.includes("amarillas"), "el vocabulario incluye los femeninos de la taxonomía");
assert.ok(!ALIAS_COLORES_CLIENTE.includes("multicolor"), "multicolor no es un color exigible");
// Formas generadas: solo el plural español. El femenino morfológico inventaba
// palabras reales que no son color ("oro" → "ora", "vino" → "viña") y el plural
// de un alias inglés, palabras inexistentes o de otro significado ("blues").
for (const forma of ["ora", "oras", "vina", "vinas", "doradoses", "goldes", "pinkes", "greenes", "ivoryes", "blues", "redes"]) {
  assert.ok(!ALIAS_COLORES_CLIENTE.includes(forma), `"${forma}" no es una palabra de color`);
}
for (const forma of ["turquesas", "corales", "lilas", "violetas", "azules"]) {
  assert.ok(ALIAS_COLORES_CLIENTE.includes(forma), `"${forma}" sí es como el cliente escribe el color`);
}
assert.deepEqual(colores("la finca esta entre las vinas del sur"), []);

// 8. `validarRestriccionesPlan` ya puede reclamar los colores nuevos.
const planBase = {
  plan_version: "1.0",
  plan_id: "11111111-1111-4111-8111-111111111111",
  concepto: { titulo: "Fiesta", descripcion: "Instalación focal.", paleta: ["azul"] },
  espacio: { tipo: "salón", fuente: "supuesto" },
  estructuras: [{
    estructura_id: "EST_01_ARCO",
    nombre: "Arco focal",
    tipo: "arco",
    rol_escena: "focal",
    ubicacion: "arco_central",
    medidas: { ancho_m: 3, alto_m: 2.4 },
    repeticiones: 1,
    densidad: "media",
    mezcla: "organica_fina",
    materiales: [
      { product_id: "P-1", color: "azul", participacion: 0.6, rol_material: "principal" },
      { product_id: "P-2", color: "blanco", participacion: 0.4, rol_material: "secundario" },
    ],
    porque: "Punto focal de las fotos.",
  }],
  supuestos: [],
};
const restriccionesAmarillo = extraerRestriccionesUsuario("Quiero un arco amarillo y azul con detalles fucsia");
const planAzulBlanco = PlanDecoracionSchema.parse({ ...planBase, restricciones: restriccionesAmarillo });
const errores = validarRestriccionesPlan(planAzulBlanco, planAzulBlanco.restricciones!);
assert.match(errores.join(" | "), /Pediste el color amarillo y la propuesta todavía no lo incluye/);
assert.match(errores.join(" | "), /Pediste el color fucsia y la propuesta todavía no lo incluye/);
assert.equal(errores.length, 2, "el azul del plan cubre el azul pedido");

// "rosa" (restricción) sigue cubierta por "rosado" (catálogo).
const planRosado = PlanDecoracionSchema.parse({
  ...planBase,
  estructuras: [{ ...planBase.estructuras[0]!, materiales: [{ product_id: "P-1", color: "rosado", participacion: 1, rol_material: "principal" }] }],
  restricciones: extraerRestriccionesUsuario("un arco rosa"),
});
assert.deepEqual(validarRestriccionesPlan(planRosado, planRosado.restricciones!), []);

// 9. Retiro en conversación para los colores nuevos.
assert.deepEqual(coloresVigentes(["en amarillo y azul", "cambia el amarillo por naranja"]), { vigentes: ["azul", "naranja"], retirados: ["amarillo"] });
assert.deepEqual(coloresVigentes(["quiero turquesa y coral", "sin turquesa"]), { vigentes: ["coral"], retirados: ["turquesa"] });
assert.deepEqual(
  extraerRestriccionesConversacion(["arco en fucsia y dorado", "quita el fucsia"]).colores.map((color) => color.valor),
  ["dorado"],
);

// 10. Tolerancia de los colores que el propio servidor reemplazó (regla 1 de
//     cobertura). Solo vale entre dos nombres del mismo tono: los tags del
//     catálogo son FAMILIAS de color, así que un "arco naranja" resuelto con el
//     Pastel Mate Nude (tags NARANJAS) se cotizaría, compraría y dibujaría nude
//     sin ningún aviso al cliente si la tolerancia lo diera por cubierto.
const planDeColor = (color: string, restricciones: ReturnType<typeof extraerRestriccionesUsuario>) => PlanDecoracionSchema.parse({
  ...planBase,
  estructuras: [{ ...planBase.estructuras[0]!, materiales: [{ product_id: "P-1", color, participacion: 1, rol_material: "principal" }] }],
  restricciones,
});
const planVioleta = planDeColor("violeta", extraerRestriccionesUsuario("quiero un arco morado"));
assert.deepEqual(validarRestriccionesPlan(planVioleta, planVioleta.restricciones!), ["Pediste el color morado y la propuesta todavía no lo incluye."]);
assert.deepEqual(validarRestriccionesPlan(planVioleta, planVioleta.restricciones!, [{ antes: "morado", despues: "violeta" }]), []);
const planNude = planDeColor("nude", extraerRestriccionesUsuario("quiero un arco naranja"));
assert.deepEqual(
  validarRestriccionesPlan(planNude, planNude.restricciones!, [{ antes: "naranja", despues: "nude" }]),
  ["Pediste el color naranja y la propuesta todavía no lo incluye."],
  "nude no es naranja: el cambio de color del servidor no cubre la restricción",
);

// 11. Palabras ambiguas: un alias que también es una palabra común solo cuenta
//     como color con una señal ("globos color vino") o enumerado con otro
//     color. Sin la guarda, una conversación normal de decoración dejaba un
//     color obligatorio imposible de cumplir (RESTRICCIONES_INCONSISTENTES) y
//     apagaba los colores de la foto de referencia.
const conversacion = (mensajes: string[]): string[] => extraerRestriccionesConversacion(mensajes).colores.map((color) => color.valor);
assert.deepEqual(conversacion(["Hola", "quiero un arco azul", "la torta va con crema y chocolate"]), ["azul"]);
assert.deepEqual(conversacion(["Arco azul y blanco, habra brindis con champana"]).sort(), ["azul", "blanco"]);
assert.deepEqual(conversacion(["Arco azul y blanco, luego lo publico en redes"]).sort(), ["azul", "blanco"]);
assert.deepEqual(colores("la fiesta es en un cafe del centro"), []);
assert.deepEqual(colores("la mesa de dulces lleva chocolate y arena decorativa"), []);
assert.deepEqual(colores("vino mi tia con el dj"), []);
assert.deepEqual(colores("el postre lleva lima y galletas"), []);
assert.deepEqual(colores("centros de mesa con menta natural"), ["menta"], "solo el alias ambiguo necesita señal");
// Y siguen siendo color cuando el cliente los pide como color.
assert.deepEqual(colores("globos color cafe"), ["cafe"]);
assert.deepEqual(colores("en tonos champagne"), ["champagne"]);
assert.deepEqual(colores("un arco vino y azul").sort(), ["azul", "burdeos"]);
assert.deepEqual(colores("globos crema y chocolate").sort(), ["cafe", "crema"]);
assert.deepEqual(colores("arco azul con crema").sort(), ["azul", "crema"]);

console.log("[PASS] vocabulario de colores del cliente — taxonomía v2, plurales, alias largos, exclusiones y retiro en conversación");
