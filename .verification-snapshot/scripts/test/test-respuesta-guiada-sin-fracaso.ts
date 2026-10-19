import { strict as assert } from "node:assert";
import { tematicasDisponibles } from "@/lib/biblioteca-sempertex/biblioteca";
import { generoDeDecoracion, generosBabyShower, ideasGuiadas, ideasRealesDeOpcion, NOMBRE_GENERO, type GeneroBebe } from "@/lib/ia/guiado/ideas-guiadas";
import {
  CHIP_FOTO_GUIADA, esFraseDeFracaso, FiltroFlujoGuiado, FRASE_IDEAS_GUIADAS, PREGUNTA_ESTILO_GUIADA, sanearRespuestaGuiada, validarOpcionesReales, type ContextoRespuesta,
} from "@/lib/ia/guiado/respuesta-guiada";

// Dueño (2026-10-07): «las opciones que desemboquen en "no encontré decoraciones de este estilo" deben ser eliminadas».
// Sin coste: no llama a ningún modelo. Parte con una biblioteca fija (contarIdeas inyectado) y parte con la real.

const opcionesDe = (texto: string): string[] => {
  const ultima = texto.trimEnd().split("\n").at(-1) ?? "";
  return /^opciones:/i.test(ultima) ? ultima.replace(/^opciones:\s*/i, "").split(" | ") : [];
};
const SIN_NEUTRO: Readonly<Record<string, number>> = { "niño": 3, "niña": 2, "neutro": 0, "azul y plateado": 4, "baby shower niña": 2 };
const contarFijo = (opcion: string): number => SIN_NEUTRO[opcion.toLocaleLowerCase("es")] ?? 0;
const babyShower = (generosValidos: GeneroBebe[], ideasEnTurno = 0): ContextoRespuesta => ({ evento: "baby shower", generosValidos, aplicar: true, ideasEnTurno, contarIdeas: contarFijo });

// ── Caso real, turno 1: «Baby shower» → «¿niño, niña o neutro?» sin decoraciones neutras ───────────────────────────────
const turno1 = sanearRespuestaGuiada("¡Qué bella ocasión! ¿El baby shower será para niño, niña o neutro?\n\nOpciones: Niño | Niña | Neutro | Aún no lo sabemos", babyShower(["nino", "nina"]));
assert.ok(turno1.texto.includes("¿El baby shower será para niño o niña?"), turno1.texto);
assert.ok(!/neutro/i.test(turno1.texto), `«Neutro» no se ofrece ni en la pregunta ni en los botones: ${turno1.texto}`);
assert.deepEqual(opcionesDe(turno1.texto), ["Niño", "Niña", "Aún no lo sabemos"]);
assert.deepEqual(turno1.opciones?.quitadas.map((quitada) => [quitada.opcion, quitada.ideas]), [["Neutro", 0]]);
// Con decoraciones neutras, la misma respuesta queda intacta.
const conNeutro = "¡Qué bella ocasión! ¿El baby shower será para niño, niña o neutro?\n\nOpciones: Niño | Niña | Neutro";
assert.equal(sanearRespuestaGuiada(conNeutro, { ...babyShower(["nino", "nina", "neutro"]), contarIdeas: () => 3 }).texto, conNeutro);

// ── Caso real, turno 2: «Neutro» → «No encontré ideas exactas… ¿beige, verde menta o blanco?» ──────────────────────────
const crudo2 = "No encontré ideas exactas para un estilo neutro. ¿Te gustaría probar con colores como beige, verde menta o blanco, o subir una foto de inspiración?\n\nOpciones: Beige y dorado | Verde menta y blanco | Amarillo y gris | Blanco y champagne | Subir foto de inspiración";
const turno2 = sanearRespuestaGuiada(crudo2, babyShower(["nino", "nina"]));
assert.ok(!/encontr|no hay|no tengo/i.test(turno2.texto), `Sin frase de fracaso: ${turno2.texto}`);
assert.ok(turno2.huboFracaso && turno2.texto.startsWith(PREGUNTA_ESTILO_GUIADA), turno2.texto);
const opciones2 = opcionesDe(turno2.texto);
assert.ok(!opciones2.some((opcion) => /beige|menta|amarillo|champagne/i.test(opcion)), opciones2.join(" | "));
assert.ok(opciones2.includes(CHIP_FOTO_GUIADA), "«Subir foto…» pasa al botón que abre el selector de fotos");
assert.ok(opciones2.filter((opcion) => opcion !== CHIP_FOTO_GUIADA).every((opcion) => contarFijo(opcion) > 0) && opciones2.length >= 3, opciones2.join(" | "));

