import type { HappiaConfig } from "./config";
import type { ListarPackagesRespuesta } from "./tipos";
import { z } from "zod";

const packageItemSchema = z.object({
  id: z.string().min(1),
  total: z.number().finite().nonnegative(),
  is_active: z.boolean(),
  package_id: z.string().min(1),
  charge_type: z.string(),
  description: z.string(),
  suggested_start_time: z.string().nullable(),
  provider_name: z.string().nullable(),
  category_name: z.string().nullable(),
}).passthrough();

const packageSchema = z.object({
  id: z.string().min(1),
  event_type_id: z.string().min(1),
  name: z.string().min(1),
  base_guests: z.number().int().positive(),
  standard_duration_minutes: z.number().int().positive().nullable(),
  conditions: z.string().nullable(),
  restrictions: z.string().nullable(),
  is_active: z.boolean(),
  is_featured: z.boolean(),
  package_items: z.array(packageItemSchema),
}).passthrough();

const listarPackagesSchema = z.object({ packages: z.array(packageSchema) }).passthrough();

export class HappiaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "HappiaApiError";
  }
}

export class HappiaClient {
  constructor(private readonly config: HappiaConfig) {}

  async listarPackages(signal?: AbortSignal): Promise<ListarPackagesRespuesta> {
    const datos = await this.solicitar("/packages", { signal });
    return listarPackagesSchema.parse(datos) as ListarPackagesRespuesta;
  }

  private async solicitar(
    ruta: string,
    opciones: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}${ruta}`;
    const respuesta = await fetch(url, {
      method: opciones.method ?? "GET",
      headers: {
        "x-api-key": this.config.apiKey,
        "content-type": "application/json",
      },
      body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
      signal: AbortSignal.any([...(opciones.signal ? [opciones.signal] : []), AbortSignal.timeout(10_000)]),
    });

    const texto = await respuesta.text();
    if (!respuesta.ok) {
      throw new HappiaApiError(
        `Happia API respondió ${respuesta.status} en ${ruta}`,
        respuesta.status,
        null,
      );
    }

    return texto ? JSON.parse(texto) : null;
  }
}
