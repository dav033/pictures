"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { esCancelacion, mensajeFalloPlanEditar } from "@/lib/plan/peticion-plan-editar";
import type { LineaMaterial } from "@/lib/plan/resuelto";
import {
  LIMITE_INICIAL,
  PARTICIPACION_INICIAL,
  armarConsultas,
  armarEdicion,
  avisoAplicado,
  claveFiltros,
  colorInicial,
  lineaObjetivoDe,
  motivoNoAplicable,
  puedeCargarMas,
  resumenFiltros,
  siguienteLimite,
  tamanoInicialDe,
  tarjetasDeCandidatos,
  varianteParaAplicar,
  type ColorCatalogo,
  type EdicionAjuste,
  type ModoAjuste,
  type TarjetaGlobo,
  type OpcionElegible,
} from "./ajuste-propuesta";
import { pedirBusqueda, pedirColoresCatalogo, RESPALDO_BUSQUEDA, RESPALDO_COLORES } from "./cliente-explorador";
import { agruparColoresPorFamilia, coloresDeBusqueda, familiaDeColor, type FamiliaDelCatalogo, type FamiliaId } from "./familias-color";

export type PiezaAjustable = { id: string; nombre: string };

export type Entrada = {
  piezas: readonly PiezaAjustable[];
  /** Las líneas de la pieza como las ve el cliente: una por producto, tamaño y color. */
  lineasDe: (estructuraId: string) => readonly LineaMaterial[];
  inicial: { modo: ModoAjuste; estructuraId: string; objetivoVariantId: string | null };
  approvalToken?: string;
  /** Variantes que la propuesta ya compra (ver `varianteParaAplicar`). */
  variantIdsDelPlan: ReadonlySet<string>;
  /** Publica la edición en la propuesta; devuelve el motivo (ya dicho para el cliente) si falló, o null. */
  onAplicar: (edicion: EdicionAjuste, aviso: string) => Promise<string | null>;
  /** La edición quedó en la propuesta: el modal se cierra. */
  onAplicado: () => void;
};

export type ElegidoAjuste = { producto: Pick<TarjetaGlobo, "productId" | "nombre" | "imagen">; variante: OpcionElegible };

export type VistaResultados =
  | { tipo: "cargando" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "listo"; tarjetas: TarjetaGlobo[]; cargandoMas: boolean; hayMas: boolean };

/** Lo que trae una búsqueda: la de una familia elegida, o (familia null) la de todo el catálogo. */
export type SeccionResultados = { familia: FamiliaId | null; vista: VistaResultados };

export type VistaColores = { tipo: "cargando" } | { tipo: "error"; mensaje: string } | { tipo: "listo"; colores: ColorCatalogo[]; familias: FamiliaDelCatalogo[] };

type Resultado = { error: string | null; tarjetas: TarjetaGlobo[]; hayMas: boolean };

const RESPALDO_APLICAR = "No se pudo actualizar la propuesta.";
const PAUSA_ESCRITURA_MS = 350;

function alternar<T>(lista: readonly T[], valor: T): T[] {
  return lista.includes(valor) ? lista.filter((item) => item !== valor) : [...lista, valor];
}

/**
 * Estado y peticiones del modal «Ajusta la propuesta». Lo que el cliente elige (pieza, globo, filtros, color,
 * participación) es estado transitorio de la pantalla; lo que viene del catálogo (colores, tarjetas) llega de
 * `/api/plan-editar` por `cliente-explorador.ts` (con memoria) y se guarda con la clave de la petición que lo pidió:
 * «cargando» se deduce de que falte esa clave, y una respuesta tardía de un filtro viejo nunca se pinta.
 */
