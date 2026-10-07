import { strict as assert } from "node:assert";
import { bibliotecaVisible, buscarDecoracionesSempertex, decoracionesSempertex, normalizarBusqueda, tematicasDisponibles } from "@/lib/biblioteca-sempertex/biblioteca";

// Dueño (2026-10-06): solo las decoraciones reales y solo las categorías que tienen al menos una.
assert.ok(bibliotecaVisible().length >= 20, "La biblioteca visible trae las decoraciones reales.");
assert.ok(bibliotecaVisible().every((decoracion) => decoracion.origen === "referencia_real"), "Ninguna decoración de ejemplo es visible.");
const tematicas = tematicasDisponibles();
assert.ok(tematicas.length > 0 && tematicas.every((tematica) => bibliotecaVisible().some((decoracion) => decoracion.tematica === tematica)), "Cada temática ofrecida tiene al menos una decoración.");
assert.ok(!tematicas.some((tematica) => /videojuego|superh|princesa|unicornio/i.test(tematica)), `Sin temáticas sin decoración: ${tematicas.join(" | ")}`);
assert.ok(tematicasDisponibles("boda").every((tematica) => tematicas.includes(tematica)), "Las temáticas de un evento son un subconjunto.");

const exactas: Array<[string, string, string]> = [
  ["cumpleaños", "6", "DINO"],
  ["cumpleaños", "6", "arcoíris"],
];
// Cuando la «temática» es el propio evento, basta con que salgan decoraciones de ese evento.
for (const [evento, edad, tematica, patron] of [["boda", 0, "matrimonio", /boda/i], ["XV años", 15, "quinceañera", /xv/i]] as const) {
  const ideas = buscarDecoracionesSempertex({ evento, edad, tematica });
  assert.ok(ideas.length >= 3 && ideas.slice(0, 2).every((idea) => idea.eventos.some((e) => patron.test(e))), `${evento}: primero decoraciones del evento (${ideas.map((idea) => idea.titulo).join(" | ")}).`);
}

for (const [evento, edad, tematica] of exactas) {
  const resultados = buscarDecoracionesSempertex({ evento, edad: Number(edad), tematica });
  assert.ok(resultados.length > 0, `Debe encontrar resultados para ${tematica}.`);
  assert.equal(resultados[0]?.coincidencia, "exacta", `La primera idea de ${tematica} debe ser exacta.`);
  const primeraCercana = resultados.findIndex((resultado) => resultado.coincidencia === "cercana");
  assert.ok(primeraCercana === -1 || resultados.slice(primeraCercana).every((resultado) => resultado.coincidencia === "cercana"), `Las exactas de ${tematica} van antes que las cercanas.`);
  assert.ok(resultados.length >= 3, `${tematica}: se completa hasta al menos 3 ideas (hay ${resultados.length}).`);
}

// Temáticas sin decoración propia: ideas reales parecidas por sus colores típicos, nunca un ejemplo.
const princesas = buscarDecoracionesSempertex({ evento: "cumpleaños", edad: 6, tematica: "princesas" });
assert.ok(princesas.length >= 3 && princesas.every((idea) => idea.origen === "referencia_real"), "Princesas: ideas reales.");
assert.ok(/rosa/i.test(princesas[0]?.titulo ?? ""), `Princesas: primero una idea rosa (${princesas.map((idea) => idea.titulo).join(" | ")}).`);
const videojuegos = buscarDecoracionesSempertex({ evento: "cumpleaños", edad: 8, tematica: "videojuegos" });
assert.ok(videojuegos.length >= 3 && videojuegos.every((idea) => idea.coincidencia === "cercana"), "Videojuegos: cercanas, sin inventar una exacta.");

const babyGirl = buscarDecoracionesSempertex({ evento: "baby shower", tematica: "niña" });
assert.equal(babyGirl[0]?.origen, "referencia_real");
assert.equal(babyGirl[0]?.coincidencia, "exacta");
const babyGirlConMensaje = buscarDecoracionesSempertex({ evento: "baby shower", tematica: "rosa Estoy organizando un baby shower para una niña" });
assert.equal(babyGirlConMensaje[0]?.coincidencia, "exacta", "La búsqueda debe aprovechar la temática explícita del mensaje original.");

const eleganteReal = buscarDecoracionesSempertex({ evento: "graduación", tematica: "elegante negro y dorado" });
assert.equal(eleganteReal[0]?.origen, "referencia_real");
assert.equal(eleganteReal[0]?.coincidencia, "exacta");

// Celebraciones fuera del catálogo: al menos 3 ideas y ninguna titulada «Cumpleaños…».
for (const consulta of [{ evento: "Fiesta de divorcio", tematica: "divertido, negro y fucsia" }, { evento: "divorcio", tematica: "divorcio" }, { evento: "Fiesta de carnaval", tematica: "carnaval neón" }, { evento: "carnaval", tematica: "neón, colores fluorescentes" }]) {
  const ideas = buscarDecoracionesSempertex(consulta);
  assert.ok(ideas.length >= 3, `${consulta.evento}: al menos 3 ideas (hay ${ideas.length}).`);
  assert.ok(ideas.every((idea) => !/^cumplea/i.test(idea.titulo) && !/cumplea(?:ñ|n)os$/i.test(idea.titulo)), `${consulta.evento}: ningún título de cumpleaños (${ideas.map((idea) => idea.titulo).join(" | ")}).`);
}
assert.ok(decoracionesSempertex.length >= bibliotecaVisible().length, "El catálogo completo conserva los ejemplos aunque no se muestren.");
// Títulos casi iguales salen una sola vez.
const graduacion = buscarDecoracionesSempertex({ evento: "graduación", tematica: "elegante blanco y negro" });
const comparables = graduacion.map((idea) => normalizarBusqueda(idea.titulo).split(" ").filter((palabra) => palabra !== "en" && palabra !== "de").join(" "));
assert.equal(new Set(comparables).size, comparables.length, `Sin títulos duplicados: ${graduacion.map((idea) => idea.titulo).join(" | ")}`);

console.log("test-busqueda-biblioteca-sempertex: solo decoraciones reales, temáticas con decoración, exactas y cercanas correctas.");
