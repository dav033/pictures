import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { decoracionesSempertex, proveedoresSempertex } from "@/lib/biblioteca-sempertex/biblioteca";
import { CarruselDecoraciones } from "@/components/guiado/CarruselDecoraciones";
import { AVISO_CONTADA_EN_FOTO, TarjetaEleccion } from "@/components/guiado/TarjetaEleccion";
import { TarjetasProveedores } from "@/components/guiado/TarjetasProveedores";

/**
 * Insignia «Ejemplo»: las tarjetas de IDEAS nunca la muestran (la guiada solo enseña decoraciones reales; aun si una
 * de ejemplo se colara, no se marca); las de PROVEEDORES la conservan como pastilla discreta (decisión del dueño:
 * el directorio es de muestra). Render estático, sin red.
 */
const deEjemplo = decoracionesSempertex.find((decoracion) => decoracion.origen === "ejemplo");
const real = decoracionesSempertex.find((decoracion) => decoracion.origen === "referencia_real");
assert.ok(deEjemplo && real, "la biblioteca tiene ideas de ejemplo y reales");
const nada = () => undefined;

const carrusel = renderToStaticMarkup(createElement(CarruselDecoraciones, { decoraciones: [real, deEjemplo], activo: true, elegidaId: null, onElegir: nada, onNinguna: nada }));
assert.equal(/Ejemplo|ilustrativas/.test(carrusel), false, "el carrusel de ideas no muestra «Ejemplo»");
const eleccion = renderToStaticMarkup(createElement(TarjetaEleccion, { decoracion: deEjemplo }));
assert.equal(eleccion.includes("Ejemplo"), false, "la tarjeta de la idea elegida no muestra «Ejemplo»");

const proveedor = proveedoresSempertex.find((item) => item.origen === "ejemplo");
assert.ok(proveedor, "el directorio de muestra tiene proveedores de ejemplo");
const proveedores = renderToStaticMarkup(createElement(TarjetasProveedores, { proveedores: [proveedor], activo: true, onSolicitar: nada }));
const pastilla = /<span class="([^"]*)">Ejemplo<\/span>/.exec(proveedores);
assert.ok(pastilla, "la tarjeta de proveedor conserva «Ejemplo»");
assert.ok(pastilla[1]!.includes("text-texto-suave") && !pastilla[1]!.includes("bg-acento"), `pastilla discreta, sin color de acento: ${pastilla[1]}`);

// «Tu elección» (con su detalle precalculado, detalles-ideas.json): globos Sempertex por producto; lo contado a mano en
// la foto se dice estimado con discreción; lo que resolvió el plan de Python, no.
const idea = (id: string) => decoracionesSempertex.find((decoracion) => decoracion.id === id)!;
const texto = (marcado: string) => marcado.replaceAll("&quot;", "\"");
const sombrero = texto(renderToStaticMarkup(createElement(TarjetaEleccion, { decoracion: idea("deco-real-23-sombrero-bruja-halloween") })));
assert.ok(sombrero.includes(">50<") && sombrero.includes("Reflex Champaña") && sombrero.includes("Cantidades estimadas a partir de la foto"), "sombrero de bruja: productos Sempertex, cantidades estimadas a partir de la foto");
const guirnalda = texto(renderToStaticMarkup(createElement(TarjetaEleccion, { decoracion: idea("deco-real-22-guirnalda-san-valentin") })));
assert.ok(guirnalda.includes(">31<") && guirnalda.includes("Fashion Rosa") && guirnalda.includes("Metalizado Love") && guirnalda.includes("Algunas cantidades, estimadas a partir de la foto"), "San Valentín: lo del plan y lo de la foto, con su aviso discreto");
// Una del script sin nada contado en la foto (todo lo resolvió Python, remates incluidos).
const delScript = texto(renderToStaticMarkup(createElement(TarjetaEleccion, { decoracion: idea("deco-real-08-images-23") })));
assert.ok(!delScript.includes("estimad") && !delScript.includes(AVISO_CONTADA_EN_FOTO) && delScript.includes("Fashion Negro") && delScript.includes("Metal Dorado"), "las del script (plan de Python) no se dicen estimadas");

console.log("test-ui-insignia-ejemplo: ideas sin «Ejemplo»; proveedores con pastilla discreta; cantidades de la foto con «≈»");
