import type { HappiaConfig } from "./config";
import { envolturaErrorSchema, envolturaSchema, packageSchema, servicioSchema } from "./esquemas";
import type {
  HappiaConsultaPagina,
  HappiaPackage,
  HappiaPagina,
  HappiaServicio,
  ListarPackagesRespuesta,
} from "./tipos";
import { z } from "zod";

/** Largest `limit` each endpoint accepts (a larger one answers 400, it is not capped). */
// The guide raises /api/services to 500 (2026-10-14) but production Happia still answered 400 above 100 on 2026-10-15:
// one effective maximum until they confirm it is live (then change it here and nowhere else).
export const HAPPIA_LIMITE_MAXIMO = { services: 100, packages: 100 } as const;
const LIMITE_POR_DEFECTO = 50;
/**
 * Page size when reading a whole catalogue. The guide raises /api/services to 500 (2026-10-14) but production Happia
 * still answered 400 above 100 on 2026-10-15; 100 is accepted by both, so a deploy on their side changes nothing here.
 */
const LIMITE_LECTURA_COMPLETA = 100;
/** Bound for "read everything" so a misbehaving upstream can't loop forever: 25,000 items at 100 per page. */
const MAX_PAGINAS = 250;
/** Whole-catalogue deadline (each request still has its own 10 s one). */
const PLAZO_LECTURA_COMPLETA_MS = 25_000;
/** A catalogue that changes while it is read is read again this many times at most. */
const INTENTOS_LECTURA = 2;

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

type Recurso = keyof typeof HAPPIA_LIMITE_MAXIMO;

export class HappiaClient {
  constructor(private readonly config: HappiaConfig) {}

  /** Every package, reading all pages. Includes inactive packages and items: filter on `is_active`. */
  async listarPackages(signal?: AbortSignal, opciones: { city?: string } = {}): Promise<ListarPackagesRespuesta> {
    const packages = await this.leerTodo((consulta) => this.listarPackagesPagina(consulta), LIMITE_LECTURA_COMPLETA, signal, opciones.city);
    return { packages };
  }

  /** Every bookable service, optionally for one city slug. */
  listarServicios(opciones: { city?: string; signal?: AbortSignal } = {}): Promise<HappiaServicio[]> {
    return this.leerTodo(
      (consulta) => this.listarServiciosPagina(consulta),
      LIMITE_LECTURA_COMPLETA,
      opciones.signal,
      opciones.city,
    );
  }

  listarPackagesPagina(consulta: HappiaConsultaPagina = {}): Promise<HappiaPagina<HappiaPackage>> {
    return this.pagina("packages", packageSchema, consulta) as Promise<HappiaPagina<HappiaPackage>>;
  }

  listarServiciosPagina(consulta: HappiaConsultaPagina = {}): Promise<HappiaPagina<HappiaServicio>> {
    return this.pagina("services", servicioSchema, consulta) as Promise<HappiaPagina<HappiaServicio>>;
  }

