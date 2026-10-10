import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { armarEscena, type Escena } from "@/lib/globos3d/escena";
import { BIBLIOTECA_FABRICA, escenaDeItem } from "@/lib/globos3d/biblioteca";
import { ESCENAS_PREDEFINIDAS } from "@/lib/globos3d/escenas-presets";
import { hojaDeEscena, paginasDeHoja } from "@/lib/globos3d/hoja-armado";
import { HojaArmadoPagina } from "./HojaArmadoPagina";

/** Escenas que se pintan: los presets, las que más páginas daban antes de agrupar y una de cada cuatro del resto de la biblioteca. */
const SIEMPRE = new Set(["idea:mural-neon", "idea:bonsai-cerezo", "idea:love", "idea:arco-regalitos-fucsia", "idea:columna-foil-luna", "idea:ocasiones-especiales-paleta-neutral", "idea:aurora-mist-nacional-2025"]);

function escenasAPintar(): Array<{ id: string; nombre: string; escena: Escena }> {
  const salida: Array<{ id: string; nombre: string; escena: Escena }> = [];
  BIBLIOTECA_FABRICA.filter((i) => i.contenido.tipo === "escena" || i.contenido.tipo === "conjunto").forEach((item, k) => {
    if (SIEMPRE.has(item.id) || k % 4 === 0) salida.push({ id: item.id, nombre: item.nombre ?? item.id, escena: escenaDeItem(item) });
  });
  for (const p of ESCENAS_PREDEFINIDAS) salida.push({ id: `preset:${p.id}`, nombre: p.nombre, escena: p.escena });
  return salida;
}

/** El texto de todas las páginas de la hoja de una idea, sin etiquetas. */
function textoDeLaHoja(id: string): string {
  const item = BIBLIOTECA_FABRICA.find((i) => i.id === id)!;
  const escena = escenaDeItem(item);
  const hoja = hojaDeEscena(item.nombre ?? id, escena, armarEscena(escena));
  const paginas = paginasDeHoja(hoja);
  return paginas.map((pagina) => renderToStaticMarkup(createElement(HojaArmadoPagina, { pagina, total: paginas.length, segundosBomba: hoja.segundosBomba }))).join(" ").replace(/<[^>]+>/g, "");
}

test("la hoja imprime lo que el motor sabe de cada globo: helio, impreso, flores, relleno y el sentido de la numeración", () => {
  assert.match(textoDeLaHoja("idea:olla-embrujada"), /R-12 Fashion Negro a 28 cm · de helio/);
  const teAmo = textoDeLaHoja("idea:bouquet-te-amo");
  assert.match(teAmo, /impreso «GLOBO REDONDO INFINITY® I LOVE YOU MODERNO/);
  assert.match(teAmo, /impreso «GLOBO REDONDO INFINITY® LOVE FASHION SURTIDO/);
  assert.match(teAmo, /Relleno: confeti de papel, \d+ papelitos/);
  assert.match(textoDeLaHoja("idea:columna-organica"), /Flores: \d+ \(/);
  assert.match(textoDeLaHoja("idea:arco-primera-comunion"), /4 con impreso/);
  assert.match(textoDeLaHoja("idea:fantasia-metalizada"), /numerados en sentido antihorario/);
});

test("cada página de la hoja se pinta completa: sin NaN ni undefined, con su número y sin fijar el papel", () => {
  const escenas = escenasAPintar();
  assert.ok(escenas.length > 80, `${escenas.length} escenas`);
  let conDibujo = 0, conTabla = 0, conCompacta = 0;
  for (const { id, nombre, escena } of escenas) {
    const hoja = hojaDeEscena(nombre, escena, armarEscena(escena));
    const paginas = paginasDeHoja(hoja);
    for (const pagina of paginas) {
      const html = renderToStaticMarkup(createElement(HojaArmadoPagina, { pagina, total: paginas.length, segundosBomba: hoja.segundosBomba }));
      const texto = html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ");
      assert.ok(!/NaN|undefined|\[object/.test(texto) && !/NaN/.test(html), `${id}, página ${pagina.numero}: texto roto`);
      assert.ok(texto.includes(`Página ${pagina.numero} de ${paginas.length}`), `${id}: falta el número de página`);
      assert.ok(!/@page|size:\s*A4/i.test(html), `${id}: fija el papel`);
      if (html.includes("<svg")) conDibujo += 1;
      if (html.includes("Por color")) conTabla += 1;
      if (html.includes("Piezas pequeñas, tubos y links")) conCompacta += 1;
    }
  }
  assert.ok(conDibujo > 20 && conTabla > 20 && conCompacta > 10, `dibujos ${conDibujo}, tablas ${conTabla}, compactas ${conCompacta}`);
});
