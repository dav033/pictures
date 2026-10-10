import type { Page } from "playwright";
import { PLAZOS } from "./configuracion";
import { PasoOmitido, type Entorno } from "./ejecutor";
import { esperarHidratacion, irA } from "./navegacion";

export const PASO_LOGIN = "login: sesión iniciada";
export const PASO_ATERRIZAJE = "login: aterriza en /asistente";
export const PASO_VISTA_GUIADA = "asistente: vista guiada y cabecera";
export const PASO_IDEAS = "asistente: ideas";
export const PASO_PRECIO = "asistente: cuánto cuesta";

/**
 * Un solo mensaje con evento, edad, temática y uso: el asistente responde con las ideas en un turno, y «Cuánto cuesta» ya no
 * pregunta el uso. Con los chips (evento → edad → temática) serían tres turnos de IA antes de ver una idea.
 */
const MENSAJE_INICIAL = "Cumpleaños de 7 años, tema dinosaurios, es para uso personal";
const FRASE_DE_COSTEO = "Quiero saber cuánto cuestan los materiales.";

type PasosDelAsistente = {
  login: () => Promise<string>;
  aterrizaje: () => Promise<string>;
  vistaGuiada: () => Promise<string>;
  ideas: () => Promise<string>;
  precio: () => Promise<string>;
};

async function pythonResponde(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return true;
  } catch {
    return false;
  }
}

type SaludDeLaIA = { predeterminado?: string };

/**
 * Los turnos del asistente llaman al proveedor de IA. Corren con la IA local (Claude CLI, US$0) o si se pidió expresamente con
 * `--con-chat`; contra cualquier otra IA de pago quedan fuera.
 */
async function comprobarQueSePuedeChatear(entorno: Entorno, pagina: Page): Promise<void> {
  const { esLocal, incluirChatEnRemoto, base } = entorno.config;
  if (incluirChatEnRemoto) return;
  if (!esLocal) throw new PasoOmitido(`${base} usa la IA de pago: los turnos de chat quedan fuera (pasa --con-chat para incluirlos)`);
  const respuesta = await pagina.request.get(`${base}/api/ia/salud`);
  const { predeterminado } = (respuesta.ok() ? await respuesta.json() : {}) as SaludDeLaIA;
  if (predeterminado !== "claude") {
    throw new PasoOmitido(`la IA predeterminada de ${base} es «${predeterminado ?? "desconocida"}», no la local de Claude sin costo (pasa --con-chat para gastar)`);
  }
}

/** Escribe la contraseña, entra y devuelve la ruta a la que la app lleva después del login. */
async function iniciarSesion(pagina: Page, contrasena: string): Promise<string> {
  await pagina.locator("#login-password").fill(contrasena);
  await pagina.getByRole("button", { name: "Entrar" }).click();
  const rechazo = pagina.getByRole("alert").filter({ hasText: "Contraseña incorrecta" });
  await Promise.race([
    pagina.waitForURL((url) => url.pathname !== "/login", { timeout: PLAZOS.navegacion }),
    rechazo.waitFor({ timeout: PLAZOS.navegacion }).then(() => { throw new Error("El sitio rechazó la contraseña (¿el APP_PASSWORD del entorno es el de esta base?)"); }),
  ]);
  return new URL(pagina.url()).pathname;
}

async function comprobarVistaGuiada(pagina: Page): Promise<void> {
  const conmutador = pagina.getByTestId("conmutador-vista");
  await conmutador.waitFor();
  await conmutador.getByRole("link", { name: "Clásica" }).waitFor();
  await conmutador.getByRole("link", { name: "Guiada" }).and(pagina.locator('[aria-current="page"]')).waitFor();
  await esperarHidratacion(pagina.getByTestId("menu-app"));
  await pagina.getByTestId("menu-app").click();
  await pagina.getByRole("menuitem", { name: "Explorar catálogo" }).waitFor();
  await pagina.keyboard.press("Escape");
}

async function comprobarPreguntaInicial(pagina: Page): Promise<number> {
  await pagina.getByText("¿Qué vas a celebrar?").first().waitFor();
  const eventos = ["Cumpleaños", "Baby shower", "Boda", "XV años"];
  for (const evento of eventos) await pagina.getByRole("button", { name: evento }).first().waitFor();
  return eventos.length;
}

async function esperarIdeas(pagina: Page): Promise<number> {
  const carrusel = pagina.getByTestId("carrusel-decoraciones");
  const fallo = pagina.locator('[role="alert"][data-variante]');
  await Promise.race([
    carrusel.waitFor({ timeout: PLAZOS.turnoDeChat }),
    fallo.waitFor({ timeout: PLAZOS.turnoDeChat }).then(async () => { throw new Error(`El asistente respondió con un aviso de error: ${(await fallo.first().innerText()).split("\n").join(" ")}`); }),
  ]);
  return pagina.locator("[data-decoracion-id]").count();
}