  private async leerTodo<T extends { id: string }>(
    leer: (consulta: HappiaConsultaPagina) => Promise<HappiaPagina<T>>,
    limit: number,
    signal?: AbortSignal,
    city?: string,
  ): Promise<T[]> {
    const plazo = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(PLAZO_LECTURA_COMPLETA_MS)]);
    for (let intento = 1; ; intento += 1) {
      const resultado = await this.leerTodoUnaVez(leer, limit, plazo, city);
      if (resultado) return resultado;
      if (intento >= INTENTOS_LECTURA) {
        throw new HappiaApiError("El catálogo de Happia cambió mientras se leía", 502, null);
      }
    }
  }

  /** One pass over every page; `null` when the catalogue's size changed in between (the caller reads again). */
  private async leerTodoUnaVez<T extends { id: string }>(
    leer: (consulta: HappiaConsultaPagina) => Promise<HappiaPagina<T>>,
    limit: number,
    signal: AbortSignal,
    city?: string,
  ): Promise<T[] | null> {
    const porId = new Map<string, T>();
    let totalItems: number | undefined;
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const respuesta = await leer({ page, limit, city, signal });
      // A deleted item shifts the next page's first one onto this page and it would be missed: re-read instead.
      if (totalItems !== undefined && respuesta.pagination.totalItems !== totalItems) return null;
      totalItems = respuesta.pagination.totalItems;
      totalPages = respuesta.pagination.totalPages;
      // Fail on the first page, before paying for dozens of requests.
      if (totalPages > MAX_PAGINAS) {
        throw new HappiaApiError(`Happia API anunció más de ${MAX_PAGINAS} páginas`, 502, null);
      }
      // An inserted item repeats an id on the next page: keep the latest copy instead of duplicating.
      for (const item of respuesta.items) porId.set(item.id, item);
      page += 1;
    }
    return [...porId.values()];
  }

  private async pagina(recurso: Recurso, esquemaItem: z.ZodType, consulta: HappiaConsultaPagina) {
    const maximo = HAPPIA_LIMITE_MAXIMO[recurso];
    const page = consulta.page ?? 1;
    const limit = consulta.limit ?? LIMITE_POR_DEFECTO;
    if (!Number.isInteger(page) || page < 1) throw new RangeError("page debe ser un entero mayor o igual a 1");
    if (!Number.isInteger(limit) || limit < 1 || limit > maximo) {
      throw new RangeError(`limit debe ser un entero entre 1 y ${maximo}`);
    }

    const query = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (consulta.city) query.set("city", consulta.city);
    const datos = await this.solicitar(`/${recurso}?${query}`, consulta.signal);

    // Items are validated one by one: a single dirty record (inactive packages are the likeliest) must not take the
    // whole catalogue down, but a contract break that invalidates everything must still fail loudly.
    const envoltura = envolturaSchema(z.unknown()).parse(datos);
    if (envoltura.status !== "success" || !envoltura.data || !envoltura.pagination) {
      throw new HappiaApiError(`Happia API respondió sin éxito en /${recurso}`, 502, null);
    }
    const items: unknown[] = [];
    const invalidos: string[] = [];
    for (const crudo of envoltura.data) {
      const resultado = esquemaItem.safeParse(crudo);
      if (resultado.success) {
        items.push(resultado.data);
      } else {
        const id = typeof crudo === "object" && crudo !== null && "id" in crudo ? String(crudo.id).slice(0, 64) : "?";
        invalidos.push(`${id}@${resultado.error.issues[0]?.path.join(".") ?? ""}`);
      }
    }
    if (invalidos.length > 0) {
      // Ids and field paths only: never the provider's values.
      console.warn("happia-items-descartados", { recurso, descartados: invalidos.length, muestra: invalidos.slice(0, 5) });
      if (items.length === 0) {
        throw new HappiaApiError(`Happia API devolvió /${recurso} fuera del contrato documentado`, 502, null);
      }
    }
    return { items, pagination: envoltura.pagination };
  }

  private async solicitar(rutaYQuery: string, signal?: AbortSignal): Promise<unknown> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}${rutaYQuery}`;
    const respuesta = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": this.config.apiKey },
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)]),
    });

    const texto = await respuesta.text();
    const ruta = rutaYQuery.split("?")[0];
    if (!respuesta.ok) {
      // The error envelope carries a short Spanish message in `status`; any other body (HTML from a proxy, say) stays out of the error.
      let detalle = "";
      try {
        detalle = `: ${envolturaErrorSchema.parse(JSON.parse(texto)).status}`;
      } catch { /* not an envelope */ }
      throw new HappiaApiError(`Happia API respondió ${respuesta.status} en ${ruta}${detalle}`, respuesta.status, null);
    }

    return texto ? JSON.parse(texto) : null;
  }
}
