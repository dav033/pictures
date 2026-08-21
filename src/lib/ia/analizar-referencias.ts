import "server-only";
import { createHash } from "node:crypto";
import type { ChatPort, Herramienta, ImagenEtiquetada } from "./tipos";

export type AnalisisReferencia = {
  id: string;
  resumen_literal: string;
  decoraciones: Array<{
    elemento: string;
    cantidad_aproximada: string;
    colores: string[];
    material_textura: string;
    forma: string;
    ubicacion: string;
    escala_relativa: string;
  }>;
  paleta: Array<{ color: string; proporcion_aproximada: string; ubicacion: string }>;
  composicion: {
    distribucion: string;
    punto_focal: string;
    densidad: string;
    simetria: string;
  };
  anclas_espaciales: Array<{
    elemento_ref: string;
    x_pct: number;
    y_pct: number;
    ancho_pct: number;
    alto_pct: number;
    profundidad: string;
    relacion: string;
  }>;
  estructura_espacial: {
    horizonte_pct: number;
    ocupacion_decoracion_pct: string;
    espacio_negativo: string;
    capas: string[];
  };
  iluminacion: {
    tipo: string;
    direccion: string;
    intensidad: string;
    temperatura: string;
  };
  ambiente: string;
  copiar: string[];
  no_copiar: string[];
  incertidumbres: string[];
};

export type AnalisisReferencias = {
  version: 1;
  referencias: AnalisisReferencia[];
  sintesis: {
    estilo: string;
    paleta_prioritaria: string[];
    composicion_objetivo: string;
    prioridades: Array<{ id: string; aplicar: string }>;
    conflictos: string[];
  };
};

const cache = new Map<string, AnalisisReferencias>();
const MAX_CACHE = 40;

const HERRAMIENTA_ANALISIS: Herramienta = {
  nombre: "entregar_analisis_referencias",
  descripcion:
    "Entrega exclusivamente el análisis visual literal y estructurado de todas las imágenes de referencia.",
  esquema: {
    type: "object",
    required: ["referencias", "sintesis"],
    properties: {
      referencias: {
        type: "array",
        items: {
          type: "object",
          required: [
            "id",
            "resumen_literal",
            "decoraciones",
            "paleta",
            "composicion",
            "anclas_espaciales",
            "estructura_espacial",
            "iluminacion",
            "ambiente",
            "copiar",
            "no_copiar",
            "incertidumbres",
          ],
          properties: {
            id: { type: "string" },
            resumen_literal: { type: "string" },
            decoraciones: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "elemento",
                  "cantidad_aproximada",
                  "colores",
                  "material_textura",
                  "forma",
                  "ubicacion",
                  "escala_relativa",
                ],
                properties: {
                  elemento: { type: "string" },
                  cantidad_aproximada: { type: "string" },
                  colores: { type: "array", items: { type: "string" } },
                  material_textura: { type: "string" },
                  forma: { type: "string" },
                  ubicacion: { type: "string" },
                  escala_relativa: { type: "string" },
                },
              },
            },
            paleta: {
              type: "array",
              items: {
                type: "object",
                required: ["color", "proporcion_aproximada", "ubicacion"],
                properties: {
                  color: { type: "string" },
                  proporcion_aproximada: { type: "string" },
                  ubicacion: { type: "string" },
                },
              },
            },
            composicion: {
              type: "object",
              required: ["distribucion", "punto_focal", "densidad", "simetria"],
              properties: {
                distribucion: { type: "string" },
                punto_focal: { type: "string" },
                densidad: { type: "string" },
                simetria: { type: "string" },
              },
            },
            anclas_espaciales: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "elemento_ref",
                  "x_pct",
                  "y_pct",
                  "ancho_pct",
                  "alto_pct",
                  "profundidad",
                  "relacion",
                ],
                properties: {
                  elemento_ref: { type: "string" },
                  x_pct: { type: "number", minimum: 0, maximum: 100 },
                  y_pct: { type: "number", minimum: 0, maximum: 100 },
                  ancho_pct: { type: "number", minimum: 0, maximum: 100 },
                  alto_pct: { type: "number", minimum: 0, maximum: 100 },
                  profundidad: { type: "string" },
                  relacion: { type: "string" },
                },
              },
            },
            estructura_espacial: {
              type: "object",
              required: ["horizonte_pct", "ocupacion_decoracion_pct", "espacio_negativo", "capas"],
              properties: {
                horizonte_pct: { type: "number", minimum: 0, maximum: 100 },
                ocupacion_decoracion_pct: { type: "string" },
                espacio_negativo: { type: "string" },
                capas: { type: "array", items: { type: "string" } },
              },
            },
            iluminacion: {
              type: "object",
              required: ["tipo", "direccion", "intensidad", "temperatura"],
              properties: {
                tipo: { type: "string" },
                direccion: { type: "string" },
                intensidad: { type: "string" },
                temperatura: { type: "string" },
              },
            },
            ambiente: { type: "string" },
            copiar: { type: "array", items: { type: "string" } },
            no_copiar: { type: "array", items: { type: "string" } },
            incertidumbres: { type: "array", items: { type: "string" } },
          },
        },
      },
      sintesis: {
        type: "object",
        required: ["estilo", "paleta_prioritaria", "composicion_objetivo", "prioridades", "conflictos"],
        properties: {
          estilo: { type: "string" },
          paleta_prioritaria: { type: "array", items: { type: "string" } },
          composicion_objetivo: { type: "string" },
          prioridades: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "aplicar"],
              properties: { id: { type: "string" }, aplicar: { type: "string" } },
            },
          },
          conflictos: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const SISTEMA = `Eres un analista visual forense especializado en decoración de eventos.
Debes llamar exactamente una vez a entregar_analisis_referencias.

REGLAS INNEGOCIABLES
- Analiza cada imagen por su IMAGEN_ID y devuelve exactamente un objeto por cada ID recibido.
- Describe solo lo visible. No inventes objetos ocultos, marcas, materiales, cantidades exactas ni intención del diseñador.
- Usa "no determinable" cuando la imagen no permita saber algo.
- Separa decoración visible de arquitectura, personas, mobiliario y fondo.
- En "copiar" registra rasgos visuales concretos que el generador sí debe replicar: paleta, distribución, densidad, formas, textura e iluminación.
- En "no_copiar" registra objetos incidentales o de fondo que no deben convertirse en decoración nueva.
- Cantidades siempre aproximadas y por rangos cuando no puedan contarse.
- Colores específicos y literales; indica ubicación y proporción aproximada.
- Usa coordenadas porcentuales sobre el lienzo: x/y son esquina superior izquierda; ancho/alto son caja visible.
- Crea un ancla espacial por cada grupo decorativo importante. No inventes partes fuera del encuadre.
- Describe capas desde fondo hacia primer plano y conserva explícitamente el espacio negativo.
- Si referencias se contradicen, no resuelvas inventando: registra conflicto.
- No incluyas prosa fuera de la llamada de herramienta.`;

