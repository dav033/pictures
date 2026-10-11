import type { Locator, Page } from "playwright";
import { PasoOmitido, type Entorno } from "./ejecutor";
import { esperarHidratacion, irA } from "./navegacion";

export const PASO_PLANTILLA = "taller 3D: abrir una plantilla";
export const PASO_LISTA = "taller 3D: lista de compra";
export const PASO_HOJA = "taller 3D: hoja de armado";
export const PASO_IMPRIMIR = "taller 3D: imprimir";
export const PASO_FOCO = "taller 3D: cerrar y devolver el foco";
export const PASO_REPOSITORIOS = "taller 3D: «Añadir» por repositorio";

type PasosDelTaller = {
  plantilla: () => Promise<string>;
  lista: () => Promise<string>;
  hoja: () => Promise<string>;
  imprimir: () => Promise<string>;
  foco: () => Promise<string>;
  repositorios: () => Promise<string>;
};

type VentanaConImpresion = { __impresiones: number };

type LecturaDeLaBandera = { activa: boolean; fuente?: string };

type LecturaDeRepositorios = { ui: boolean; repositorios: Array<{ id: string; visible: boolean }> };

/** `null` si la ruta no existe (un despliegue anterior a REQ-013 fase 5); falla con cualquier otro error HTTP. */
async function leerRepositorios(pagina: Page, base: string): Promise<LecturaDeRepositorios | null> {
  const respuesta = await pagina.request.get(`${base}/api/catalogo/repositorios`);
  if (respuesta.status() === 404) return null;
  if (!respuesta.ok()) throw new Error(`/api/catalogo/repositorios respondió HTTP ${respuesta.status()}`);
  return (await respuesta.json()) as LecturaDeRepositorios;
}

/** Los repositorios que el panel «Añadir» sabe pintar, con el nombre de su opción en el selector. */
const REPOSITORIOS_DEL_PANEL: ReadonlyArray<{ id: string; nombre: string }> = [
  { id: "sempertex", nombre: "Sempertex" }, { id: "mobiliario", nombre: "Mobiliario" }, { id: "escenografia", nombre: "Escenografía" },
];

const BOTON_DE_LISTA = /Lista de compra\s*·\s*[1-9]\d*\s*globos/;

/** `window.print()` abre un diálogo del sistema que cuelga el navegador: se cuenta la llamada y no se abre nada. */
async function sustituirImprimir(pagina: Page): Promise<void> {
  await pagina.addInitScript(() => {
    const ventana = window as unknown as VentanaConImpresion;
    ventana.__impresiones = 0;
    window.print = () => { ventana.__impresiones += 1; };
  });
}

function impresionesHechas(pagina: Page): Promise<number> {
  return pagina.evaluate(() => (window as unknown as VentanaConImpresion).__impresiones);
}

async function leerBandera(pagina: Page, base: string): Promise<LecturaDeLaBandera> {
  const respuesta = await pagina.request.get(`${base}/api/taller/hoja-armado`);
  if (!respuesta.ok()) throw new Error(`/api/taller/hoja-armado respondió HTTP ${respuesta.status()}`);
  return (await respuesta.json()) as LecturaDeLaBandera;
}

/** Solo la hoja visible al imprimir: todo lo demás de `<body>` queda oculto por las reglas `@media print`. */
function hijosVisiblesAlImprimir(pagina: Page): Promise<string[]> {
  return pagina.evaluate(() => [...document.body.children]
    .filter((elemento) => !elemento.classList.contains("hoja-armado-dialogo") && getComputedStyle(elemento).display !== "none")
    .map((elemento) => `${elemento.tagName.toLowerCase()}.${elemento.className}`.slice(0, 80)));
}

