import type { Locator, Page } from "playwright";
import { PLAZOS } from "./configuracion";
import { PasoOmitido, type Entorno } from "./ejecutor";
import { esperarHidratacion, irA } from "./navegacion";
import type { IdeaCotizada } from "./pasos-asistente";

export const PASO_PARIDAD = "paridad de precio: «Cuánto cuesta» del asistente = «Precio en la tienda» del Taller";

const GRUPO = "Ideas del asistente";
const BOTON_DE_LISTA = /Lista de compra\s*·\s*[1-9]\d*\s*globos/;

const enPesos = (texto: string): number => Number(texto.replace(/\D/g, ""));
const comoPesos = (valor: number): string => `$${valor.toLocaleString("es-CO")}`;

/** Abre /3d en «Añadir → Ideas»; el grupo se busca después, porque un despliegue anterior a D-038 no lo trae. */
async function abrirIdeasDelTaller(entorno: Entorno): Promise<Page> {
  const pagina = await entorno.paginaNueva();
  await irA(pagina, entorno.config, "/3d");
  const riel = pagina.getByRole("navigation", { name: "Paneles" }).getByRole("button", { name: "Añadir", exact: true });
  await esperarHidratacion(riel);
  if ((await riel.getAttribute("aria-pressed")) !== "true") await riel.click();
  await pagina.locator("#anadir-buscar").waitFor();
  await pagina.getByRole("tab", { name: "Ideas", exact: true }).click();
  return pagina;
}

const grupoDeIdeas = (pagina: Page): Locator => pagina.getByRole("region", { name: GRUPO });

/** La tarjeta de una idea por su id de la biblioteca guiada: en el Taller es `asistente:<id>` (`data-item-id`), nunca por su título. */
const tarjetaDeLaIdea = (pagina: Page, ideaId: string): Locator => grupoDeIdeas(pagina).locator(`li[data-item-id="asistente:${ideaId}"] > button`);

/** El grupo muestra de a 24 y «Mostrar más» se activa al llegar a la vista: se baja hasta que la tarjeta esté (o no haya más páginas). */
async function llegarALaTarjeta(pagina: Page, tarjeta: Locator): Promise<boolean> {
  const limite = Date.now() + 10_000;
  while (Date.now() < limite) {
    if ((await tarjeta.count()) > 0) return true;
    const mas = grupoDeIdeas(pagina).getByRole("button", { name: /^Mostrar más/ });
    if ((await mas.count()) === 0) break;
    await mas.scrollIntoViewIfNeeded().catch(() => undefined);
    await pagina.waitForTimeout(250);
  }
  return (await tarjeta.count()) > 0;
}

/** Abre la idea (su tarjeta del grupo) en la escena del Taller («Abrir en Escena»), pide «Precio en la tienda» y devuelve su total. */
async function cotizarEnElTaller(pagina: Page, tarjeta: Locator): Promise<number> {
  await tarjeta.first().click();
  const abrir = pagina.getByRole("button", { name: "Abrir en Escena" });
  await abrir.waitFor({ timeout: PLAZOS.navegacion });
  // La ficha arma la idea fuera de la página: el botón se habilita cuando ya la tiene completa.
  await pagina.waitForFunction(() => [...document.querySelectorAll("button")].some((boton) => boton.textContent?.trim() === "Abrir en Escena" && !boton.disabled), undefined, { timeout: PLAZOS.navegacion });
  await abrir.click();
  await pagina.getByRole("button", { name: BOTON_DE_LISTA }).click();
  const precio = pagina.locator("dialog[open]").getByRole("region", { name: "Precio en la tienda" });
  await precio.getByRole("button", { name: "Cotizar en la tienda" }).click();
  const total = precio.locator("p", { hasText: "Total:" });
  await total.waitFor({ timeout: PLAZOS.turnoDeChat });
  const texto = await total.innerText();
  if (/vuelve a cotizar/.test(texto)) throw new Error(`el «Precio en la tienda» quedó viejo: ${texto}`);
  return enPesos(texto.split("Total:")[1] ?? "");
}

/**
 * D-038: el total de «Cuánto cuesta» que el asistente dio para una idea (`ideaCotizada`, lo que costeó el paso del asistente) es el
 * «Precio en la tienda» de esa misma idea abierta desde «Añadir → Ideas → Ideas del asistente» en /3d. No gasta turnos de chat
 * propios: usa los del paso del asistente (el tope de la guardia sigue en 2).
 */
export function crearPasoDeParidad(entorno: Entorno, ideaCotizada: () => IdeaCotizada | null): () => Promise<string> {
  return async () => {
    const delAsistente = ideaCotizada();
    if (!delAsistente) throw new PasoOmitido("el asistente no dio un total de «Cuánto cuesta» que comparar");
    const taller = await abrirIdeasDelTaller(entorno);
    const hayGrupo = await grupoDeIdeas(taller).waitFor({ timeout: 5_000 }).then(() => true, () => false);
    if (!hayGrupo) throw new PasoOmitido(`«Añadir → Ideas» no trae el grupo «${GRUPO}» en ${entorno.config.base}: es anterior a esa función (D-038)`);
    const tarjeta = tarjetaDeLaIdea(taller, delAsistente.id);
    if (!(await llegarALaTarjeta(taller, tarjeta))) throw new PasoOmitido(`«${delAsistente.titulo}» (${delAsistente.id}) no está en «${GRUPO}»: su precio sale de una lista curada (una idea sin plan guardado) y el Taller no la arma`);
    const delTaller = await cotizarEnElTaller(taller, tarjeta);
    if (delTaller !== delAsistente.total) throw new Error(`«${delAsistente.titulo}»: el asistente dice ${comoPesos(delAsistente.total)} y el «Precio en la tienda» del Taller ${comoPesos(delTaller)}`);
    return `«${delAsistente.titulo}»: ${comoPesos(delTaller)} en el asistente y en el Taller`;
  };
}
