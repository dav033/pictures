import { crearAjusteConCache, leerAjusteNeon } from "@/lib/ajustes/ajustes-runtime";

/**
 * La interfaz del Taller «Añadir» por repositorio (REQ-013 fase 5): si el panel ofrece Sempertex / Mobiliario / Escenografía por
 * separado. **Encendida por defecto** (beta, D-039: todo encendido para todos); «apagada» existe solo como marcha atrás, que deja
 * el panel idéntico al de antes. De mayor a menor prioridad, como los demás ajustes de ejecución (`ajustes/ajustes-runtime.ts`):
 *   1. la fila `catalogo_ui_repositorios` de `ajustes_runtime`, con un caché de 30 s por instancia;
 *   2. la variable `CATALOGO_UI_REPOSITORIOS`;
 *   3. encendida.
 * Para volver al panel de antes sin desplegar:
 *   INSERT INTO ajustes_runtime (clave, valor, actualizado_por) VALUES ('catalogo_ui_repositorios', 'inactivo', 'dueño')
 *   ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now(), actualizado_por = EXCLUDED.actualizado_por;
 * y para quitar la marcha atrás: DELETE FROM ajustes_runtime WHERE clave = 'catalogo_ui_repositorios';
 *
 * A diferencia de las banderas que nacen apagadas, aquí un valor que no se entiende NO enciende nada: la marcha atrás es lo que
 * se escribe con prisa y que «desactivado» no apague el panel sería lo peor, así que un valor no vacío que no es uno de los de
 * encendido cuenta como APAGADO (el panel de siempre, que es el estado conocido y seguro) y se avisa como error en el log, una vez.
 * Se aceptan los dos vocabularios del proyecto (`activo`/`inactivo`, `true`/`false`, `on`/`off`, `1`/`0`) y sus variantes
 * habituales. Vacío = sin configurar.
 */

export const CLAVE_AJUSTE_UI_REPOSITORIOS = "catalogo_ui_repositorios";
export const VARIABLE_UI_REPOSITORIOS = "CATALOGO_UI_REPOSITORIOS";
const ORIGEN_AVISO = "catalogo-ui";

export type LecturaUiRepositorios = { activa: boolean; fuente: "ajuste" | "env" | "defecto" };

const ENCENDIDO = new Set(["activo", "activa", "true", "on", "1", "si", "sí", "yes", "enabled", "encendido", "encendida"]);
const APAGADO = new Set(["inactivo", "inactiva", "inactive", "false", "off", "0", "no", "disabled", "apagado", "apagada", "desactivado", "desactivada"]);

const avisados = new Set<string>();
function avisarUnaVez(mensaje: string): void {
  if (avisados.has(mensaje)) return;
  avisados.add(mensaje);
  console.error(`[${ORIGEN_AVISO}] ${mensaje}`);
}

/**
 * `true` si el valor es uno de los de encendido; `false` para cualquier otro no vacío (los de apagado y, avisado, los que no se
 * entienden); `null` si no hay valor, y entonces vale el siguiente nivel.
 */
export function estadoDeUi(crudo: string | null | undefined, origen: string): boolean | null {
  const valor = (crudo ?? "").trim().toLowerCase();
  if (!valor) return null;
  if (ENCENDIDO.has(valor)) return true;
  if (!APAGADO.has(valor)) avisarUnaVez(`${origen} = «${crudo}» no se entiende (activo|inactivo, true|false, on|off, 1|0): se toma como APAGADO, el panel de siempre.`);
  return false;
}

export type DependenciasUiRepositorios = {
  /** El valor crudo de la fila, `null` si no hay. LANZA si la base falló. */
  leerAjuste: () => Promise<string | null>;
  env: () => string | undefined;
  ahora: () => number;
};

export function crearLectorUiRepositorios(deps: DependenciasUiRepositorios): () => Promise<LecturaUiRepositorios> {
  const ajusteVigente = crearAjusteConCache(deps.leerAjuste, deps.ahora, { etiqueta: CLAVE_AJUSTE_UI_REPOSITORIOS });
  return async () => {
    const ajuste = estadoDeUi(await ajusteVigente(), `${CLAVE_AJUSTE_UI_REPOSITORIOS} (ajustes_runtime)`);
    if (ajuste !== null) return { activa: ajuste, fuente: "ajuste" };
    const entorno = estadoDeUi(deps.env(), VARIABLE_UI_REPOSITORIOS);
    if (entorno !== null) return { activa: entorno, fuente: "env" };
    return { activa: true, fuente: "defecto" };
  };
}

export const leerUiRepositorios = crearLectorUiRepositorios({
  leerAjuste: () => leerAjusteNeon(CLAVE_AJUSTE_UI_REPOSITORIOS, ORIGEN_AVISO),
  env: () => process.env[VARIABLE_UI_REPOSITORIOS],
  ahora: () => Date.now(),
});
