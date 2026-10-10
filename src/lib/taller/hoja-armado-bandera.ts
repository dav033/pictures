import "server-only";
import { z } from "zod";
import { crearAjusteConCache, leerFilaAjuste, type ConsultaAjuste } from "@/lib/guiada-motor/bandera";
import { getRagPool } from "@/lib/rag/db";
import type { LecturaHojaArmado } from "./hoja-armado-bandera-tipos";

/**
 * La bandera de ejecución de la «Hoja de armado» del Taller 3D (PRO-01): si el botón sale en la lista de compra. **Apagada por
 * defecto.** Se lee como la de la guiada (`guiada-motor/bandera.ts`), de mayor a menor prioridad:
 *   1. fila `taller_hoja_armado` de `ajustes_runtime` (`activo`|`inactivo`), con un caché de 30 s por instancia;
 *   2. variable de entorno `TALLER_HOJA_ARMADO` (`activo`|`inactivo`);
 *   3. apagada.
 * Un valor fuera de esos se ignora y se pasa al siguiente. Sin `DATABASE_URL`, sin la tabla o con Neon caído (sin lectura buena
 * previa) decide la variable de entorno. Para encenderla en producción sin desplegar:
 *   INSERT INTO ajustes_runtime (clave, valor, actualizado_por) VALUES ('taller_hoja_armado', 'activo', 'dueño')
 *   ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now(), actualizado_por = EXCLUDED.actualizado_por;
 */

export const CLAVE_AJUSTE_HOJA_ARMADO = "taller_hoja_armado";

export type DependenciasHojaArmado = {
  /** Valor crudo de la fila, o `null` si no hay. LANZA si la base falló. */
  leerAjuste: () => Promise<string | null>;
  env: () => string | undefined;
  ahora: () => number;
};

/** Solo `activo` y `inactivo`: un valor inventado («true», «si») no enciende ni apaga nada por error. */
const EstadoSchema = z.enum(["activo", "inactivo"]);
function estadoValido(valor: string | null | undefined): boolean | null {
  const lectura = EstadoSchema.safeParse(valor?.trim().toLowerCase());
  return lectura.success ? lectura.data === "activo" : null;
}

export function crearLectorHojaArmado(deps: DependenciasHojaArmado): () => Promise<LecturaHojaArmado> {
  const ajusteVigente = crearAjusteConCache(deps.leerAjuste, deps.ahora);
  return async () => {
    const ajuste = estadoValido(await ajusteVigente());
    if (ajuste !== null) return { activa: ajuste, fuente: "ajuste" };
    const entorno = estadoValido(deps.env());
    if (entorno !== null) return { activa: entorno, fuente: "env" };
    return { activa: false, fuente: "defecto" };
  };
}

/** La fila `taller_hoja_armado`; un fallo de la base se avisa en el log como `[taller-hoja-armado]` y se lanza. */
export const leerFilaHojaArmado = (consultar: ConsultaAjuste): Promise<string | null> => leerFilaAjuste(consultar, CLAVE_AJUSTE_HOJA_ARMADO, "taller-hoja-armado");

export const leerHojaArmado = crearLectorHojaArmado({
  leerAjuste: async () => {
    if (!process.env.DATABASE_URL) return null;
    return leerFilaHojaArmado((sql, valores) => getRagPool().query<{ valor: string }>(sql, valores));
  },
  env: () => process.env.TALLER_HOJA_ARMADO,
  ahora: () => Date.now(),
});
