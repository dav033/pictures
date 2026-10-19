import { claveDeRetoma, guardarTokenDeRetoma, MAX_REINTENTOS_DE_RETOMA, PAUSA_ENTRE_RETOMAS_MS, soltarTokenDeRetoma, tokenDeRetoma } from "./retoma-kontext";
import { CABECERA_SOLICITUD_KONTEXT, CODIGO_SOLICITUD_KONTEXT_INVALIDA, KontextEnCursoSchema, MAX_REANUDACIONES_KONTEXT } from "./solicitud-kontext-contrato";

/**
 * POST a una ruta que paga una imagen de Kontext y retoma la solicitud si fal sigue generando al acabarse el plazo de la petición:
 * ante un 202 con token repite LA MISMA petición con `x-solicitud-kontext` (la ruta no envía otra ni gasta otro cupo). Devuelve la
 * respuesta final tal cual; si tras `MAX_REANUDACIONES_KONTEXT` retomas sigue en curso, o el 202 no trae token, un 504 con un mensaje que
 * la interfaz puede mostrar.
 *
 * Si una retoma falla por la red o por un 5xx se repite con el mismo token (hasta `MAX_REINTENTOS_DE_RETOMA` veces, con pausa) y, si no sale,
 * el token se conserva con su `clave`: el siguiente clic retoma la solicitud ya pagada en vez de enviar otra (`retoma-kontext.ts`).
 *
 * El token se guarda por ruta y por la huella del CUERPO (lugar, descripción, captura, aspecto): otra vista es otra clave y nunca recibe el token de
 * la anterior, y la ruta lo ata también a ese cuerpo. Persiste en `sessionStorage` (`retoma-kontext.ts`): si la pestaña se recarga durante la
 * espera, el siguiente clic retoma en vez de pagar otra imagen.
 *
 * Del navegador, sin dependencias de servidor; las pruebas inyectan `fetch` y la pausa. Evita `Response.json` estático (Safari antiguo).
 */
export type DependenciasPostReanudable = {
  fetch: (entrada: string, init?: RequestInit) => Promise<Response>;
  esperar: (ms: number) => Promise<void>;
};

const POR_DEFECTO: DependenciasPostReanudable = {
  fetch: (entrada, init) => fetch(entrada, init),
  esperar: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
};

const respuestaDeError = (mensaje: string, estado: number): Response =>
  new Response(JSON.stringify({ error: mensaje }), { status: estado, headers: { "Content-Type": "application/json" } });

async function codigoDe(respuesta: Response): Promise<string | undefined> {
  try { return ((await respuesta.clone().json()) as { codigo?: unknown }).codigo as string | undefined; } catch { return undefined; }
}

export async function postReanudable(ruta: string, cuerpo: string, dependencias: Partial<DependenciasPostReanudable> = {}): Promise<Response> {
  const dep = { ...POR_DEFECTO, ...dependencias };
  const clave = claveDeRetoma(ruta, cuerpo);
  let token = tokenDeRetoma(clave);
  let reanudaciones = 0;
  let reintentos = 0;
  for (;;) {
    let respuesta: Response;
    try {
      respuesta = await dep.fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { [CABECERA_SOLICITUD_KONTEXT]: token } : {}) }, body: cuerpo });
    } catch (causa) {
      // Un corte de red al retomar: la solicitud sigue viva y pagada, así que se repite con el mismo token; sin token no hay nada que retomar.
      if (token && reintentos < MAX_REINTENTOS_DE_RETOMA) { reintentos += 1; await dep.esperar(PAUSA_ENTRE_RETOMAS_MS); continue; }
      throw causa;
    }
    if (token && respuesta.status >= 500 && reintentos < MAX_REINTENTOS_DE_RETOMA) { reintentos += 1; await dep.esperar(PAUSA_ENTRE_RETOMAS_MS); continue; }
    if (token && respuesta.status === 409 && (await codigoDe(respuesta)) === CODIGO_SOLICITUD_KONTEXT_INVALIDA) {
      // El token venció o no es de esta petición: se pide una imagen nueva (la que el cliente quiere).
      soltarTokenDeRetoma(clave);
      token = undefined;
      continue;
    }
    if (respuesta.status !== 202) {
      if (respuesta.ok) soltarTokenDeRetoma(clave);
      return respuesta;
    }
    const enCurso = KontextEnCursoSchema.safeParse(await respuesta.json().catch(() => null));
    if (!enCurso.success) return respuestaDeError("La foto está tardando más de lo normal. Vuelve a intentarlo en un momento.", 504);
    token = enCurso.data.solicitud_kontext;
    guardarTokenDeRetoma(clave, token);
    if (reanudaciones >= MAX_REANUDACIONES_KONTEXT) return respuestaDeError("La foto está tardando más de lo normal. Vuelve a intentarlo en un momento: se retoma donde quedó.", 504);
    reanudaciones += 1;
    reintentos = 0;
    await dep.esperar(PAUSA_ENTRE_RETOMAS_MS);
  }
}
