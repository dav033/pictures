"use client";

import { useState, type PointerEvent } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import {
  FORMAS_GUIRNALDA,
  POSICIONES_REMATE_GUIRNALDA,
  type ArmadoGuirnaldaV1,
  type FormaGuirnalda,
  type PosicionRemateGuirnalda,
  type SoporteGuirnalda,
  type UnidadRacimoGuirnalda,
} from "@/lib/plan/armado-guirnalda";
import type { OpcionesArmadoGuirnalda } from "@/lib/plan/opciones-armado-guirnalda";
import type { ColorLeyenda } from "../patron/leyenda";
import { Apartado, Contador, Interruptor, Segmentado, SelectorColor } from "../patron/controles-comunes";
import {
  agregarRemate,
  conAnclajes,
  conAnfitriona,
  conCaida,
  conDesnivel,
  conForma,
  conRacimo,
  conRelleno,
  conRemate,
  conSoporte,
  MAX_DESNIVEL_M,
  MAXIMO_REMATES,
  quitarRemate,
} from "./borrador-guirnalda";
import { desnivelTexto, formaConCaida, metros, NOMBRE_FORMA, NOMBRE_POSICION, NOMBRE_SOPORTE, NOMBRE_UNIDAD, soporteConCaida } from "./leyenda-guirnalda";

type Props = {
  /** El armado a la vista (el del decorador o la receta de Python); `null` mientras no hay ninguno. */
  borrador: ArmadoGuirnaldaV1 | null;
  /** Lo que Python admite para la pieza; `null` mientras no lo dijo (se ofrece solo lo que ya tiene el borrador). */
  opciones: OpcionesArmadoGuirnalda | null;
  /** Los colores de la pieza por índice de material, como la leyenda del patrón. */
  colores: readonly ColorLeyenda[];
  /** Nombre de una pieza del plan, para elegir la anfitriona. */
  nombrePieza: (estructuraId: string) => string;
  onCambiar: (siguiente: ArmadoGuirnaldaV1) => void;
  /** Remate que se está llevando a un racimo (`null`: ninguno). */
  moviendo: number | null;
  /** Elige (o suelta, con `null`) el remate que se lleva a un racimo con el teclado o un toque. */
  onMover: (indice: number | null) => void;
  /** Empieza a arrastrar un remate con el puntero hasta un racimo de la gráfica. */
  onArrastrar: (indice: number, evento: PointerEvent<HTMLButtonElement>) => void;
  /** El botón "Mover" de cada remate, para devolverle el foco al soltarlo en un racimo. */
  registrarMover?: (indice: number) => (nodo: HTMLButtonElement | null) => void;
  /** Sin borrador: por qué (Python no puede armar la receta o no respondió). Sin él, se está cargando. */
  aviso?: string | null;
};

const MIN_CAIDA_M = 0.05;
/** Tope de `caida_m` en `armado-guirnalda.v1`. */
const MAX_CAIDA_M = 5;
const MAX_PROPORCION_RELLENO = 0.5;
const ANCLAJES = { min: 2, max: 6 } as const;
const PROPORCION_RELLENO_INICIAL = 0.2;
/** Al encender el desnivel: el extremo derecho un poco más bajo, como cae una guirnalda en la pared. */
const DESNIVEL_INICIAL_M = -0.2;

/** "−0,4 m", "+0,25 m": el desnivel del extremo derecho, corto para la salida del deslizador. */
function desnivelCorto(valor: number): string {
  if (!valor) return "0 m";
  return `${valor < 0 ? "−" : "+"}${metros(Math.abs(valor))}`;
}

/** Lo que lee un lector de pantalla del deslizador del desnivel. */
function desnivelLeido(valor: number): string {
  return valor ? `La guirnalda ${desnivelTexto({ desnivel_m: valor })}` : "Los dos extremos a la misma altura";
}

const porcentaje = new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 0 });

function mayuscula(texto: string): string {
  return texto ? `${texto.charAt(0).toUpperCase()}${texto.slice(1)}` : texto;
}

/**
 * Deslizador que confirma al soltar (puntero o tecla), no en cada paso: un
 * arrastre es un solo borrador, una sola vista previa y una sola entrada de
 * "Deshacer". Mientras se mueve, solo cambia su número.
 */