type EstadoDelCosteo = "precio" | "no-pude" | "pregunta-uso" | null;

/** Mira lo que sigue a la frase del costeo: el precio, un «no pude» claro, o la pregunta del uso que no debería volver. */
function estadoDelCosteo(frase: string): EstadoDelCosteo {
  const texto = document.body.innerText;
  const indice = texto.lastIndexOf(frase);
  if (indice < 0) return null;
  const resto = texto.slice(indice + frase.length);
  if (/\$\s?\d/.test(resto)) return "precio";
  if (/no pude/i.test(resto)) return "no-pude";
  if (/negocio o para uso personal/i.test(resto)) return "pregunta-uso";
  return null;
}

async function esperarCosteo(pagina: Page): Promise<{ estado: Exclude<EstadoDelCosteo, null>; resto: string }> {
  const manejador = await pagina.waitForFunction(estadoDelCosteo, FRASE_DE_COSTEO, { timeout: PLAZOS.turnoDeChat, polling: 500 });
  const estado = (await manejador.jsonValue()) as Exclude<EstadoDelCosteo, null>;
  const texto = await pagina.locator("body").innerText();
  return { estado, resto: texto.slice(texto.lastIndexOf(FRASE_DE_COSTEO) + FRASE_DE_COSTEO.length) };
}

function resumenDelPrecio(resto: string): string {
  const total = /Total con IVA\s*\$\s*([\d.,]+)/.exec(resto) ?? /suman\s*\$\s*([\d.,]+)/.exec(resto);
  return total ? `total $${total[1]}` : "hay un precio en pantalla";
}

export function crearPasosDelAsistente(entorno: Entorno): PasosDelAsistente {
  let paginaDeLogin: Page | null = null;
  let rutaTrasElLogin: string | null = null;
  let paginaDelAsistente: Page | null = null;

  return {
    login: async () => {
      const { config } = entorno;
      const pagina = await entorno.paginaNueva();
      paginaDeLogin = pagina;
      await irA(pagina, config, "/login");
      await pagina.locator("#login-password").waitFor();
      if (!config.contrasena) return "sin APP_PASSWORD en el entorno: se sigue sin iniciar sesión (sirve si el sitio no la pide)";
      rutaTrasElLogin = await iniciarSesion(pagina, config.contrasena);
      return `sesión iniciada con APP_PASSWORD; la app llevó a ${rutaTrasElLogin}`;
    },
    aterrizaje: async () => {
      if (rutaTrasElLogin === null) throw new PasoOmitido("no hubo inicio de sesión que mida el destino (falta APP_PASSWORD)");
      if (rutaTrasElLogin !== "/asistente") throw new Error(`Tras iniciar sesión la app llevó a «${rutaTrasElLogin}» y no a «/asistente»`);
      return "el login lleva a /asistente";
    },
    vistaGuiada: async () => {
      if (!paginaDeLogin) throw new Error("no hay página de login abierta");
      entorno.usar(paginaDeLogin);
      await irA(paginaDeLogin, entorno.config, "/asistente");
      await comprobarVistaGuiada(paginaDeLogin);
      return "conmutador Clásica/Guiada y «Explorar catálogo» presentes";
    },
    ideas: async () => {
      const pagina = await entorno.paginaNueva();
      await comprobarQueSePuedeChatear(entorno, pagina);
      paginaDelAsistente = pagina;
      await irA(pagina, entorno.config, "/asistente");
      const chips = await comprobarPreguntaInicial(pagina);
      await esperarHidratacion(pagina.getByTestId("menu-app"));
      const caja = pagina.getByRole("textbox").first();
      await caja.fill(MENSAJE_INICIAL);
      await caja.press("Enter");
      const ideas = await esperarIdeas(pagina);
      if (ideas < 1) throw new Error("El carrusel apareció sin ninguna idea");
      return `${chips} chips de evento, ${ideas} ideas`;
    },
    precio: async () => {
      const pagina = paginaDelAsistente;
      if (!pagina) throw new Error("no hay página del asistente abierta");
      entorno.usar(pagina);
      const { esLocal, urlPython } = entorno.config;
      if (esLocal && !(await pythonResponde(urlPython))) throw new PasoOmitido(`Python (${urlPython}) no responde: sin él no hay precio que comprobar`);
      await pagina.getByRole("button", { name: "Me gusta esta" }).first().click();
      await pagina.getByRole("group", { name: "Qué quieres hacer" }).getByRole("button", { name: /Cuánto cuesta/ }).click();
      const { estado, resto } = await esperarCosteo(pagina);
      if (estado === "pregunta-uso") throw new Error("«Cuánto cuesta» volvió a preguntar el uso aunque el mensaje inicial ya lo decía");
      return estado === "precio" ? resumenDelPrecio(resto) : "sin precio, con un «no pude» claro en pantalla";
    },
  };
}
