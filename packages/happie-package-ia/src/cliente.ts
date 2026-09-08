import type { HappiaConfig } from "./config";
import type { ListarPackagesRespuesta } from "./tipos";

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
    return this.solicitar("/packages", { signal }) as Promise<ListarPackagesRespuesta>;
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