// ── Frases de fracaso ─────────────────────────────────────────────────────────────────────────────────────────────────
for (const frase of ["No encontré ideas exactas para un estilo neutro.", "No tengo una de princesas exacta.", "No hay decoraciones en beige.", "Lamentablemente no contamos con ese estilo.", "No son exactas, pero se parecen."]) {
  assert.ok(esFraseDeFracaso(frase), frase);
}
for (const frase of ["¡No hay problema!", "Te dejo unas ideas que pueden encantarte, ¿alguna te gusta?", "Si no te convence ninguna, te propongo algo a medida.", "¿Es para tu negocio o para uso personal?"]) {
  assert.ok(!esFraseDeFracaso(frase), frase);
}
const cumple6: ContextoRespuesta = { evento: "cumpleaños", edad: 6, generosValidos: [], aplicar: true, ideasEnTurno: 4 };
assert.equal(sanearRespuestaGuiada("No tengo una de princesas exacta, pero estas en rosa le pueden quedar muy bien. ¿Alguna te gusta?", cumple6).texto, "Estas en rosa le pueden quedar muy bien. ¿Alguna te gusta?");
// Solo fracaso con ideas a la vista: frase cálida y sin botones.
assert.equal(sanearRespuestaGuiada("No encontré una exacta.\nOpciones: Dorado | Plateado", cumple6).texto, FRASE_IDEAS_GUIADAS);
// En plan, propuesta o proveedores no se toca nada.
const proveedores = "No hay decoradores en Pasto. Sí hay en Bogotá y Cali.";
assert.equal(sanearRespuestaGuiada(proveedores, { ...cumple6, aplicar: false }).texto, proveedores);

// ── Sugerencias de colores sin ninguna foto en la biblioteca ─────────────────────────────────────────────────────────
const colores = sanearRespuestaGuiada("¿Te gustan los tonos beige o verde menta?\nOpciones: Beige | Verde menta", { evento: "baby shower", generosValidos: ["nino", "nina"], aplicar: true, ideasEnTurno: 0 });
assert.ok(colores.texto.startsWith(PREGUNTA_ESTILO_GUIADA) && !/beige|menta/i.test(colores.texto), colores.texto);
assert.ok(opcionesDe(colores.texto).filter((opcion) => opcion !== CHIP_FOTO_GUIADA).every((opcion) => ideasRealesDeOpcion(opcion, { evento: "baby shower" }) > 0), colores.texto);

// ── Lo que no es estilo se conserva tal cual ─────────────────────────────────────────────────────────────────────────
const edades = "¿Cuántos años cumple?\nOpciones: 1 a 3 años | 4 a 6 años | 7 a 12 años | Adulto";
assert.equal(sanearRespuestaGuiada(edades, cumple6).texto, edades);
const ciudades = "¿En qué ciudad estás?\nOpciones: Bogotá | Medellín | Cali | Otra ciudad";
assert.equal(validarOpcionesReales(ciudades, { evento: "boda" }).texto, ciudades);

// ── Biblioteca real: cada opción ofrecida lleva a ideas reales de ese estilo ─────────────────────────────────────────
for (const [evento, pregunta] of [["baby shower", "¿Qué estilo te gusta?\nOpciones: Neutro | Princesas | Beige | Azul y plateado | Otra idea"], ["boda", "¿Qué colores te gustan?\nOpciones: Blanco y dorado | Rústico | Vintage | Romántico rosa y dorado"], ["cumpleaños", "¿Qué temática te gusta?\nOpciones: Videojuegos | Superhéroes | Dinosaurios | Unicornios"]] as const) {
  const validado = validarOpcionesReales(pregunta, { evento, edad: evento === "cumpleaños" ? 6 : undefined });
  const ofrecidas = opcionesDe(validado.texto).filter((opcion) => !/^otra/i.test(opcion));
  assert.ok(ofrecidas.length >= 2, `${evento}: al menos dos estilos reales (${validado.texto})`);
  for (const opcion of ofrecidas) assert.ok(ideasRealesDeOpcion(opcion, { evento, edad: evento === "cumpleaños" ? 6 : undefined }) > 0, `${evento}: «${opcion}» lleva a ideas reales`);
  for (const quitada of validado.quitadas) assert.equal(quitada.ideas, 0, `${evento}: solo se quita lo que no tiene ideas (${quitada.opcion})`);
}

// ── Búsqueda: ningún género de baby shower desemboca en vacío; si hay del género, todas son de ese género ─────────────
for (const { genero, ideas } of generosBabyShower()) {
  const resultado = ideasGuiadas({ evento: "baby shower", tematica: NOMBRE_GENERO[genero] });
  assert.ok(resultado.ideas.length > 0, `baby shower ${genero}: nunca vacío`);
  if (ideas > 0) {
    assert.equal(resultado.via, "genero", `baby shower ${genero}`);
    assert.ok(resultado.ideas.every((idea) => idea.coincidencia === "exacta" && generoDeDecoracion(idea) === genero), `baby shower ${genero}: ${resultado.ideas.map((idea) => idea.titulo).join(", ")}`);
  } else assert.equal(resultado.via, "evento", `baby shower ${genero}: las reales más cercanas del mismo evento`);
}
// «Niño» ya no se queda en blanco por no decir «niño» en el título: los semiarcos azules de baby shower son de niño.
assert.ok(ideasGuiadas({ evento: "baby shower", tematica: "niño" }).ideas.every((idea) => /azul|celeste|niño/i.test(`${idea.titulo} ${idea.tematica}`)));
// Las temáticas del evento con ideas son las que el estado ofrece al modelo.
assert.ok(tematicasDisponibles("baby shower").some((tematica) => ideasRealesDeOpcion(tematica, { evento: "baby shower" }) > 0));

