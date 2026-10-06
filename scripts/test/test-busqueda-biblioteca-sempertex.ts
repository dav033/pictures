import { strict as assert } from "node:assert";
import { buscarDecoracionesSempertex, decoracionesSempertex } from "@/lib/biblioteca-sempertex/biblioteca";

const exactas: Array<[string, string, string]> = [
  ["cumpleaños", "6", "castillo"],
  ["cumpleaños", "6", "DINO"],
  ["cumpleaños", "6", "superhéroe"],
  ["cumpleaños", "6", "arcoíris"],
  ["cumpleaños", "6", "estrellas"],
  ["cumpleaños", "6", "selva"],
  ["cumpleaños", "6", "fútbol"],
  ["boda", "0", "matrimonio"],
  ["XV años", "15", "quinceañera"],
  ["bautizo", "8", "comunión"],
];

for (const [evento, edad, tematica] of exactas) {
  const resultados = buscarDecoracionesSempertex({ evento, edad: Number(edad), tematica });
  assert.ok(resultados.length > 0, `Debe encontrar resultados para ${tematica}.`);
  assert.ok(resultados.every((resultado) => resultado.coincidencia === "exacta"), `Resultados de ${tematica} deben marcarse exactos.`);
}

const babyGirl = buscarDecoracionesSempertex({ evento: "baby shower", tematica: "niña" });
assert.equal(babyGirl[0]?.id, "ej-baby-nina");
assert.equal(babyGirl[0]?.coincidencia, "exacta");

const babyRosa = buscarDecoracionesSempertex({ evento: "baby shower", tematica: "rosa" });
assert.equal(babyRosa[0]?.id, "ej-baby-nina", "Preferir baby shower rosa para niña.");
assert.ok(!babyRosa.some((resultado) => resultado.id === "ej-boda-elegante"), "No ofrecer boda sin afinidad de evento ni de color.");
const babyGirlConMensaje = buscarDecoracionesSempertex({ evento: "baby shower", tematica: "rosa Estoy organizando un baby shower para una niña" });
assert.equal(babyGirlConMensaje.length, 1, "No mezclar opciones de niño ni neutras con una petición para niña.");
assert.equal(babyGirlConMensaje[0]?.id, "ej-baby-nina");
assert.equal(babyGirlConMensaje[0]?.coincidencia, "exacta", "La búsqueda debe aprovechar la temática explícita del mensaje original.");

const resultadoCercano = buscarDecoracionesSempertex(
  { evento: "cumpleaños", edad: 6, tematica: "princesas" },
  decoracionesSempertex.filter((decoracion) => decoracion.id === "ej-unicornio-arcoiris"),
);
assert.equal(resultadoCercano[0]?.coincidencia, "cercana");
assert.equal(resultadoCercano[0]?.id, "ej-unicornio-arcoiris");

const resultadoMixto = buscarDecoracionesSempertex({ evento: "cumpleaños", edad: 6, tematica: "princesa" });
assert.equal(resultadoMixto[0]?.id, "ej-princesas", "La temática exacta debe aparecer primero.");
assert.equal(resultadoMixto[0]?.coincidencia, "exacta");

console.log("test-busqueda-biblioteca-sempertex: sinónimos, edad, coincidencia exacta y cercana correctos.");