export function useAjustePropuesta(entrada: Entrada) {
  const { inicial, approvalToken, lineasDe, variantIdsDelPlan, onAplicar, onAplicado } = entrada;
  const [modo, setModo] = useState<ModoAjuste>(inicial.modo);
  const [estructuraId, setEstructuraId] = useState(inicial.estructuraId);
  const [objetivoVariantId, setObjetivoVariantId] = useState<string | null>(inicial.objetivoVariantId);
  const [texto, setTexto] = useState("");
  const [textoBusqueda, setTextoBusqueda] = useState("");
  const [familias, setFamilias] = useState<FamiliaId[]>([]);
  const [exactos, setExactos] = useState<string[]>([]);
  const [tamanos, setTamanos] = useState<number[]>(() => {
    const linea = inicial.modo === "reemplazar" ? lineasDe(inicial.estructuraId).find((item) => item.variant_id === inicial.objetivoVariantId) : undefined;
    return tamanoInicialDe(linea);
  });
  const [limite, setLimite] = useState(LIMITE_INICIAL);
  const [intentoBusqueda, setIntentoBusqueda] = useState(0);
  const [resultados, setResultados] = useState<Readonly<Record<string, Resultado>>>({});
  const [intentoColores, setIntentoColores] = useState(0);
  const [coloresCatalogo, setColoresCatalogo] = useState<{ intento: number; colores: ColorCatalogo[] | null; error: string | null } | null>(null);
  const [elegido, setElegido] = useState<ElegidoAjuste | null>(null);
  const [color, setColor] = useState("");
  const [participacion, setParticipacion] = useState(PARTICIPACION_INICIAL);
  const [guardando, setGuardando] = useState(false);
  const [errorAplicar, setErrorAplicar] = useState<string | null>(null);

  const lineas = lineasDe(estructuraId);
  const lineaObjetivo = modo === "reemplazar" ? lineas.find((linea) => linea.variant_id === objetivoVariantId) : undefined;

  const catalogo = useMemo(() => (coloresCatalogo?.intento === intentoColores && coloresCatalogo.colores ? agruparColoresPorFamilia(coloresCatalogo.colores) : []), [coloresCatalogo, intentoColores]);

  // `lineasDe` entrega copias nuevas en cada render: la petición depende de la forma y el tamaño, no de la identidad.
  const formaObjetivo = lineaObjetivo?.forma ?? null;
  const diametroObjetivo = lineaObjetivo?.diam_pulg ?? null;
  const consultas = useMemo(
    () => armarConsultas({ texto: textoBusqueda, familias, exactos, catalogo, tamanos, limite, approvalToken, lineaObjetivo: lineaObjetivoDe({ forma: formaObjetivo, diam_pulg: diametroObjetivo }) }),
    [textoBusqueda, familias, exactos, catalogo, tamanos, limite, approvalToken, formaObjetivo, diametroObjetivo],
  );

  // Lo escrito se busca al hacer una pausa; Enter lo busca ya (`buscarYa`).
  useEffect(() => {
    const pausa = setTimeout(() => { setTextoBusqueda(texto); setLimite(LIMITE_INICIAL); }, PAUSA_ESCRITURA_MS);
    return () => clearTimeout(pausa);
  }, [texto]);

  // Lanza todas las búsquedas a la vez; al cambiar los filtros se sueltan las que ya no hacen falta.
  useEffect(() => {
    const controlador = new AbortController();
    for (const consulta of consultas) {
      const clave = `${intentoBusqueda}:${JSON.stringify(consulta.cuerpo)}`;
      const base = `base:${intentoBusqueda}:${consulta.familia ?? "todo"}:${claveFiltros(consulta.cuerpo)}`;
      const guardar = (resultado: Resultado) => setResultados((previos) => ({ ...previos, [clave]: resultado, [base]: resultado }));
      pedirBusqueda(consulta.cuerpo, controlador.signal)
        .then((respuesta) => guardar({ error: null, tarjetas: tarjetasDeCandidatos(respuesta.candidatos), hayMas: respuesta.hayMas }))
        .catch((error: unknown) => {
          if (esCancelacion(error)) return;
          guardar({ error: mensajeFalloPlanEditar(error, RESPALDO_BUSQUEDA), tarjetas: [], hayMas: false });
        });
    }
    return () => controlador.abort();
  }, [consultas, intentoBusqueda]);

  // Los colores se piden a la vez que la primera página, no después.
  useEffect(() => {
    const controlador = new AbortController();
    pedirColoresCatalogo(approvalToken, controlador.signal)
      .then((colores) => setColoresCatalogo({ intento: intentoColores, colores, error: null }))
      .catch((error: unknown) => {
        if (esCancelacion(error)) return;
        setColoresCatalogo({ intento: intentoColores, colores: null, error: mensajeFalloPlanEditar(error, RESPALDO_COLORES) });
      });
    return () => controlador.abort();
  }, [approvalToken, intentoColores]);

  const secciones: SeccionResultados[] = consultas.map((consulta) => {
    const clave = `${intentoBusqueda}:${JSON.stringify(consulta.cuerpo)}`;
    const base = `base:${intentoBusqueda}:${consulta.familia ?? "todo"}:${claveFiltros(consulta.cuerpo)}`;
    const exacto = resultados[clave];
    if (exacto) {
      return { familia: consulta.familia, vista: exacto.error ? { tipo: "error", mensaje: exacto.error } : { tipo: "listo", tarjetas: exacto.tarjetas, cargandoMas: false, hayMas: puedeCargarMas(limite, exacto.hayMas) } };
    }
    // Pidiendo más de lo mismo: lo ya visto sigue en pantalla mientras llega lo demás.
    const previo = resultados[base];
    if (previo && !previo.error) return { familia: consulta.familia, vista: { tipo: "listo", tarjetas: previo.tarjetas, cargandoMas: true, hayMas: false } };
    return { familia: consulta.familia, vista: { tipo: "cargando" } };
  });

  const vistaColores: VistaColores = coloresCatalogo?.intento !== intentoColores
    ? { tipo: "cargando" }
    : coloresCatalogo.colores ? { tipo: "listo", colores: coloresCatalogo.colores, familias: catalogo } : { tipo: "error", mensaje: coloresCatalogo.error ?? RESPALDO_COLORES };

  const coloresFiltrados = useMemo(() => catalogo.filter((familia) => familias.includes(familia.id)).flatMap((familia) => coloresDeBusqueda(familia, exactos)), [catalogo, familias, exactos]);

  const motivo = motivoNoAplicable({ modo, objetivoVariantId, elegido: elegido?.variante ?? null, participacion });

  function soltarElegido(): void {
    setElegido(null);
    setColor("");
    setErrorAplicar(null);
  }

  function elegirModo(nuevo: ModoAjuste): void {
    if (nuevo === modo) return;
    setModo(nuevo);
    setObjetivoVariantId(null);
    setTamanos([]);
    setLimite(LIMITE_INICIAL);
    soltarElegido();
  }

  function elegirPieza(id: string): void {
    setEstructuraId(id);
    setObjetivoVariantId(null);
    setTamanos([]);
    setLimite(LIMITE_INICIAL);
    soltarElegido();
  }

  function elegirObjetivo(variantId: string): void {
    setObjetivoVariantId(variantId);
    setTamanos(tamanoInicialDe(lineas.find((linea) => linea.variant_id === variantId)));
    setLimite(LIMITE_INICIAL);
    soltarElegido();
  }

  /** Marca o suelta una familia entera; al soltarla se sueltan también los colores exactos que se habían marcado dentro. */
  function alternarFamilia(id: FamiliaId): void {
    const quitando = familias.includes(id);
    setFamilias((actuales) => alternar(actuales, id));
    if (quitando) setExactos((actuales) => actuales.filter((valor) => familiaDeColor(valor) !== id));
    setLimite(LIMITE_INICIAL);
  }

  /** Marca o suelta un color exacto dentro de una familia (que queda elegida); sin ninguno marcado, vale toda la familia. */
  function alternarColorExacto(valor: string): void {
    const id = familiaDeColor(valor);
    setFamilias((actuales) => (actuales.includes(id) ? actuales : [...actuales, id]));
    setExactos((actuales) => alternar(actuales, valor));
    setLimite(LIMITE_INICIAL);
  }

  function alternarTamano(valor: number): void {
    setTamanos((actuales) => alternar(actuales, valor));
    setLimite(LIMITE_INICIAL);
  }

  function limpiarTamanos(): void {
    setTamanos([]);
    setLimite(LIMITE_INICIAL);
  }

  function limpiarFiltros(): void {
    setFamilias([]);
    setExactos([]);
    setTamanos([]);
    setTexto("");
    setTextoBusqueda("");
    setLimite(LIMITE_INICIAL);
  }

  function buscarYa(): void {
    setTextoBusqueda(texto);
    setLimite(LIMITE_INICIAL);
  }

  // Estable: las tarjetas de la grilla (memo) no se repintan al mover el deslizador ni al escribir en el pie.
  const elegirVariante = useCallback((producto: ElegidoAjuste["producto"], variante: OpcionElegible): void => {
    setElegido({ producto, variante });
    setColor(colorInicial(variante, coloresFiltrados));
    setErrorAplicar(null);
  }, [coloresFiltrados]);

  async function aplicar(): Promise<void> {
    if (guardando) return;
    if (!elegido || motivo !== null) {
      setErrorAplicar(motivo ?? RESPALDO_APLICAR);
      return;
    }
    const edicion = armarEdicion({ modo, objetivoVariantId, participacion, estructuraId, elegido: { variantId: varianteParaAplicar(elegido.variante, variantIdsDelPlan), productId: elegido.variante.productId }, color });
    if (!edicion) return;
    setGuardando(true);
    setErrorAplicar(null);
    const error = await onAplicar(edicion, avisoAplicado(modo));
    setGuardando(false);
    if (error) setErrorAplicar(error);
    else onAplicado();
  }

  const hayFiltros = familias.length > 0 || tamanos.length > 0 || texto.trim().length > 0;
  return {
    modo,
    estructuraId,
    objetivoVariantId,
    lineas,
    lineaObjetivo,
    texto,
    familias,
    exactos,
    tamanos,
    limite,
    secciones,
    vistaColores,
    resumen: resumenFiltros({ familias, exactos, tamanos, catalogo }),
    elegido,
    color,
    participacion,
    guardando,
    errorAplicar,
    motivo,
    hayFiltros,
    setTexto,
    setColor,
    setParticipacion,
    elegirModo,
    elegirPieza,
    elegirObjetivo,
    alternarFamilia,
    alternarColorExacto,
    alternarTamano,
    limpiarTamanos,
    limpiarFiltros,
    buscarYa,
    elegirVariante,
    cargarMas: () => setLimite((actual) => siguienteLimite(actual)),
    reintentarBusqueda: () => setIntentoBusqueda((n) => n + 1),
    reintentarColores: () => setIntentoColores((n) => n + 1),
    aplicar,
  };
}

export type AjustePropuesta = ReturnType<typeof useAjustePropuesta>;
