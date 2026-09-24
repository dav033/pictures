/**
 * Doble de transporte del resolutor Python para las pruebas offline.
 *
 * Por qué existe. Media docena de scripts ejercitaba el camino de
 * `confirmar_plan_decoracion` poniendo `PYTHON_BACKEND_ENABLED=false` para que
 * el plan lo resolviera TypeScript dentro del propio proceso. El paso 5 del
 * ADR-0023 borró ese resolutor y con él la variable: hoy `resolverPlan` siempre
 * llama al servicio Python. Lo que esos scripts prueban no es el resolutor
 * —son la jerga del prompt, las restricciones, la cobertura de tamaños, el
 * brief y el contrato de eventos—, así que en vez de volverlos dependientes de
 * red y de un proceso levantado se les stubea `globalThis.fetch`, igual que ya
 * hacían `scripts/test/test-plan-editar-python.ts` y `scripts/test/test-catalog-allowlist.ts`.
 *
 * Qué NO es. No es una segunda implementación de las reglas de conteo: no
 * reparte por participación, no elige tamaños por mezcla, no calcula merma y no
 * decide qué tiene cobertura. Reparte una cantidad fija por material y arma con
 * ella un `plan-resolution-result.v1` coherente con sus propios totales, que es
 * lo único que el adaptador verifica en el límite. El veredicto que sí es del
 * resolutor —qué queda sin cobertura, qué colores se sustituyeron, si se pasa
 * del techo— lo declara cada prueba en `veredicto`, y el cerrojo de que Python
 * lo decide bien son los 28 vectores dorados y `test_plan_parity.py`.
 *
 * Módulo importable a propósito (AGENTS.md, "Keep scripts import-safe"): no hay
 * CLI ni efectos al cargar; `prepararEntornoPythonFalso` e
 * `instalarResolutorPythonFalso` los llama quien los necesita.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PlanResolutionResultV1Schema } from "@/lib/ia/contracts/domain-v1";
import { sustitucionesColorReferencia } from "@/lib/plan/colores-referencia";

/** Snapshot publicado que las pruebas fijan en `estado.ragCatalogSnapshotId`. */
export const SNAPSHOT_FALSO = "products_catalog:test";

/** Unidades que el doble le asigna a cada material de cada estructura. */
export const UNIDADES_POR_MATERIAL = 12;
const UNIDADES_PAQUETE = 50;
const PRECIO_PAQUETE = 12_000;
const DIAMETRO_PULGADAS = 12;
const MERMA_PORCENTAJE = 8;

export type LlamadaPython = { path: string; body: Record<string, unknown> };

export type ItemSinCobertura = { estructura_id: string; product_id: string; tamano: string };
export type SustitucionResuelta = { estructura_id: string; pedido: string; entregado: string; motivo: string };
export type EstadoComercial = { estado: "VERIFICADO" | "APROBACION_REQUERIDA" | "PRESUPUESTO_EXCEDIDO"; techo_cop?: number; delta_cop: number };

/**
 * Lo que la prueba declara que el resolutor decidió para ese plan. Todo es
 * opcional: sin veredicto el doble resuelve el plan entero sin incidencias.
 */
export type VeredictoResolucion = {
  sinCobertura?: ItemSinCobertura[];
  sustituciones?: SustitucionResuelta[];
  comercial?: EstadoComercial;
  /** Avisos del plan resuelto, incluido el prefijo `puerta_fisica:` de ADR-0023. */
  advertencias?: string[];
};

export type OpcionesResolutorFalso = {
  snapshot?: string;
  /** Foto de catálogo por `product_id`, como la trae Python en cada compra. */
  imagenes?: Readonly<Record<string, string>>;
  /** Veredicto por llamada (1-indexada), para las pruebas de convergencia. */
  veredicto?: (plan: PlanRecibido, llamada: number) => VeredictoResolucion;
  /** Respuesta para rutas distintas de `/internal/v1/plan/resolve`. */
  otrasRutas?: (llamada: LlamadaPython) => Response;
};

type Json = Record<string, unknown>;

/** Forma mínima del plan que el doble necesita leer del cuerpo de la petición. */
export type MaterialRecibido = {
  product_id: string;
  variant_id?: string;
  color?: string;
  acabado?: string;
};
export type EstructuraRecibida = {
  estructura_id: string;
  nombre: string;
  tipo: string;
  ubicacion: string;
  repeticiones?: number;
  mezcla?: string;
  colores_referencia?: string[];
  materiales: MaterialRecibido[];
};
export type PlanRecibido = { estructuras: EstructuraRecibida[] };

