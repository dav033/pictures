/**
 * Light/dark theme preference of the browser (iteration 4).
 *
 * Without an explicit choice the app follows the operating system through
 * `prefers-color-scheme` and `<html>` carries no `data-theme`. Once the user
 * flips the sun/moon switch, the choice is stored in localStorage and written
 * to `<html data-theme="light|dark">`; globals.css applies the dark tokens
 * for `[data-theme="dark"]` and for the media query when nothing was chosen.
 *
 * This is a presentation preference only: it never reaches the server.
 */
export type TemaElegido = "light" | "dark";
export type PreferenciaTema = TemaElegido | "sistema";

export const CLAVE_TEMA = "demo-decoracion:tema";
export const EVENTO_CAMBIO_TEMA = "demo-decoracion:tema-cambio";

/** Stored value → preference. Anything but "light"/"dark" means "follow the system". */
export function interpretarPreferenciaTema(valor: string | null | undefined): PreferenciaTema {
  return valor === "light" || valor === "dark" ? valor : "sistema";
}

/** Theme actually painted for a preference and the system's current scheme. */
export function resolverTema(preferencia: PreferenciaTema, sistemaOscuro: boolean): TemaElegido {
  if (preferencia === "sistema") return sistemaOscuro ? "dark" : "light";
  return preferencia;
}

/** Choices of the theme menu (D10): the quick switch stores light/dark; "Sistema" goes back to following the OS. */
export const OPCIONES_TEMA: ReadonlyArray<{ valor: PreferenciaTema; etiqueta: string }> = [
  { valor: "light", etiqueta: "Claro" },
  { valor: "dark", etiqueta: "Oscuro" },
  { valor: "sistema", etiqueta: "Sistema" },
];

/** The switch toggles against what is painted now, so one click always changes the look. */
export function siguienteTema(actual: TemaElegido): TemaElegido {
  return actual === "dark" ? "light" : "dark";
}

/**
 * Inline script for the root layout. It runs while the HTML is parsed, before
 * the first paint, so a stored dark choice never flashes the light theme.
 * Kept dependency-free and wrapped in try/catch (private mode can throw).
 */
export const SCRIPT_TEMA_ANTES_DE_PINTAR = `(function(){try{var t=localStorage.getItem(${JSON.stringify(CLAVE_TEMA)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
