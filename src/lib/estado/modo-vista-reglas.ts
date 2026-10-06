import type { ModoVista } from "./modo-vista";

/** El modal con el prompt técnico solo se abre automáticamente en modo dev. */
export function abrirPromptAutomaticamente(modo: ModoVista, hayPrompts: boolean): boolean {
  return modo === "dev" && hayPrompts;
}