function esObjeto(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function texto(value: unknown, porDefecto: string): string {
  return typeof value === "string" && value.trim() ? value : porDefecto;
}

function planRecibido(body: Json): PlanRecibido {
  const plan = body.plan;
  assert.ok(esObjeto(plan), "el cuerpo de plan/resolve debe traer un plan");
  const estructuras = plan.estructuras;
  assert.ok(Array.isArray(estructuras), "el plan debe traer estructuras");
  return {
    estructuras: estructuras.filter(esObjeto).map((estructura) => {
      const materiales = Array.isArray(estructura.materiales) ? estructura.materiales.filter(esObjeto) : [];
      return {
        estructura_id: texto(estructura.estructura_id, "EST_00"),
        nombre: texto(estructura.nombre, "Pieza"),
        tipo: texto(estructura.tipo, "accesorio"),
        ubicacion: texto(estructura.ubicacion, "fondo_pared"),
        repeticiones: typeof estructura.repeticiones === "number" ? estructura.repeticiones : 1,
        mezcla: typeof estructura.mezcla === "string" ? estructura.mezcla : undefined,
        ...(Array.isArray(estructura.colores_referencia)
          ? { colores_referencia: estructura.colores_referencia.filter((color): color is string => typeof color === "string") }
          : {}),
        materiales: materiales.map((material) => ({
          product_id: texto(material.product_id, "prod-desconocido"),
          ...(typeof material.variant_id === "string" ? { variant_id: material.variant_id } : {}),
          ...(typeof material.color === "string" ? { color: material.color } : {}),
          ...(typeof material.acabado === "string" ? { acabado: material.acabado } : {}),
        })),
      };
    }),
  };
}

type LineaDoble = {
  estructura_id: string;
  product_id: string;
  variant_id: string;
  color: string | null;
  acabado: string | null;
  unidades: number;
};

/**
 * Arma el `plan-resolution-result.v1` que emitiría Python para ese plan, con el
 * veredicto que la prueba declaró. Los totales se derivan de las líneas del
 * propio doble, no de ninguna regla de negocio, y cuadran entre plan resuelto,
 * estimado y cotización porque el adaptador comprueba esa coherencia en el
 * límite (`planResolutionPayloadIsConsistent`).
 */
export function payloadResolucionFalso(
  plan: PlanRecibido,
  opciones: { snapshot: string; veredicto: VeredictoResolucion; planOriginal: unknown; imagenes?: Readonly<Record<string, string>> },
): Json {
  const { snapshot, veredicto } = opciones;
  const imagenes = opciones.imagenes ?? {};
  const sinCobertura = veredicto.sinCobertura ?? [];
  const excluido = new Set(sinCobertura.map((item) => `${item.estructura_id}|${item.product_id}`));

  const lineasPorEstructura = plan.estructuras.map((estructura) => ({
    estructura,
    lineas: estructura.materiales
      .filter((material) => !excluido.has(`${estructura.estructura_id}|${material.product_id}`))
      .map((material): LineaDoble => ({
        estructura_id: estructura.estructura_id,
        product_id: material.product_id,
        variant_id: material.variant_id ?? `${material.product_id}-${DIAMETRO_PULGADAS}`,
        color: material.color ?? null,
        acabado: material.acabado ?? null,
        unidades: UNIDADES_POR_MATERIAL,
      })),
  }));
  const todasLasLineas = lineasPorEstructura.flatMap((item) => item.lineas);

  const porVariante = new Map<string, { linea: LineaDoble; unidades: number; estructuras: string[] }>();
  for (const linea of todasLasLineas) {
    const previo = porVariante.get(linea.variant_id);
    if (previo) {
      previo.unidades += linea.unidades;
      if (!previo.estructuras.includes(linea.estructura_id)) previo.estructuras.push(linea.estructura_id);
    } else {
      porVariante.set(linea.variant_id, { linea, unidades: linea.unidades, estructuras: [linea.estructura_id] });
    }
  }

  const compras = [...porVariante.values()].map((item) => {
    const paquetes = Math.max(1, Math.ceil(item.unidades / UNIDADES_PAQUETE));
    const compradas = paquetes * UNIDADES_PAQUETE;
    const costoCompra = paquetes * PRECIO_PAQUETE;
    const costoConsumo = item.unidades * (PRECIO_PAQUETE / UNIDADES_PAQUETE);
    return {
      variante: item.linea,
      unidades: item.unidades,
      estructuras: item.estructuras,
      paquetes,
      compradas,
      sobrante: compradas - item.unidades,
      costoCompra,
      costoConsumo,
      titulo: `Globo ${item.linea.color ?? item.linea.product_id}`,
    };
  });

  const totalUnidades = todasLasLineas.reduce((suma, linea) => suma + linea.unidades, 0);
  const totalCop = compras.reduce((suma, compra) => suma + compra.costoCompra, 0);
  const costoConsumo = compras.reduce((suma, compra) => suma + compra.costoConsumo, 0);
  const sobranteTotal = compras.reduce((suma, compra) => suma + compra.sobrante, 0);
  const planHash = createHash("sha256").update(JSON.stringify(opciones.planOriginal)).digest("hex");

  const origen = (estructuraId: string) => ({ kind: "estructura" as const, id: estructuraId });
  const lineaResuelta = (linea: LineaDoble) => ({
    estructura_id: linea.estructura_id,
    origen: origen(linea.estructura_id),
    product_id: linea.product_id,
    variant_id: linea.variant_id,
    sku: null,
    titulo: `Globo ${linea.color ?? linea.product_id}`,
    color: linea.color,
    tamano_codigo: `R-${DIAMETRO_PULGADAS}`,
    diam_pulg: DIAMETRO_PULGADAS,
    diam_cm: 30.48,
    forma: "redondo",
    acabado: linea.acabado,
    unidades: linea.unidades,
    sustitucion: null,
  });

  const planResuelto = {
    schema_version: "plan-resuelto.v1",
    plan: opciones.planOriginal,
    plan_hash: planHash,
    estructuras: lineasPorEstructura.map(({ estructura, lineas }) => {
      const unidades = lineas.reduce((suma, linea) => suma + linea.unidades, 0);
      return {
        estructura_id: estructura.estructura_id,
        nombre: estructura.nombre,
        tipo: estructura.tipo,
        ubicacion: estructura.ubicacion,
        repeticiones: estructura.repeticiones ?? 1,
        eje_m: null,
        total_unidades: unidades,
        lineas: lineas.map(lineaResuelta),
        mezcla_real: unidades > 0 ? [{ diam_pulg: DIAMETRO_PULGADAS, forma: "redondo", unidades, pct: 100 }] : [],
        supuestos: [],
      };
    }),
    compras: compras.map((compra) => ({
      variant_id: compra.variante.variant_id,
      product_id: compra.variante.product_id,
      sku: null,
      titulo: compra.titulo,
      tamano_codigo: `R-${DIAMETRO_PULGADAS}`,
      diam_pulg: DIAMETRO_PULGADAS,
      color: compra.variante.color,
      unidades_necesarias: compra.unidades,
      design_quantity: compra.unidades,
      waste_reserve: 0,
      required_quantity: compra.unidades,
      unidades_con_merma: compra.unidades,
      unidades_paquete: UNIDADES_PAQUETE,
      paquetes: compra.paquetes,
      purchase_quantity: compra.compradas,
      used: compra.unidades,
      leftover_inventory: compra.sobrante,
      consumption_cost: compra.costoConsumo,
      purchase_cost: compra.costoCompra,
      additional_package_for_waste: false,
      sobrante: compra.sobrante,
      precio_paquete: PRECIO_PAQUETE,
      subtotal: compra.costoCompra,
      estructuras: compra.estructuras,
      elementos_origen: compra.estructuras.map(origen),
      imagen: imagenes[compra.variante.product_id] ?? null,
    })),
    totales: {
      globos_por_tamano: totalUnidades > 0 ? { [`R-${DIAMETRO_PULGADAS}`]: totalUnidades } : {},
      total_unidades: totalUnidades,
      total_cop: totalCop,
      design_quantity: totalUnidades,
      target_waste_reserve: 0,
      covered_waste_reserve: 0,
      uncovered_waste_reserve: 0,
      natural_package_surplus: sobranteTotal,
      purchase_cost: totalCop,
      consumption_cost: costoConsumo,
      waste_only_savings_cop: 0,
      additional_waste_packages: 0,
      ahorro_paquetes_cop: 0,
      incluye_iva: true,
      merma_porcentaje: MERMA_PORCENTAJE,
    },
    comercial: veredicto.comercial ?? { estado: "VERIFICADO", delta_cop: 0 },
    alternativas: [],
    merma_log: "doble de prueba: sin reparto de merma",
    sustituciones: veredicto.sustituciones ?? [],
    sin_cobertura: sinCobertura,
    advertencias: veredicto.advertencias ?? [],
    costes_por_estructura: lineasPorEstructura.map(({ estructura, lineas }) => ({
      estructura_id: estructura.estructura_id,
      consumo_cop: lineas.reduce((suma, linea) => suma + linea.unidades * (PRECIO_PAQUETE / UNIDADES_PAQUETE), 0),
    })),
  };

  const materialEstimate = {
    version: "design-material-estimate-v1",
    design: {
      type: plan.estructuras[0]?.tipo ?? "accesorio",
      shape: null,
      dimensions_m: { width: null, height: null, length: null },
      installation_length_m: null,
      density: null,
      visual_density: "medium",
      visual_scale: "medium",
      cluster_count: 1,
    },
    balloons: todasLasLineas.map((linea) => ({
      structure_id: linea.estructura_id,
      product_id: linea.product_id,
      variant_id: linea.variant_id,
      color: linea.color,
      finish: linea.acabado,
      size_inches: DIAMETRO_PULGADAS,
      shape: "redondo",
      design_quantity: linea.unidades,
      waste_reserve: 0,
      required_quantity: linea.unidades,
      waste_adjusted_quantity: linea.unidades,
    })),
    special_elements: [],
    purchases: compras.map((compra) => ({
      product_id: compra.variante.product_id,
      variant_id: compra.variante.variant_id,
      design_quantity: compra.unidades,
      waste_reserve: 0,
      required_quantity: compra.unidades,
      waste_adjusted_quantity: compra.unidades,
      units_per_package: UNIDADES_PAQUETE,
      package_count: compra.paquetes,
      purchase_quantity: compra.compradas,
      used: compra.unidades,
      leftover_inventory: compra.sobrante,
      consumption_cost: compra.costoConsumo,
      purchase_cost: compra.costoCompra,
      additional_package_for_waste: false,
      operational_surplus: compra.sobrante,
      potential_surplus: compra.sobrante,
    })),
    totals: {
      design_quantity: totalUnidades,
      target_waste_reserve: 0,
      covered_waste_reserve: 0,
      uncovered_waste_reserve: 0,
      natural_package_surplus: sobranteTotal,
      required_quantity: totalUnidades,
      consumption_cost: costoConsumo,
      purchase_cost: totalCop,
      waste_only_savings_cop: 0,
      additional_waste_packages: 0,
      waste_adjusted_quantity: totalUnidades,
      purchase_quantity: compras.reduce((suma, compra) => suma + compra.compradas, 0),
      operational_surplus: sobranteTotal,
      potential_surplus: sobranteTotal,
    },
    warnings: [],
  };

  const quote = {
    schema_version: "quote.v1",
    currency: "COP",
    lines: compras.map((compra) => ({
      id: compra.variante.variant_id,
      product_id: compra.variante.product_id,
      variant_id: compra.variante.variant_id,
      size: `R-${DIAMETRO_PULGADAS}`,
      size_code: `R-${DIAMETRO_PULGADAS}`,
      diameter_inches: DIAMETRO_PULGADAS,
      structures: compra.estructuras,
      origins: compra.estructuras.map(origen),
      ...(compra.variante.color === null ? {} : { color: compra.variante.color }),
      required_quantity: compra.unidades,
      design_quantity: compra.unidades,
      waste_reserve: 0,
      purchase_quantity: compra.compradas,
      used: compra.unidades,
      leftover_inventory: compra.sobrante,
      consumption_cost_cop: compra.costoConsumo,
      purchase_cost_cop: compra.costoCompra,
      available: true,
      title: compra.titulo,
      package_price_cop: PRECIO_PAQUETE,
      units_per_package: UNIDADES_PAQUETE,
      packages: compra.paquetes,
      subtotal_cop: compra.costoCompra,
      surplus: compra.sobrante,
    })),
    total_cop: totalCop,
    waste_percentage: MERMA_PORCENTAJE,
    includes_vat: true,
    supported_complements: false,
    purchase_cost_cop: totalCop,
    consumption_cost_cop: costoConsumo,
    target_waste_reserve: 0,
    covered_waste_reserve: 0,
    leftover_inventory: sobranteTotal,
    plan_hash: planHash,
  };

  const payload = {
    operation_schema_version: "plan-resolution-result.v1",
    catalog_snapshot_id: snapshot,
    plan_resuelto: planResuelto,
    material_estimate: materialEstimate,
    quote,
  };
  // El doble se valida a sí mismo con el contrato publicado: un payload
  // inválido tiene que fallar aquí, nombrando el campo, y no diez capas más
  // arriba como un PYTHON_INVALID_RESPONSE sin causa.
  const parsed = PlanResolutionResultV1Schema.safeParse(payload);
  assert.ok(parsed.success, `el doble emitió un plan-resolution-result.v1 inválido: ${JSON.stringify(parsed.error?.issues)}`);
  return payload;
}

/**
 * Veredicto con las sustituciones de color que el resolutor registra por cada
 * color de la foto que ninguna línea de esa estructura lleva.
 *
 * El dueño de la regla es Python (`_reference_color_substitutions` en
 * `plan.py`). Aquí el doble responde lo que dice `sustitucionesColorReferencia`,
 * la función pura que los propios tests fijan aparte contra sus casos, para que
 * lo que sí se comprueba sea lo de Next: que esas sustituciones llegan a
 * `sustituciones`, se convierten en un `avisos_cliente` cada una y obligan al
 * modelo a contárselas al cliente.
 */
export function veredictoColoresReferencia(plan: PlanRecibido): VeredictoResolucion {
  return {
    sustituciones: plan.estructuras.flatMap((estructura) => sustitucionesColorReferencia(
      estructura.estructura_id,
      estructura.colores_referencia ?? [],
      estructura.materiales.map((material) => material.color ?? null),
    )),
  };
}

/**
 * Variables que el adaptador necesita para poder firmar y enviar la petición.
 * No seleccionan nada: desde el paso 5 del ADR-0023 Python es el único backend.
 */
export function prepararEntornoPythonFalso(): void {
  process.env.PYTHON_BACKEND_URL ??= "http://python.test";
  process.env.INTERNAL_HMAC_SECRET ??= "local-only-secret-0123456789abcdef";
}

/**
 * Sustituye `globalThis.fetch` por el doble y devuelve el registro de llamadas,
 * para que la prueba pueda afirmar sobre lo que Next **envía** a Python, que es
 * lo que sigue siendo suyo (plan canonizado, allowlist del turno, snapshot).
 */
export function instalarResolutorPythonFalso(opciones: OpcionesResolutorFalso = {}): LlamadaPython[] {
  const snapshot = opciones.snapshot ?? SNAPSHOT_FALSO;
  const llamadas: LlamadaPython[] = [];
  let resoluciones = 0;
  // El adaptador convierte cualquier excepción del `fetch` en
  // PYTHON_UNAVAILABLE sin causa, así que un fallo del propio doble se imprime
  // antes de propagarse: si no, se diagnostica como "Python no respondió".
  const responder = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const cuerpo: unknown = JSON.parse(String(init?.body));
    assert.ok(esObjeto(cuerpo), "toda llamada a Python lleva un cuerpo JSON");
    const llamada: LlamadaPython = { path: new URL(String(input)).pathname, body: cuerpo };
    llamadas.push(llamada);
    if (llamada.path !== "/internal/v1/plan/resolve") {
      assert.ok(opciones.otrasRutas, `la prueba no espera una llamada a ${llamada.path}`);
      return opciones.otrasRutas(llamada);
    }
    resoluciones += 1;
    const plan = planRecibido(cuerpo);
    const veredicto = opciones.veredicto?.(plan, resoluciones) ?? {};
    const contexto = cuerpo.context;
    assert.ok(esObjeto(contexto), "la petición operativa lleva contexto");
    return Response.json({
      schema_version: "operational.v1",
      request_id: contexto.request_id,
      correlation_id: contexto.correlation_id,
      payload: payloadResolucionFalso(plan, { snapshot, veredicto, planOriginal: cuerpo.plan, ...(opciones.imagenes ? { imagenes: opciones.imagenes } : {}) }),
    });
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await responder(input, init);
    } catch (error) {
      console.error("[doble Python]", error);
      throw error;
    }
  }) as typeof fetch;
  return llamadas;
}