export function crearPasosDelTaller(entorno: Entorno): PasosDelTaller {
  let pagina: Page | null = null;
  let hojaAbierta = false;

  const paginaAbierta = (): Page => {
    if (!pagina) throw new Error("no hay página del taller abierta");
    entorno.usar(pagina);
    return pagina;
  };
  const dialogoDeLista = (p: Page): Locator => p.locator("dialog[open]");
  const botonDeHoja = (p: Page): Locator => dialogoDeLista(p).getByRole("button", { name: "Hoja de armado" });
  const hoja = (p: Page): Locator => p.getByRole("dialog", { name: "Hoja de armado" });
  const selectorDeRepositorio = (p: Page): Locator => p.getByRole("group", { name: "Repositorio" });
  const opcionDeRepositorio = (p: Page, nombre: string): Locator => selectorDeRepositorio(p).getByRole("button", { name: new RegExp(`^${nombre}\\b`) });

  return {
    plantilla: async () => {
      pagina = await entorno.paginaNueva();
      await sustituirImprimir(pagina);
      await irA(pagina, entorno.config, "/3d");
      const empezar = pagina.getByRole("button", { name: "Empezar de una plantilla" });
      await esperarHidratacion(empezar);
      await empezar.click();
      await pagina.getByRole("heading", { name: "Plantillas" }).waitFor();
      const tarjeta = pagina.locator("ul.grid > li > button[title]").first();
      await tarjeta.waitFor();
      const nombre = (await tarjeta.locator("span.line-clamp-2").innerText()).trim();
      await tarjeta.click();
      const boton = pagina.getByRole("button", { name: BOTON_DE_LISTA });
      await boton.waitFor();
      return `«${nombre}» → ${(await boton.innerText()).split("\n").join(" ")}`;
    },
    lista: async () => {
      const p = paginaAbierta();
      await p.getByRole("button", { name: BOTON_DE_LISTA }).click();
      const dialogo = dialogoDeLista(p);
      await dialogo.getByRole("button", { name: /Copiar la lista/ }).waitFor();
      const secciones = dialogo.locator('section[aria-label="Helio y cinta"], section[aria-label="Bomba"]');
      await secciones.first().waitFor();
      const encontradas = await secciones.evaluateAll((elementos) => elementos.map((elemento) => elemento.getAttribute("aria-label")));
      return `secciones: ${encontradas.join(", ")}`;
    },
    hoja: async () => {
      const p = paginaAbierta();
      const bandera = await leerBandera(p, entorno.config.base);
      if (!bandera.activa) throw new PasoOmitido(`la bandera TALLER_HOJA_ARMADO está apagada (fuente: ${bandera.fuente ?? "desconocida"}); en local, TALLER_HOJA_ARMADO=activo en .env.local`);
      await botonDeHoja(p).click();
      const dialogo = hoja(p);
      await dialogo.locator("[data-pagina]").first().waitFor();
      hojaAbierta = true;
      if ((await dialogoDeLista(p).count()) !== 0) throw new Error("La lista de compra sigue abierta como <dialog> modal: la hoja queda inerte");
      return `${await dialogo.locator("[data-pagina]").count()} páginas, bandera «${bandera.fuente ?? "?"}»`;
    },
    imprimir: async () => {
      const p = paginaAbierta();
      const dialogo = hoja(p);
      const imprimir = dialogo.getByRole("button", { name: "Imprimir" });
      if (await imprimir.evaluate((boton) => boton.closest("[inert]") !== null)) throw new Error("«Imprimir» está dentro de un elemento inerte");
      await imprimir.click({ timeout: 5_000 });
      const impresiones = await impresionesHechas(p);
      if (impresiones !== 1) throw new Error(`«Imprimir» recibió el clic pero window.print() se llamó ${impresiones} veces (se esperaba 1)`);
      await p.emulateMedia({ media: "print" });
      try {
        const sobrantes = await hijosVisiblesAlImprimir(p);
        if (sobrantes.length > 0) throw new Error(`Al imprimir quedan visibles otros elementos además de la hoja: ${sobrantes.join(", ")}`);
        if (!(await dialogo.isVisible())) throw new Error("Al imprimir la hoja deja de verse");
      } finally {
        await p.emulateMedia({ media: "screen" });
      }
      return "el clic llega, window.print() se llama una vez y al imprimir solo se ve la hoja";
    },
    foco: async () => {
      const p = paginaAbierta();
      if (hojaAbierta) {
        await hoja(p).getByRole("button", { name: "Cerrar hoja de armado" }).click();
        await botonDeHoja(p).waitFor();
        await p.waitForFunction(() => document.activeElement?.closest("dialog") != null);
        hojaAbierta = false;
      }
      await p.keyboard.press("Escape");
      await dialogoDeLista(p).waitFor({ state: "detached" });
      await p.waitForFunction(() => /^Lista de compra/.test(document.activeElement?.textContent?.trim() ?? ""));
      return "el foco vuelve al botón «Lista de compra»";
    },
    repositorios: async () => {
      const p = paginaAbierta();
      const lectura = await leerRepositorios(p, entorno.config.base);
      if (!lectura) throw new PasoOmitido("el selector de repositorio no está en este despliegue: /api/catalogo/repositorios no existe (es anterior a REQ-013 fase 5)");
      if (!lectura.ui) throw new PasoOmitido("el selector de repositorio no sale: la interfaz por repositorio está apagada (fila catalogo_ui_repositorios o variable CATALOGO_UI_REPOSITORIOS)");
      const visibles = new Set(lectura.repositorios.filter((repositorio) => repositorio.visible).map((repositorio) => repositorio.id));
      if (visibles.size < 2) throw new PasoOmitido("el Taller ve un solo repositorio (CATALOGO_REPOS_TALLER): no hay nada que elegir y el selector no sale");
      // Una lista de compra que otro paso dejó abierta (un <dialog> modal) vuelve inerte todo lo demás.
      if ((await dialogoDeLista(p).count()) > 0) { await p.keyboard.press("Escape"); await dialogoDeLista(p).waitFor({ state: "detached" }); }
      const riel = p.getByRole("navigation", { name: "Paneles" }).getByRole("button", { name: "Añadir", exact: true });
      if ((await riel.getAttribute("aria-pressed")) !== "true") await riel.click();
      await p.locator("#anadir-buscar").waitFor();
      const selector = selectorDeRepositorio(p);
      await selector.waitFor().catch(() => { throw new Error("/api/catalogo/repositorios dice ui: true pero «Añadir» no muestra el selector de repositorio"); });
      const nombres = await selector.getByRole("button").evaluateAll((botones) => botones.map((boton) => boton.querySelector("span")?.textContent ?? ""));
      const esperados = ["Todos", ...REPOSITORIOS_DEL_PANEL.filter(({ id }) => visibles.has(id)).map(({ nombre }) => nombre)];
      if (nombres.join("|") !== esperados.join("|")) throw new Error(`el selector de repositorio ofrece «${nombres.join(", ")}» y el Taller ve «${esperados.join(", ")}»`);

      const hechos: string[] = [];
      if (visibles.has("mobiliario")) {
        await opcionDeRepositorio(p, "Mobiliario").click();
        const mobiliario = p.getByRole("region", { name: "Mobiliario" });
        await mobiliario.waitFor();
        const muebles = await mobiliario.locator("button[title]").count();
        if (muebles < 20) throw new Error(`Mobiliario muestra ${muebles} tarjetas (se esperaban unas 27)`);
        await mobiliario.getByRole("button", { name: "Silla Tiffany" }).click();
        await mobiliario.getByRole("status").filter({ hasText: "Listo: «Silla Tiffany»" }).waitFor();
        hechos.push(`Mobiliario ${muebles} tarjetas (añadió «Silla Tiffany»)`);
      }
      if (visibles.has("escenografia")) {
        await opcionDeRepositorio(p, "Escenografía").click();
        const escenografia = p.getByRole("region", { name: "Escenografía" });
        await escenografia.waitFor();
        const fondos = await escenografia.locator("button[title]").count();
        if (fondos < 20) throw new Error(`Escenografía muestra ${fondos} tarjetas (se esperaban unas 25)`);
        hechos.push(`Escenografía ${fondos}`);
      }
      if (visibles.has("sempertex")) {
        await opcionDeRepositorio(p, "Sempertex").click();
        await p.getByRole("tablist", { name: "Qué añadir" }).waitFor();
        hechos.push("Sempertex con sus pestañas");
      }
      return `selector «${nombres.join(", ")}»; ${hechos.join(", ")}`;
    },
  };
}
