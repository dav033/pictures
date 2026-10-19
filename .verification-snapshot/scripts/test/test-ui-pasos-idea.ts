import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bibliotecaVisible } from "@/lib/biblioteca-sempertex/biblioteca";
import { GUIAS_ARMADO } from "@/lib/ia/guiado/guias-armado";
import { pasoParaCliente } from "@/lib/ia/guiado/pasos-cliente";
import { PasoAPaso } from "@/components/guiado/PasoAPaso";

/**
 * «Aprender a hacerlo» de las ideas reales: sin códigos de tamaño ni nombres internos, y las guías en «tú».
 * Sin red ni modelos: render estático de PasoAPaso con la biblioteca visible.
 */
const JERGA = [/\bR-?\d{1,2}\b/, /\bpatr[oó]n\b/i, /\bmotor\b/i, /\bSKU\b/i];

assert.equal(pasoParaCliente("Infla los globos R-12 con tamaño uniforme."), "Infla los globos de 12 pulgadas con tamaño uniforme.");
assert.equal(pasoParaCliente("Infla los globos R-5 y R-18 por separado."), "Infla los globos de 5 pulgadas y de 18 pulgadas por separado.");
assert.equal(pasoParaCliente("Distribuye los grupos por toda la estructura. Sigue el patrón espiral y alterna los colores según la foto."), "Distribuye los grupos por toda la estructura. Coloca los colores en espiral, como en la foto.");
assert.equal(pasoParaCliente("Sigue el patrón orgánico y alterna los colores según la foto."), "Reparte los colores de forma natural, como en la foto.");
assert.equal(pasoParaCliente("Infla los globos de 12 pulgadas."), "Infla los globos de 12 pulgadas.", "idempotente");

const ideas = bibliotecaVisible();
assert.ok(ideas.length > 0, "hay ideas visibles");
let pasosVistos = 0;
for (const idea of ideas) {
  const html = renderToStaticMarkup(createElement(PasoAPaso, { decoracion: idea }));
  const texto = html.replace(/<[^>]+>/g, " ").replaceAll("&quot;", "\"").replace(/\s+/g, " ");
  for (const jerga of JERGA) assert.equal(jerga.test(texto), false, `${idea.id}: el paso a paso muestra jerga ${jerga}: ${texto.match(jerga)?.[0]}`);
  if (idea.pasos.some((paso) => /\bR-12\b/.test(paso.texto))) assert.ok(texto.includes("globos de 12 pulgadas"), `${idea.id}: dice el tamaño en pulgadas`);
  pasosVistos += idea.pasos.length;
}

// Guías por estructura: imperativos en «tú» (antes «Doble la varilla … y una los tramos», «Clave la copa…»).
const textosGuias = GUIAS_ARMADO.flatMap((guia) => [guia.tiempo_aprox, ...guia.herramientas, ...guia.materiales_base, ...guia.pasos.flatMap((paso) => [paso.titulo, paso.detalle]), ...guia.reglas_aproximadas, ...guia.consejos, ...guia.errores_comunes]);
const USTED = /(?:^|[.:;]\s+|\by\s+)(?:Doble|Clave|Una|Coloque|Infle|Amarre|Pegue|Fije|Asegure|Revise|Corte|Mida|Arme|Monte|Ponga|Deje|Use|Repita|Añada|Ubique|Inserte|Retire|Sujete|Cuelgue|Calibre)\s+(?:la|el|los|las|cada|un|una|con|en)\b/;
for (const texto of textosGuias) assert.equal(USTED.test(texto), false, `imperativo en «usted»: ${texto}`);
assert.ok(textosGuias.some((texto) => texto.includes("Dobla la varilla") && texto.includes("une los tramos")));
assert.ok(textosGuias.some((texto) => texto.includes("Clava la copa")));
for (const texto of textosGuias) assert.equal(/\bpatr[oó]n(?:es)?\b/i.test(texto), false, `jerga «patrón» en la guía: ${texto}`);

console.log(`test-ui-pasos-idea: ${ideas.length} ideas reales y ${pasosVistos} pasos sin R-12 ni «patrón»; ${textosGuias.length} textos de guía en «tú»`);