function Deslizador({ etiqueta, valor, min, max, paso, formato, textoValor = formato, onConfirmar, testid }: {
  etiqueta: string;
  valor: number;
  min: number;
  max: number;
  paso: number;
  formato: (valor: number) => string;
  /** Lo que anuncia el lector de pantalla (`aria-valuetext`); sin él, lo que se ve. */
  textoValor?: (valor: number) => string;
  onConfirmar: (valor: number) => void;
  testid: string;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const mostrado = local ?? valor;
  const confirmar = () => {
    if (local !== null && local !== valor) onConfirmar(local);
    setLocal(null);
  };
  return (
    <label className="flex items-center gap-3 text-[13px] text-texto">
      <span className="sr-only">{etiqueta}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={paso}
        value={mostrado}
        aria-valuetext={textoValor(mostrado)}
        data-testid={testid}
        onChange={(evento) => setLocal(Number(evento.currentTarget.value))}
        onPointerUp={confirmar}
        onKeyUp={confirmar}
        onBlur={confirmar}
        className="h-2 min-w-0 flex-1 cursor-pointer accent-[var(--acento)]"
      />
      <output className="w-16 shrink-0 text-right font-medium tabular-nums">{formato(mostrado)}</output>
    </label>
  );
}

/**
 * Ajustes del armado de una guirnalda (ADR-0032, E6): soporte (y la pieza
 * anfitriona), forma, caída, desnivel entre los extremos (en pared o colgada,
 * decisión 26) y anclajes, unidad y tamaño del racimo, relleno y remates.
 * Ofrece lo que Python admite para la pieza (`opciones`); las formas
 * son las cinco del contrato y Python rechaza con su frase la que no quepa
 * con el soporte (el editor la deshace). Cada cambio es un borrador nuevo que
 * Python dibuja; aquí no se cuenta nada.
 */
export function ControlesGuirnalda({ borrador, opciones, colores, nombrePieza, onCambiar, moviendo, onMover, onArrastrar, registrarMover, aviso = null }: Props) {
  if (!borrador && aviso) {
    return (
      <p data-testid="controles-guirnalda-sin-armado" className="rounded-xl bg-superficie-suave px-3 py-2.5 text-[13px] text-texto-suave">
        No hay armado que ajustar: {aviso} Con «Restablecer» vuelve el que tenía la pieza.
      </p>
    );
  }
  if (!borrador) {
    return (
      <div className="space-y-5" aria-hidden="true">
        {[64, 56, 48, 56].map((ancho, indice) => <div key={indice} className="brillo-carga h-9 max-w-full rounded-xl" style={{ width: `${ancho * 4}px` }} />)}
      </div>
    );
  }
  const soportes = opciones?.soportes ?? [borrador.soporte];
  const anfitrionas = opciones?.anfitrionas ?? (borrador.estructura_id ? [borrador.estructura_id] : []);
  const unidades = opciones?.unidades ?? [borrador.racimo.unidad];
  const tamanos = opciones?.tamanos_base ?? [borrador.racimo.tamano_pulg_base];
  const materialesRelleno = opciones?.materiales_relleno ?? (borrador.relleno ? [borrador.relleno.material] : []);
  const materialesRemate = opciones?.materiales_remate ?? borrador.remates.map((remate) => remate.material);
  const coloresDe = (indices: readonly number[], actual?: number) => colores.filter((color) => indices.includes(color.indice) || color.indice === actual);
  const conCaidaForma = formaConCaida(borrador.forma);
  const conAnclajesVisibles = borrador.soporte === "colgada" || borrador.forma === "arco_caido";
  const conDesnivelVisible = soporteConCaida(borrador.soporte);
  const nombreColor = (indice: number) => colores.find((color) => color.indice === indice)?.etiqueta ?? `Color ${indice + 1}`;

  return (
    <div className="space-y-5">
      <Apartado titulo="Soporte" ayuda={NOMBRE_SOPORTE[borrador.soporte].ayuda}>
        <Segmentado<SoporteGuirnalda>
          etiqueta="Soporte de la guirnalda"
          opciones={soportes.map((soporte) => ({ valor: soporte, etiqueta: NOMBRE_SOPORTE[soporte].nombre }))}
          valor={borrador.soporte}
          onCambiar={(soporte) => {
            if (soporte !== borrador.soporte) onCambiar(conSoporte(borrador, soporte, anfitrionas[0]));
          }}
        />
        {borrador.soporte === "sobre_estructura" && anfitrionas.length > 0 && (
          <label className="flex flex-wrap items-center gap-2 text-[13px] text-texto">
            <span className="font-medium">Sobre la pieza</span>
            <select
              value={borrador.estructura_id ?? ""}
              onChange={(evento) => onCambiar(conAnfitriona(borrador, evento.currentTarget.value))}
              data-testid="anfitriona-guirnalda"
              className="h-9 min-w-0 rounded-xl border border-borde bg-superficie px-2 text-[13px] focus-visible:outline-2 focus-visible:outline-acento"
            >
              {anfitrionas.map((id) => <option key={id} value={id}>{nombrePieza(id)}</option>)}
            </select>
          </label>
        )}
      </Apartado>

      <Apartado titulo="Forma" ayuda="Cómo corre de un extremo al otro. La U invertida y el arco caído cuelgan: en pared o colgada, donde un extremo también puede ir más alto que el otro.">
        <Segmentado<FormaGuirnalda>
          etiqueta="Forma de la guirnalda"
          opciones={FORMAS_GUIRNALDA.map((forma) => ({ valor: forma, etiqueta: NOMBRE_FORMA[forma] }))}
          valor={borrador.forma}
          onCambiar={(forma) => {
            if (forma !== borrador.forma) onCambiar(conForma(borrador, forma));
          }}
        />
        {conCaidaForma && (
          <div className="space-y-1.5 pt-1">
            <Interruptor
              etiqueta="Caída declarada"
              descripcion={borrador.caida_m !== undefined ? "Cuánto baja el centro respecto de los extremos: alarga la cuerda y cambia los globos." : "Sin caída, se cotiza con el largo recto."}
              activo={borrador.caida_m !== undefined}
              onCambiar={(activo) => onCambiar(conCaida(borrador, activo ? Math.max(MIN_CAIDA_M, borrador.caida_m ?? 0.3) : null))}
            />
            {borrador.caida_m !== undefined && (
              <Deslizador etiqueta="Caída en metros" valor={borrador.caida_m} min={MIN_CAIDA_M} max={MAX_CAIDA_M} paso={0.05} formato={metros} onConfirmar={(caida) => onCambiar(conCaida(borrador, caida))} testid="caida-guirnalda" />
            )}
          </div>
        )}
        {conDesnivelVisible && (
          <div className="space-y-1.5 pt-1">
            <Interruptor
              etiqueta="Un extremo más alto que el otro"
              descripcion={borrador.desnivel_m !== undefined ? `La guirnalda ${desnivelTexto(borrador)}: la cuerda es más larga y cambia los globos.` : "Los dos extremos a la misma altura."}
              activo={borrador.desnivel_m !== undefined}
              onCambiar={(activo) => onCambiar(conDesnivel(borrador, activo ? borrador.desnivel_m ?? DESNIVEL_INICIAL_M : null))}
            />
            {borrador.desnivel_m !== undefined && (
              <Deslizador etiqueta="Altura del extremo derecho respecto del izquierdo, en metros" valor={borrador.desnivel_m} min={-MAX_DESNIVEL_M} max={MAX_DESNIVEL_M} paso={0.05} formato={desnivelCorto} textoValor={desnivelLeido} onConfirmar={(desnivel) => onCambiar(conDesnivel(borrador, desnivel))} testid="desnivel-guirnalda" />
            )}
          </div>
        )}
        {conAnclajesVisibles && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[13px] font-medium text-texto">Puntos de anclaje</span>
            <Contador
              etiqueta="Puntos de anclaje"
              valor={borrador.puntos_de_anclaje ?? ANCLAJES.min}
              min={ANCLAJES.min}
              max={ANCLAJES.max}
              formato={(valor) => `${valor} puntos`}
              onCambiar={(puntos) => onCambiar(conAnclajes(borrador, puntos))}
            />
          </div>
        )}
      </Apartado>

      <Apartado titulo="Racimo" ayuda="La unidad que se encadena de izquierda a derecha y el tamaño de sus globos.">
        <div className="flex flex-wrap gap-2">
          <Segmentado<UnidadRacimoGuirnalda>
            etiqueta="Unidad del racimo"
            opciones={unidades.map((unidad) => ({ valor: unidad, etiqueta: mayuscula(NOMBRE_UNIDAD[unidad].singular) }))}
            valor={borrador.racimo.unidad}
            onCambiar={(unidad) => {
              if (unidad !== borrador.racimo.unidad) onCambiar(conRacimo(borrador, { unidad }));
            }}
          />
          <Segmentado<`${ArmadoGuirnaldaV1["racimo"]["tamano_pulg_base"]}`>
            etiqueta="Tamaño de los globos del racimo"
            opciones={tamanos.map((tamano) => ({ valor: `${tamano}` as const, etiqueta: `${tamano}″` }))}
            valor={`${borrador.racimo.tamano_pulg_base}`}
            onCambiar={(texto) => {
              const tamano = Number(texto) as ArmadoGuirnaldaV1["racimo"]["tamano_pulg_base"];
              if (tamano !== borrador.racimo.tamano_pulg_base) onCambiar(conRacimo(borrador, { tamano_pulg_base: tamano }));
            }}
          />
        </div>
      </Apartado>

      <Apartado titulo="Relleno" ayuda="Globos chicos entre los racimos; salen de la mezcla, no se compran aparte.">
        <Interruptor
          etiqueta="Relleno entre racimos"
          activo={borrador.relleno !== null}
          deshabilitado={borrador.relleno === null && materialesRelleno.length === 0}
          descripcion={borrador.relleno === null && materialesRelleno.length === 0 ? "Esta mezcla no trae globos chicos para rellenar." : undefined}
          onCambiar={(activo) => onCambiar(conRelleno(borrador, activo ? { material: materialesRelleno[0]!, proporcion: PROPORCION_RELLENO_INICIAL } : null))}
        />
        {borrador.relleno && (
          <div className="space-y-2">
            <SelectorColor
              etiqueta="Color del relleno"
              leyenda={coloresDe(materialesRelleno, borrador.relleno.material)}
              valor={borrador.relleno.material}
              onCambiar={(material) => onCambiar(conRelleno(borrador, { ...borrador.relleno!, material }))}
            />
            <Deslizador etiqueta="Parte de los globos que va de relleno" valor={borrador.relleno.proporcion} min={0.01} max={MAX_PROPORCION_RELLENO} paso={0.01} formato={(valor) => porcentaje.format(valor)} onConfirmar={(proporcion) => onCambiar(conRelleno(borrador, { ...borrador.relleno!, proporcion }))} testid="proporcion-relleno-guirnalda" />
          </div>
        )}
      </Apartado>

      <Apartado
        titulo="Remates"
        ayuda="Globos grandes sobre la guirnalda. Arrastra uno a un racimo de la gráfica, o pulsa Mover y elige el racimo con las flechas: el primero es el extremo izquierdo, el último el derecho, el del centro va al centro y otro lo reparte a lo largo."
        accion={
          <button
            type="button"
            disabled={borrador.remates.length >= MAXIMO_REMATES || materialesRemate.length === 0}
            onClick={() => {
              const siguiente = agregarRemate(borrador, materialesRemate[0]!);
              if (siguiente) onCambiar(siguiente);
            }}
            data-testid="agregar-remate-guirnalda"
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento disabled:opacity-40"
          >
            <Plus className="size-3.5" aria-hidden="true" />Agregar
          </button>
        }
      >
        {borrador.remates.length === 0 ? (
          <p className="text-xs text-texto-suave">Sin remates.</p>
        ) : (
          <ol className="space-y-2" aria-label="Remates de la guirnalda">
            {borrador.remates.map((remate, indice) => {
              const elegido = moviendo === indice;
              const nombre = `el remate ${indice + 1} (${nombreColor(remate.material)})`;
              return (
                <li key={indice} data-testid="remate-guirnalda" className={`space-y-2 rounded-xl p-2 ring-1 ring-inset ${elegido ? "bg-acento-suave ring-acento" : "bg-superficie ring-borde-suave"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      ref={registrarMover?.(indice)}
                      type="button"
                      aria-pressed={elegido}
                      aria-label={elegido ? `Cancelar: no mover ${nombre}` : `Mover ${nombre} a un racimo`}
                      title="Arrástralo a un racimo de la gráfica, o púlsalo y elige el racimo"
                      onClick={() => onMover(elegido ? null : indice)}
                      onPointerDown={(evento) => onArrastrar(indice, evento)}
                      data-testid="mover-remate-guirnalda"
                      style={{ touchAction: "none" }}
                      className="inline-flex h-8 cursor-grab items-center gap-1 rounded-lg px-2 text-xs font-semibold text-texto ring-1 ring-borde ring-inset hover:bg-superficie-2 focus-visible:outline-2 focus-visible:outline-acento active:cursor-grabbing"
                    >
                      <GripVertical className="size-3.5" aria-hidden="true" />{elegido ? "Elige el racimo…" : `Remate ${indice + 1}`}
                    </button>
                    <span className="min-w-0 flex-1 text-xs text-texto-suave">{NOMBRE_POSICION[remate.posicion]}</span>
                    <button type="button" aria-label={`Quitar ${nombre}`} onClick={() => onCambiar(quitarRemate(borrador, indice))} className="grid size-8 place-items-center rounded-lg text-texto-suave hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-acento">
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <SelectorColor
                    etiqueta={`Color del remate ${indice + 1}`}
                    leyenda={coloresDe(materialesRemate, remate.material)}
                    valor={remate.material}
                    onCambiar={(material) => onCambiar(conRemate(borrador, indice, { material }))}
                  />
                  <Segmentado<PosicionRemateGuirnalda>
                    etiqueta={`Dónde va el remate ${indice + 1}`}
                    opciones={POSICIONES_REMATE_GUIRNALDA.map((posicion) => ({ valor: posicion, etiqueta: NOMBRE_POSICION[posicion] }))}
                    valor={remate.posicion}
                    onCambiar={(posicion) => {
                      if (posicion !== remate.posicion) onCambiar(conRemate(borrador, indice, { posicion }));
                    }}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </Apartado>
    </div>
  );
}