// ── Regresión real (usabilidad 97, registro 41f332fb): la pregunta de la edad nunca se rellena con estilos ───────────
// «¡Qué gran motivo para celebrar!» (con «motivo») volvía «de estilo» la pregunta de la edad: el saneo metía 4 estilos y el
// recorte a 6 se comía «7 a 12 años | Adolescente | Adulto». Una mamá con una hija de 9 años se quedaba sin botón.
const crudoEdad = "¡Qué gran motivo para celebrar! ¿Cuántos años cumple el o la festejada?\nOpciones: 1 a 3 años | 4 a 6 años | 7 a 12 años | Adolescente | Adulto";
for (const contextoEdad of [
  { evento: "cumpleaños", generosValidos: ["nino", "nina", "neutro"], aplicar: true, ideasEnTurno: 0 },
  { evento: "cumpleaños", generosValidos: ["nino", "nina", "neutro"], aplicar: true, ideasEnTurno: 0, contarIdeas: () => 0 },
  { generosValidos: ["nino", "nina"], aplicar: true, ideasEnTurno: 0 },
] satisfies ContextoRespuesta[]) {
  const edad = sanearRespuestaGuiada(crudoEdad, contextoEdad);
  assert.equal(edad.texto, crudoEdad, `la pregunta de la edad queda intacta: ${edad.texto}`);
  assert.deepEqual(opcionesDe(edad.texto), ["1 a 3 años", "4 a 6 años", "7 a 12 años", "Adolescente", "Adulto"]);
  assert.equal(edad.opciones?.anadidas.length ?? 0, 0, "sin estilos añadidos");
  assert.ok(edad.opciones?.evaluadas.every((evaluada) => evaluada.tipo === "flujo" && evaluada.ideas === null), "las edades no se validan contra la biblioteca");
}
// Aunque la pregunta no diga «años», si las opciones son edades tampoco se rellena (y una que nombra algo no es «de estilo»).
const edadSinAnos = "¿Para quién es la fiesta? ¡Me encanta el motivo!\nOpciones: Bebé | 1 a 3 años | Adolescente | Adulto";
assert.equal(sanearRespuestaGuiada(edadSinAnos, cumple6).texto, edadSinAnos);
const edadPrincesa = "¿Cuántos años cumple la princesa de la casa?\nOpciones: 1 a 3 años | 4 a 6 años | 7 a 12 años";
assert.equal(sanearRespuestaGuiada(edadPrincesa, { ...cumple6, ideasEnTurno: 0 }).texto, edadPrincesa);
// Y una pregunta de estilo con opciones de flujo no pierde las de flujo en el recorte al rellenar.
const estiloConFlujo = validarOpcionesReales("¿Qué temática te gusta?\nOpciones: Videojuegos | Otra idea | Tengo una foto de inspiración | No sé todavía | Sorpréndeme", { evento: "cumpleaños", edad: 6 });
assert.ok(["Otra idea", CHIP_FOTO_GUIADA, "No sé todavía", "Sorpréndeme"].every((opcion) => opcionesDe(estiloConFlujo.texto).includes(opcion)), estiloConFlujo.texto);

// ── Lo que se transmite mientras el modelo escribe ya va saneado ─────────────────────────────────────────────────────
const filtro = new FiltroFlujoGuiado(() => babyShower(["nino", "nina"]));
const transmitido = ["No encontré ideas ex", "actas para un estilo neutro. ¿Te gustaría probar", " con beige o blanco?\n\nOpci", "ones: Beige | Blanco"].map((delta) => filtro.empujar(delta)).join("");
assert.ok(!/encontr|beige|opciones/i.test(transmitido), `Transmitido: ${JSON.stringify(transmitido)}`);
const filtroGenero = new FiltroFlujoGuiado(() => babyShower(["nino", "nina"]));
const transmitidoGenero = ["¡Qué bella ocasión! ¿El baby", " shower será para niño, niña o neutro?\n", "\nOpciones: Niño | Niña | Neutro"].map((delta) => filtroGenero.empujar(delta)).join("");
assert.equal(transmitidoGenero, "¡Qué bella ocasión! ¿El baby shower será para niño o niña?\n\n");

console.log("test-respuesta-guiada-sin-fracaso: ninguna opción, pregunta ni frase desemboca en «no encontré»; cada opción lleva a ideas reales.");