function texto(valor: unknown, defecto = "no determinable"): string {
  return typeof valor === "string" && valor.trim() ? valor.trim().slice(0, 1200) : defecto;
}

function lista(valor: unknown, max = 20): string[] {
  return Array.isArray(valor) ? valor.map((v) => texto(v, "")).filter(Boolean).slice(0, max) : [];
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function porcentaje(valor: unknown, defecto = 50): number {
  return typeof valor === "number" && Number.isFinite(valor) ? Math.max(0, Math.min(100, valor)) : defecto;
}

function normalizarReferencia(valor: unknown, id: string): AnalisisReferencia {
  const r = objeto(valor);
  const composicion = objeto(r.composicion);
  const estructura = objeto(r.estructura_espacial);
  const iluminacion = objeto(r.iluminacion);
  return {
    id,
    resumen_literal: texto(r.resumen_literal),
    decoraciones: (Array.isArray(r.decoraciones) ? r.decoraciones : []).slice(0, 30).map((item) => {
      const d = objeto(item);
      return {
        elemento: texto(d.elemento),
        cantidad_aproximada: texto(d.cantidad_aproximada),
        colores: lista(d.colores, 10),
        material_textura: texto(d.material_textura),
        forma: texto(d.forma),
        ubicacion: texto(d.ubicacion),
        escala_relativa: texto(d.escala_relativa),
      };
    }),
    paleta: (Array.isArray(r.paleta) ? r.paleta : []).slice(0, 12).map((item) => {
      const p = objeto(item);
      return {
        color: texto(p.color),
        proporcion_aproximada: texto(p.proporcion_aproximada),
        ubicacion: texto(p.ubicacion),
      };
    }),
    composicion: {
      distribucion: texto(composicion.distribucion),
      punto_focal: texto(composicion.punto_focal),
      densidad: texto(composicion.densidad),
      simetria: texto(composicion.simetria),
    },
    anclas_espaciales: (Array.isArray(r.anclas_espaciales) ? r.anclas_espaciales : [])
      .slice(0, 30)
      .map((item) => {
        const ancla = objeto(item);
        return {
          elemento_ref: texto(ancla.elemento_ref),
          x_pct: porcentaje(ancla.x_pct),
          y_pct: porcentaje(ancla.y_pct),
          ancho_pct: porcentaje(ancla.ancho_pct, 10),
          alto_pct: porcentaje(ancla.alto_pct, 10),
          profundidad: texto(ancla.profundidad),
          relacion: texto(ancla.relacion),
        };
      }),
    estructura_espacial: {
      horizonte_pct: porcentaje(estructura.horizonte_pct),
      ocupacion_decoracion_pct: texto(estructura.ocupacion_decoracion_pct),
      espacio_negativo: texto(estructura.espacio_negativo),
      capas: lista(estructura.capas, 12),
    },
    iluminacion: {
      tipo: texto(iluminacion.tipo),
      direccion: texto(iluminacion.direccion),
      intensidad: texto(iluminacion.intensidad),
      temperatura: texto(iluminacion.temperatura),
    },
    ambiente: texto(r.ambiente),
    copiar: lista(r.copiar),
    no_copiar: lista(r.no_copiar),
    incertidumbres: lista(r.incertidumbres),
  };
}

function extraerJson(textoRespuesta: string): unknown {
  const limpio = textoRespuesta.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(limpio);
}

function claveCache(chat: ChatPort, referencias: ImagenEtiquetada[]): string {
  const hash = createHash("sha256").update(chat.id).update(chat.modelo);
  for (const r of referencias) hash.update(r.id).update(r.mime).update(r.base64);
  return hash.digest("hex");
}

export async function analizarReferencias(
  chat: ChatPort,
  referencias: ImagenEtiquetada[],
): Promise<AnalisisReferencias> {
  if (referencias.length === 0) {
    return {
      version: 1,
      referencias: [],
      sintesis: {
        estilo: "sin referencias de estilo",
        paleta_prioritaria: [],
        composicion_objetivo: "no aplica",
        prioridades: [],
        conflictos: [],
      },
    };
  }

  const clave = claveCache(chat, referencias);
  const guardado = cache.get(clave);
  if (guardado) return guardado;

  const ids = referencias.map((r) => r.id);
  const turno = await chat.turno({
    sistema: SISTEMA,
    historial: [
      {
        rol: "usuario",
        texto:
          `Analiza estas ${referencias.length} referencias. IDs obligatorios y en este orden: ${ids.join(", ")}. ` +
          "La salida debe mantener esos IDs exactos, sin crear ni omitir ninguno.",
        imagenes: referencias,
      },
    ],
    herramientas: [HERRAMIENTA_ANALISIS],
    temperatura: 0,
    maxTokens: 5000,
  });

  const crudo = turno.llamadas.find((l) => l.nombre === HERRAMIENTA_ANALISIS.nombre)?.args ?? extraerJson(turno.texto);
  const raiz = objeto(crudo);
  const recibidas = Array.isArray(raiz.referencias) ? raiz.referencias : [];
  const porId = new Map(recibidas.map((r) => [texto(objeto(r).id, ""), r]));
  const faltantes = ids.filter((id) => !porId.has(id));
  if (faltantes.length || porId.size !== ids.length) {
    throw new Error(
      `El análisis visual no conservó la relación exacta de referencias (faltan: ${faltantes.join(", ") || "ninguna"}).`,
    );
  }

  const sintesisCruda = objeto(raiz.sintesis);
  const prioridades = (Array.isArray(sintesisCruda.prioridades) ? sintesisCruda.prioridades : [])
    .map((p) => objeto(p))
    .filter((p) => ids.includes(texto(p.id, "")))
    .map((p) => ({ id: texto(p.id), aplicar: texto(p.aplicar) }));

  const resultado: AnalisisReferencias = {
    version: 1,
    referencias: ids.map((id) => normalizarReferencia(porId.get(id), id)),
    sintesis: {
      estilo: texto(sintesisCruda.estilo),
      paleta_prioritaria: lista(sintesisCruda.paleta_prioritaria, 12),
      composicion_objetivo: texto(sintesisCruda.composicion_objetivo),
      prioridades,
      conflictos: lista(sintesisCruda.conflictos),
    },
  };

  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(clave, resultado);
  return resultado;
}
