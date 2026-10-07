import { strict as assert } from "node:assert";
import { tematicasDisponibles } from "@/lib/biblioteca-sempertex/biblioteca";
import { sanearOpcionesCatalogo } from "@/lib/ia/guiado/opciones-catalogo";

const tematicas = tematicasDisponibles();
const opcionesDe = (texto: string) => (texto.trimEnd().split("\n").at(-1) ?? "").replace(/^Opciones:\s*/, "").split(" | ");

// «Dorado y blanco» no existe en el catálogo: se quita; «Rosa y dorado» sí existe y se queda.
const mixto = opcionesDe(sanearOpcionesCatalogo("¿Qué colores te gustan?\nOpciones: Dorado y blanco | Rosa y dorado | Azul y plateado | Otra idea", tematicas));
assert.ok(!mixto.includes("Dorado y blanco"), `Sin «Dorado y blanco»: ${mixto.join(" | ")}`);
assert.ok(mixto.includes("Rosa y dorado") && mixto.includes("Azul y plateado") && mixto.includes("Otra idea"), mixto.join(" | "));

// Temáticas inventadas: se sustituyen por las del catálogo.
const inventadas = opcionesDe(sanearOpcionesCatalogo("¿Qué temática?\nOpciones: Videojuegos | Superhéroes | Princesas | Otra temática", tematicas));
assert.ok(!inventadas.some((opcion) => /videojuego|superh|princesa/i.test(opcion)), inventadas.join(" | "));
assert.ok(inventadas.filter((opcion) => tematicas.includes(opcion)).length >= 3 && inventadas.includes("Otra temática"), inventadas.join(" | "));

// Lo que no es estilo no se toca (edades, ciudades, eventos).
const edades = "¿Cuántos años cumple?\nOpciones: 1 a 3 años | 4 a 6 años | 7 a 12 años | Adulto";
assert.equal(sanearOpcionesCatalogo(edades, tematicas), edades);
const ciudades = "¿En qué ciudad estás?\nOpciones: Bogotá | Medellín | Cali | Otra ciudad";
assert.equal(sanearOpcionesCatalogo(ciudades, tematicas), ciudades);
assert.equal(sanearOpcionesCatalogo("Sin opciones aquí.", tematicas), "Sin opciones aquí.");
// Dinosaurios sí existe.
assert.ok(opcionesDe(sanearOpcionesCatalogo("¿Temática?\nOpciones: Dinosaurios | Infantil colorida", tematicas)).includes("Dinosaurios"));
console.log("test-opciones-catalogo-guiado: solo se ofrecen estilos con decoraciones; lo demás se conserva.");
