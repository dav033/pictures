import type { Locator, Page } from "playwright";
import { PasoOmitido, type Entorno } from "./ejecutor";
import { esperarHidratacion, irA } from "./navegacion";

export const PASO_PLANTILLA = "taller 3D: abrir una plantilla";
export const PASO_LISTA = "taller 3D: lista de compra";
export const PASO_HOJA = "taller 3D: hoja de armado";
export const PASO_IMPRIMIR = "taller 3D: imprimir";
export const PASO_FOCO = "taller 3D: cerrar y devolver el foco";

type PasosDelTaller = {
  plantilla: () => Promise<string>;
  lista: () => Promise<string>;
  hoja: () => Promise<string>;
  imprimir: () => Promise<string>;
  foco: () => Promise<string>;
};

type VentanaConImpresion = { __impresiones: number };

type LecturaDeLaBandera = { activa: boolean; fuente?: string };

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
  };
}
