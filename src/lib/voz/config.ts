export type ConfigVoz = {
  /** `VOZ_ENABLED=true` (apagado por defecto: el dueño lo enciende cuando lo pruebe). */
  habilitada: boolean;
  /** Base del servicio de transcripción en el VPS, sin barra final. Solo servidor. */
  url: string | null;
  /** Secreto compartido para firmar los pedidos al VPS. Solo servidor: nunca viaja al navegador. */
  secreto: string | null;
};

const ES_VERDADERO = /^(1|true|yes|si|sí|on)$/i;

export function leerConfigVoz(env: Record<string, string | undefined> = process.env): ConfigVoz {
  const url = env.VOZ_URL?.trim().replace(/\/+$/, "") || null;
  const secreto = env.VOZ_SECRETO?.trim() || null;
  return { habilitada: ES_VERDADERO.test(env.VOZ_ENABLED?.trim() ?? ""), url, secreto };
}
