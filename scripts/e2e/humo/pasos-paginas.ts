import type { Entorno } from "./ejecutor";
import { irA } from "./navegacion";

export const PASO_CLASICA = "clásica: / con su chat";
export const PASO_CATALOGO = "catálogo: /catalogo lista productos";
export const PASO_MODULOS = "módulos: /3d/modulos";

export async function pasoVistaClasica(entorno: Entorno): Promise<string> {
  const pagina = await entorno.paginaNueva();
  await irA(pagina, entorno.config, "/");
  const entrada = pagina.getByRole("textbox").first();
  await entrada.waitFor();
  if (!(await entrada.isEnabled())) throw new Error("La entrada del chat clásico está deshabilitada");
  await pagina.getByTestId("conmutador-vista").waitFor();
  return "entrada del chat visible y habilitada";
}

export async function pasoCatalogo(entorno: Entorno): Promise<string> {
  const pagina = await entorno.paginaNueva();
  await irA(pagina, entorno.config, "/catalogo");
  await pagina.getByRole("heading", { name: "Catálogo" }).waitFor();
  const productos = pagina.locator('a[href^="/catalogo/"]');
  await productos.first().waitFor();
  const total = /(\d[\d.,]*)\s+productos/.exec(await pagina.locator("header").first().innerText());
  if (!total || Number(total[1]!.replace(/[.,]/g, "")) < 1) throw new Error(`El encabezado no declara productos (${total?.[0] ?? "sin texto «N productos»"})`);
  return `${await productos.count()} tarjetas en la página, ${total[0]} en el catálogo`;
}

/** Solo mira: en esta página «Render con IA» gasta, así que no se pulsa nada. */
export async function pasoModulos(entorno: Entorno): Promise<string> {
  const pagina = await entorno.paginaNueva();
  await irA(pagina, entorno.config, "/3d/modulos");
  await pagina.getByRole("heading", { name: "Estudio de módulos" }).waitFor();
  await pagina.getByRole("heading", { name: "Render con IA" }).waitFor();
  return "estudio de módulos renderizado";
}
