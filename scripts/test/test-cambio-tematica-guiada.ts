import { strict as assert } from "node:assert";
import { coloresTipicosDe, motivosNombrados } from "@/lib/biblioteca-sempertex/biblioteca";
import { detectarCambioTematica } from "@/lib/ia/guiado/cambio-tematica";
import { ideasGuiadas } from "@/lib/ia/guiado/ideas-guiadas";
import { FRASE_IDEAS_GUIADAS, fraseCercanasPorColor, fraseCercanasYaDicha, sanearRespuestaGuiada, type ContextoRespuesta } from "@/lib/ia/guiado/respuesta-guiada";

// Probador de la guiada (2026-10-06, guiada-20261006-224424-axytcg). Sin coste: no llama a ningún modelo.

// ── 2. Cambio de temática a mitad ────────────────────────────────────────────────────────────────────────────────────
const cambio = detectarCambioTematica({ ultimoUsuario: "mejor cambiemos, mi hijo ahora quiere dinosaurios", tematicaPrevia: "Spiderman" });
assert.ok(cambio, "«mejor cambiemos… dinosaurios» con brief de Spiderman es un cambio de temática");
assert.equal(cambio.nueva, "Dinosaurios");
assert.equal(cambio.anterior, "Spiderman");
assert.equal(cambio.grupo, "dinosaurio");
assert.equal(detectarCambioTematica({ ultimoUsuario: "y si mejor de princesas?", tematicaPrevia: "Dinosaurios" })?.nueva, "Princesas");
assert.equal(detectarCambioTematica({ ultimoUsuario: "Spiderman", tematicaPrevia: "dinosaurios" })?.nueva, "Spiderman", "solo el nombre de la nueva temática también cuenta");
assert.equal(detectarCambioTematica({ ultimoUsuario: "Propónme algo", tematicaPrevia: "Spiderman" }), null);
assert.equal(detectarCambioTematica({ ultimoUsuario: "le encanta spiderman", tematicaPrevia: undefined }), null, "sin brief previo no es un cambio (lo guarda el modelo)");
assert.equal(detectarCambioTematica({ ultimoUsuario: "sí, de dinosaurios, me encanta", tematicaPrevia: "Infantil de dinosaurios" }), null, "la misma temática no es un cambio");
assert.equal(detectarCambioTematica({ ultimoUsuario: "ponle un dinosaurio a la columna", tematicaPrevia: "Spiderman" }), null, "un adorno para una pieza no cambia la temática");
assert.equal(detectarCambioTematica({ ultimoUsuario: "cuánto me sale todo el plan con los globos que tiene ahora en total", tematicaPrevia: "Spiderman" }), null);
assert.deepEqual(motivosNombrados("le encanta el Hombre Araña").map((motivo) => motivo.grupo), ["hombre arana"]);

// La idea real que el probador nunca vio: con el brief nuevo sale primero.
const dinos = ideasGuiadas({ evento: "Cumpleaños", edad: 5, tematica: "Dinosaurios", ultimoUsuario: "mejor cambiemos, mi hijo ahora quiere dinosaurios" });
assert.equal(dinos.ideas[0]?.titulo, "Semiarco selvático de dinosaurios");
assert.equal(dinos.ideas[0]?.coincidencia, "exacta");

// ── 3. Temática sin decoración: cercanas por sus colores y una frase cálida ──────────────────────────────────────────
assert.deepEqual(coloresTipicosDe("Spiderman"), ["rojo", "azul", "negro"]);
assert.deepEqual(coloresTipicosDe("azul y plateado"), [], "una temática que ya es un color no lleva «en sus colores»");
const spider = ideasGuiadas({ evento: "Cumpleaños", edad: 5, tematica: "Spiderman", ultimoUsuario: "cumple 5 años mi hijo, le encanta spiderman" });
assert.ok(spider.ideas.length >= 4 && spider.ideas.every((idea) => idea.coincidencia === "cercana"), "no hay de Spiderman: todas son cercanas");
const primeras = spider.ideas.slice(0, 3).map((idea) => idea.titulo.toLocaleLowerCase("es"));
for (const color of ["rojo", "azul", "negro"]) assert.ok(primeras.some((titulo) => titulo.includes(color)), `las tres primeras muestran ${color}: ${primeras.join(" | ")}`);
assert.ok(!/rosa/.test(primeras.join(" ")), `nada rosa delante: ${primeras.join(" | ")}`);
assert.ok(!spider.ideas[0]!.titulo.includes("naranja"), "el arco naranja y negro ya no va primero");

const cercanas = { tematica: "Spiderman", colores: coloresTipicosDe("Spiderman") };
const frase = fraseCercanasPorColor(cercanas);
assert.equal(frase, "Todavía no tengo decoraciones de Spiderman, pero estas ideas en sus colores (rojo, azul y negro) te pueden servir. ¿Alguna te gusta?");
const contexto = (ideasEnTurno: number, aplicar = true): ContextoRespuesta => ({ evento: "Cumpleaños", edad: 5, generosValidos: ["nino", "nina"], aplicar, ideasEnTurno, cercanasPorColor: cercanas, contarIdeas: () => 2 });
// Con ideas cercanas a la vista: la frase reemplaza la presentación del modelo, una sola vez.
const conIdeas = sanearRespuestaGuiada(FRASE_IDEAS_GUIADAS, contexto(6));
assert.equal(conIdeas.texto, frase);
assert.equal(sanearRespuestaGuiada(`No encontré nada de Spiderman. ${FRASE_IDEAS_GUIADAS}`, contexto(6)).texto, frase, "sin «no encontré» del modelo");
assert.equal((conIdeas.texto.match(/Todavía no tengo/g) ?? []).length, 1);
// Con un plan a la vista (sin saneo) también va, si hay ideas en el turno.
assert.equal(sanearRespuestaGuiada("¡Claro! Mira estas ideas.", contexto(4, false)).texto, frase);
// Sin ideas mostradas, la frase NO está permitida: es un «no tengo» vacío y se sanea.
const sinIdeas = sanearRespuestaGuiada(frase, contexto(0));
assert.ok(!/todavía no tengo/i.test(sinIdeas.texto), sinIdeas.texto);
assert.ok(sinIdeas.huboFracaso);
// Una sola vez por temática en la conversación.
assert.equal(fraseCercanasYaDicha(["Hola", frase], "Spiderman"), true);
assert.equal(fraseCercanasYaDicha(["Hola"], "Spiderman"), false);

console.log("test-cambio-tematica-guiada: cambio de temática determinista; Spiderman en sus colores con una frase cálida");
