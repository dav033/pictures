"use client";

import { Plus, Shuffle, X } from "lucide-react";
import { ANCLAS_ZONA, EXTENSION_ZONA_MAXIMA, ZONAS_MAXIMAS, type AnclaZona, type BasePatronColor, type PatronColor } from "@/lib/plan/patron-color";
import { editar } from "./borrador";
import type { ColorLeyenda } from "./leyenda";
import { ETIQUETA_ANCLA } from "./modos";
import { Apartado, Contador, Interruptor, Segmentado, SelectorColor } from "./controles-comunes";

export type CambioPatron = (patron: PatronColor, grupo?: string) => void;

type Props = {
  patron: PatronColor;
  leyenda: readonly ColorLeyenda[];
  geometria: "racimos" | "rejilla";
  onCambiar: CambioPatron;
  deshabilitado?: boolean;
};

const botonAnadir = "inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento disabled:opacity-40";
const botonQuitar = "grid size-8 shrink-0 place-items-center rounded-lg text-texto-suave hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-acento";

/** Un color que todavía no está en la lista, o el siguiente de la leyenda. */
function colorNuevo(usados: readonly number[], leyenda: readonly ColorLeyenda[]): number {
  const libre = leyenda.find((color) => !usados.includes(color.indice));
  if (libre) return libre.indice;
  const ultimo = usados[usados.length - 1] ?? -1;
  return leyenda.length ? (ultimo + 1) % leyenda.length : 0;
}

/** Una fila de una lista de colores: nombre, selector, peso opcional y quitar. */
function FilaColor({ nombre, valor, leyenda, onColor, peso, onPeso, onQuitar, deshabilitado }: {
  nombre: string;
  valor: number;
  leyenda: readonly ColorLeyenda[];
  onColor: (indice: number) => void;
  peso?: number;
  onPeso?: (peso: number) => void;
  onQuitar?: () => void;
  deshabilitado?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-superficie px-2.5 py-2 ring-1 ring-borde-suave ring-inset">
      <span className="w-[4.5rem] shrink-0 text-xs font-medium text-texto-suave">{nombre}</span>
      <SelectorColor leyenda={leyenda} valor={valor} onCambiar={onColor} etiqueta={`Color de ${nombre.toLowerCase()}`} deshabilitado={deshabilitado} />
      {peso !== undefined && onPeso && (
        <label className="flex min-w-[8rem] flex-1 items-center gap-2 text-xs text-texto-suave">
          <span className="sr-only">Cuánto pesa {nombre.toLowerCase()}</span>
          <input type="range" min={1} max={100} value={peso} disabled={deshabilitado} onChange={(evento) => onPeso(Number(evento.target.value))} className="min-w-0 flex-1 accent-[var(--acento)]" />
          <output className="w-7 text-right tabular-nums text-texto">{peso}</output>
        </label>
      )}
      {onQuitar && (
        <button type="button" aria-label={`Quitar ${nombre.toLowerCase()}`} onClick={onQuitar} disabled={deshabilitado} className={`${botonQuitar} ml-auto`}>
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

type Zona = Extract<BasePatronColor, { modo: "zonas" }>["zonas"][number];

/** El primer ancla que todavía no tiene mancha, o el centro si todas están. */
function anclaLibre(zonas: readonly Zona[]): AnclaZona {
  const usadas = new Set(zonas.map((zona) => zona.ancla));
  return ANCLAS_ZONA.find((ancla) => !usadas.has(ancla)) ?? "centro";
}

/**
 * Una zona del modo `zonas`: su color, dónde se agrupa y cuánto de la pieza
 * ocupa. El tope de la extensión y el de las zonas son los del contrato; qué
 * suma admite el patrón lo dice la vista previa de Python, no este control.
 */
function FilaZona({ nombre, zona, leyenda, onCambiar, onQuitar, deshabilitado }: {
  nombre: string;
  zona: Zona;
  leyenda: readonly ColorLeyenda[];
  onCambiar: (zona: Zona) => void;
  onQuitar?: () => void;
  deshabilitado?: boolean;
}) {
  return (
    <li className="space-y-1.5 rounded-xl bg-superficie px-2.5 py-2 ring-1 ring-borde-suave ring-inset">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="w-[4.5rem] shrink-0 text-xs font-medium text-texto-suave">{nombre}</span>
        <SelectorColor leyenda={leyenda} valor={zona.material} onCambiar={(material) => onCambiar({ ...zona, material })} etiqueta={`Color de ${nombre.toLowerCase()}`} deshabilitado={deshabilitado} />
        <label className="flex items-center gap-2 text-xs text-texto-suave">
          <span className="sr-only">Dónde se agrupa {nombre.toLowerCase()}</span>
          <select value={zona.ancla} disabled={deshabilitado} onChange={(evento) => onCambiar({ ...zona, ancla: evento.target.value as AnclaZona })} className="h-8 rounded-lg bg-fondo px-2 text-xs text-texto ring-1 ring-borde-suave ring-inset focus-visible:outline-2 focus-visible:outline-acento disabled:opacity-40">
            {ANCLAS_ZONA.map((ancla) => <option key={ancla} value={ancla}>{ETIQUETA_ANCLA[ancla]}</option>)}
          </select>
        </label>
        {onQuitar && (
          <button type="button" aria-label={`Quitar ${nombre.toLowerCase()}`} onClick={onQuitar} disabled={deshabilitado} className={`${botonQuitar} ml-auto`}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs text-texto-suave">
        <span className="shrink-0">Cuánto ocupa</span>
        <input type="range" min={1} max={EXTENSION_ZONA_MAXIMA} value={zona.extension} disabled={deshabilitado} onChange={(evento) => onCambiar({ ...zona, extension: Number(evento.target.value) })} className="min-w-0 flex-1 accent-[var(--acento)]" />
        <output className="w-9 text-right tabular-nums text-texto">{zona.extension} %</output>
      </label>
    </li>
  );
}

/**
 * Parámetros del modo del patrón. Cada control produce un patrón declarativo
 * nuevo; la vista previa de Python dice cómo queda y si es válido.
 */
export function ParametrosModo({ patron, leyenda, geometria, onCambiar, deshabilitado = false }: Props) {
  const base = patron.base;
  const unidad = geometria === "rejilla" ? "filas" : "racimos";
  const conBase = (siguiente: BasePatronColor, grupo?: string) => onCambiar(editar(patron, { base: siguiente }), grupo);
  const reemplazar = <T,>(lista: readonly T[], posicion: number, valor: T): T[] => lista.map((item, indice) => (indice === posicion ? valor : item));
  const quitar = <T,>(lista: readonly T[], posicion: number): T[] => lista.filter((_, indice) => indice !== posicion);

  switch (base.modo) {
    case "espiral":
      return (
        <>
          <Apartado titulo="Cómo gira" ayuda="Cada capa se corre un poco: así se forma la espiral">
            <Segmentado
              etiqueta="Trazo"
              valor={base.trazo}
              onCambiar={(trazo) => conBase({ ...base, trazo })}
              deshabilitado={deshabilitado}
              opciones={[{ valor: "espiral", etiqueta: "Espiral" }, { valor: "zigzag", etiqueta: "Zig-zag" }, { valor: "recto", etiqueta: "Franjas rectas" }]}
            />
          </Apartado>
          <Apartado titulo="Colores del racimo" ayuda="Todos los racimos son iguales; así va cada posición">
            <ol className="space-y-1.5">
              {base.racimo.map((material, posicion) => (
                <FilaColor key={posicion} nombre={`Posición ${posicion + 1}`} valor={material} leyenda={leyenda} deshabilitado={deshabilitado} onColor={(indice) => conBase({ ...base, racimo: reemplazar(base.racimo, posicion, indice) })} />
              ))}
            </ol>
          </Apartado>
        </>
      );
    case "anillos":
      return (
        <>
          <Apartado titulo="Orden de los anillos" ayuda={`Cada ${unidad === "filas" ? "fila" : "racimo"} de un solo color, en este orden, y vuelve a empezar`}>
            <ol className="space-y-1.5">
              {base.secuencia.map((material, posicion) => (
                <FilaColor key={posicion} nombre={`Anillo ${posicion + 1}`} valor={material} leyenda={leyenda} deshabilitado={deshabilitado}
                  onColor={(indice) => conBase({ ...base, secuencia: reemplazar(base.secuencia, posicion, indice) })}
                  onQuitar={base.secuencia.length > 1 ? () => conBase({ ...base, secuencia: quitar(base.secuencia, posicion) }) : undefined} />
              ))}
            </ol>
            <button type="button" className={botonAnadir} disabled={deshabilitado || base.secuencia.length >= 12} onClick={() => conBase({ ...base, secuencia: [...base.secuencia, colorNuevo(base.secuencia, leyenda)] })}>
              <Plus className="size-3.5" aria-hidden="true" />Añadir anillo
            </button>
          </Apartado>
          <Apartado titulo={`${unidad === "filas" ? "Filas" : "Racimos"} de cada color`}>
            <Contador etiqueta={`${unidad} seguidos de cada color`} valor={base.largo} min={1} max={24} deshabilitado={deshabilitado} onCambiar={(largo) => conBase({ ...base, largo })} formato={(valor) => `${valor} ${valor === 1 ? unidad.slice(0, -1) : unidad}`} />
          </Apartado>
        </>
      );
    case "bloques":
      return (
        <Apartado titulo="Bloques de color" ayuda="Tramos seguidos, en este orden; el deslizador dice cuánto ocupa cada uno">
          <ol className="space-y-1.5">
            {base.bloques.map((bloque, posicion) => (
              <FilaColor key={posicion} nombre={`Bloque ${posicion + 1}`} valor={bloque.material} leyenda={leyenda} deshabilitado={deshabilitado} peso={bloque.peso}
                onColor={(indice) => conBase({ ...base, bloques: reemplazar(base.bloques, posicion, { ...bloque, material: indice }) })}
                onPeso={(peso) => conBase({ ...base, bloques: reemplazar(base.bloques, posicion, { ...bloque, peso }) }, `peso-bloque-${posicion}`)}
                onQuitar={base.bloques.length > 2 ? () => conBase({ ...base, bloques: quitar(base.bloques, posicion) }) : undefined} />
            ))}
          </ol>
          <button type="button" className={botonAnadir} disabled={deshabilitado || base.bloques.length >= 12} onClick={() => conBase({ ...base, bloques: [...base.bloques, { material: colorNuevo(base.bloques.map((bloque) => bloque.material), leyenda), peso: 25 }] })}>
            <Plus className="size-3.5" aria-hidden="true" />Añadir bloque
          </button>
        </Apartado>
      );
    case "degradado":
      return (
        <>
          <Apartado titulo="Colores del degradé" ayuda="Del primero al último, pasando por los del medio">
            <ol className="space-y-1.5">
              {base.paradas.map((material, posicion) => (
                <FilaColor key={posicion} nombre={posicion === 0 ? "Empieza" : posicion === base.paradas.length - 1 ? "Termina" : `Pasa por`} valor={material} leyenda={leyenda} deshabilitado={deshabilitado}
                  onColor={(indice) => conBase({ ...base, paradas: reemplazar(base.paradas, posicion, indice) })}
                  onQuitar={base.paradas.length > 2 ? () => conBase({ ...base, paradas: quitar(base.paradas, posicion) }) : undefined} />
              ))}
            </ol>
            <button type="button" className={botonAnadir} disabled={deshabilitado || base.paradas.length >= 6} onClick={() => conBase({ ...base, paradas: [...base.paradas, colorNuevo(base.paradas, leyenda)] })}>
              <Plus className="size-3.5" aria-hidden="true" />Añadir color
            </button>
          </Apartado>
          <Apartado titulo="Transición">
            <Segmentado etiqueta="Transición del degradé" valor={base.transicion} deshabilitado={deshabilitado} onCambiar={(transicion) => conBase({ ...base, transicion })}
              opciones={[{ valor: "suave", etiqueta: "Suave, mezclada" }, { valor: "escalonada", etiqueta: "Escalonada" }]} />
          </Apartado>
        </>
      );
    case "aleatorio":
      return (
        <Apartado
          titulo="Confeti"
          ayuda="Mezcla orgánica: el deslizador dice cuánto lleva de cada color"
          accion={
            <button type="button" className={botonAnadir} disabled={deshabilitado} onClick={() => conBase({ ...base, semilla: (base.semilla + 1) % 2147483647 })}>
              <Shuffle className="size-3.5" aria-hidden="true" />Re-mezclar
            </button>
          }
        >
          <ol className="space-y-1.5">
            {base.pesos.map((entrada, posicion) => (
              <FilaColor key={posicion} nombre={`Color ${posicion + 1}`} valor={entrada.material} leyenda={leyenda} deshabilitado={deshabilitado} peso={entrada.peso}
                onColor={(indice) => conBase({ ...base, pesos: reemplazar(base.pesos, posicion, { ...entrada, material: indice }) })}
                onPeso={(peso) => conBase({ ...base, pesos: reemplazar(base.pesos, posicion, { ...entrada, peso }) }, `peso-confeti-${posicion}`)}
                onQuitar={base.pesos.length > 1 ? () => conBase({ ...base, pesos: quitar(base.pesos, posicion) }) : undefined} />
            ))}
          </ol>
          <button type="button" className={botonAnadir} disabled={deshabilitado || base.pesos.length >= 6} onClick={() => conBase({ ...base, pesos: [...base.pesos, { material: colorNuevo(base.pesos.map((entrada) => entrada.material), leyenda), peso: 20 }] })}>
            <Plus className="size-3.5" aria-hidden="true" />Añadir color
          </button>
        </Apartado>
      );
    case "flor":
      return (
        <>
          <Apartado titulo="Flores" ayuda="Tres racimos de pétalos con un globo al centro, entre racimos de fondo">
            <ul className="space-y-1.5">
              <FilaColor nombre="Fondo" valor={base.fondo} leyenda={leyenda} deshabilitado={deshabilitado} onColor={(fondo) => conBase({ ...base, fondo })} />
              <FilaColor nombre="Pétalos" valor={base.petalo} leyenda={leyenda} deshabilitado={deshabilitado} onColor={(petalo) => conBase({ ...base, petalo })} />
              <FilaColor nombre="Centro" valor={base.centro} leyenda={leyenda} deshabilitado={deshabilitado} onColor={(centro) => conBase({ ...base, centro })} />
            </ul>
          </Apartado>
          <Apartado titulo="Separación entre flores">
            <Contador etiqueta="Racimos de fondo entre flores" valor={base.separacion} min={1} max={6} deshabilitado={deshabilitado} onCambiar={(separacion) => conBase({ ...base, separacion })} formato={(valor) => `${valor} ${valor === 1 ? "racimo" : "racimos"} de fondo`} />
          </Apartado>
        </>
      );
    case "zonas":
      return (
        <>
          <Apartado titulo="Color del fondo" ayuda="Rellena todo lo que no sea una zona">
            <ol className="space-y-1.5">
              <FilaColor nombre="Fondo" valor={base.fondo} leyenda={leyenda} deshabilitado={deshabilitado} onColor={(indice) => conBase({ ...base, fondo: indice })} />
            </ol>
          </Apartado>
          <Apartado titulo="Zonas de color" ayuda="Cada zona es una mancha compacta; repite un color para ponerlo en varios sitios">
            <ol className="space-y-1.5">
              {base.zonas.map((zona, posicion) => (
                <FilaZona
                  key={posicion}
                  nombre={`Zona ${posicion + 1}`}
                  zona={zona}
                  leyenda={leyenda}
                  deshabilitado={deshabilitado}
                  onCambiar={(siguiente) => conBase({ ...base, zonas: reemplazar(base.zonas, posicion, siguiente) }, `zona-${posicion}`)}
                  onQuitar={base.zonas.length > 1 ? () => conBase({ ...base, zonas: quitar(base.zonas, posicion) }) : undefined}
                />
              ))}
            </ol>
            <button type="button" className={botonAnadir} disabled={deshabilitado || base.zonas.length >= ZONAS_MAXIMAS} onClick={() => conBase({ ...base, zonas: [...base.zonas, { material: colorNuevo([base.fondo, ...base.zonas.map((zona) => zona.material)], leyenda), ancla: anclaLibre(base.zonas), extension: 10 }] })}>
              <Plus className="size-3.5" aria-hidden="true" />Añadir zona
            </button>
          </Apartado>
        </>
      );
    case "intercalado":
      return (
        <>
          <Apartado titulo="Colores que se turnan" ayuda="Se alternan globo a globo; ninguno queda junto a otro de su color">
            <ol className="space-y-1.5">
              {base.secuencia.map((material, posicion) => (
                <FilaColor key={posicion} nombre={`Color ${posicion + 1}`} valor={material} leyenda={leyenda} deshabilitado={deshabilitado}
                  onColor={(indice) => conBase({ ...base, secuencia: reemplazar(base.secuencia, posicion, indice) })}
                  onQuitar={base.secuencia.length > 2 ? () => conBase({ ...base, secuencia: quitar(base.secuencia, posicion) }) : undefined} />
              ))}
            </ol>
            <button type="button" className={botonAnadir} disabled={deshabilitado || base.secuencia.length >= 4} onClick={() => conBase({ ...base, secuencia: [...base.secuencia, colorNuevo(base.secuencia, leyenda)] })}>
              <Plus className="size-3.5" aria-hidden="true" />Añadir color
            </button>
          </Apartado>
          <Apartado titulo="Cuánto corre" ayuda="Puestos que se corre el color de una fila a la siguiente">
            <Contador etiqueta="Puestos por fila" valor={base.paso} min={1} max={3} deshabilitado={deshabilitado} onCambiar={(paso) => conBase({ ...base, paso })} formato={(valor) => `${valor} ${valor === 1 ? "puesto" : "puestos"}`} />
          </Apartado>
        </>
      );
    case "franjas":
    case "zigzag":
    case "chevron":
      return (
        <>
          <Apartado titulo="Colores de la franja" ayuda="Se repiten a lo largo de la pieza">
            <ol className="space-y-1.5">
              {base.secuencia.map((material, posicion) => (
                <FilaColor key={posicion} nombre={`Franja ${posicion + 1}`} valor={material} leyenda={leyenda} deshabilitado={deshabilitado}
                  onColor={(indice) => conBase({ ...base, secuencia: reemplazar(base.secuencia, posicion, indice) })}
                  onQuitar={base.secuencia.length > 2 ? () => conBase({ ...base, secuencia: quitar(base.secuencia, posicion) }) : undefined} />
              ))}
            </ol>
            <button type="button" className={botonAnadir} disabled={deshabilitado || base.secuencia.length >= (base.modo === "franjas" ? 5 : 4)} onClick={() => conBase({ ...base, secuencia: [...base.secuencia, colorNuevo(base.secuencia, leyenda)] })}>
              <Plus className="size-3.5" aria-hidden="true" />Añadir franja
            </button>
          </Apartado>
          <Apartado titulo="Grosor de la franja">
            <Contador etiqueta="Globos de ancho" valor={base.ancho} min={0.5} max={6} paso={0.5} deshabilitado={deshabilitado} onCambiar={(ancho) => conBase({ ...base, ancho })} formato={(valor) => `${valor} ${valor === 1 ? "globo" : "globos"}`} />
          </Apartado>
          {base.modo === "franjas" ? (
            <Apartado titulo="Inclinación" ayuda="0 las deja rectas de través; el signo cambia el lado por el que suben">
              <Contador etiqueta="Inclinación de la franja" valor={base.inclinacion} min={-3} max={3} paso={0.5} deshabilitado={deshabilitado} onCambiar={(inclinacion) => conBase({ ...base, inclinacion })} formato={(valor) => `${valor}`} />
            </Apartado>
          ) : null}
          {base.modo === "zigzag" ? (
            <>
              <Apartado titulo="Altura del quiebre" ayuda="Cuánto sube y baja cada quiebre, en filas">
                <Contador etiqueta="Altura del zigzag" valor={base.amplitud} min={0} max={8} paso={0.5} deshabilitado={deshabilitado} onCambiar={(amplitud) => conBase({ ...base, amplitud })} formato={(valor) => `${valor}`} />
              </Apartado>
              <Apartado titulo="Largo del quiebre" ayuda="Globos que tarda en cambiar de dirección">
                <Contador etiqueta="Largo del zigzag" valor={base.periodo} min={1} max={8} paso={0.5} deshabilitado={deshabilitado} onCambiar={(periodo) => conBase({ ...base, periodo })} formato={(valor) => `${valor}`} />
              </Apartado>
            </>
          ) : null}
          {base.modo === "chevron" ? (
            <>
              <Apartado titulo="Apertura de la V">
                <Contador etiqueta="Apertura de la flecha" valor={base.inclinacion} min={0} max={4} paso={0.5} deshabilitado={deshabilitado} onCambiar={(inclinacion) => conBase({ ...base, inclinacion })} formato={(valor) => `${valor}`} />
              </Apartado>
              <Apartado titulo="Dirección">
                <Interruptor etiqueta="Invertir la punta" activo={base.invertir} deshabilitado={deshabilitado} onCambiar={(invertir) => conBase({ ...base, invertir })} descripcion="La punta de la flecha mira al otro lado" />
              </Apartado>
            </>
          ) : null}
        </>
      );
    case "diamante":
      return (
        <>
          <Apartado titulo="Colores del rombo">
            <ol className="space-y-1.5">
              <FilaColor nombre="Fondo" valor={base.fondo} leyenda={leyenda} deshabilitado={deshabilitado} onColor={(fondo) => conBase({ ...base, fondo })} />
              <FilaColor nombre="Contorno" valor={base.contorno} leyenda={leyenda} deshabilitado={deshabilitado} onColor={(contorno) => conBase({ ...base, contorno })} />
              <FilaColor nombre="Centro" valor={base.centro} leyenda={leyenda} deshabilitado={deshabilitado} onColor={(centro) => conBase({ ...base, centro })} />
            </ol>
          </Apartado>
          <Apartado titulo="Cada cuánto aparece">
            <Contador etiqueta="Separación entre rombos" valor={base.separacion} min={4} max={16} deshabilitado={deshabilitado} onCambiar={(separacion) => conBase({ ...base, separacion })} formato={(valor) => `${valor} filas`} />
          </Apartado>
          <Apartado titulo="Tamaño del rombo">
            <Contador etiqueta="Tamaño del rombo" valor={base.radio} min={0.8} max={5} paso={0.2} deshabilitado={deshabilitado} onCambiar={(radio) => conBase({ ...base, radio })} formato={(valor) => `${valor}`} />
          </Apartado>
          <Apartado titulo="Alargado" ayuda="Más de 1 lo aplasta a lo largo de la pieza">
            <Contador etiqueta="Alargado del rombo" valor={base.aspecto} min={0.5} max={1.8} paso={0.1} deshabilitado={deshabilitado} onCambiar={(aspecto) => conBase({ ...base, aspecto })} formato={(valor) => `${valor}`} />
          </Apartado>
        </>
      );
    case "punteado":
      return (
        <>
          <Apartado titulo="Colores">
            <ol className="space-y-1.5">
              <FilaColor nombre="Fondo" valor={base.fondo} leyenda={leyenda} deshabilitado={deshabilitado} onColor={(fondo) => conBase({ ...base, fondo })} />
              <FilaColor nombre="Lunar" valor={base.punto} leyenda={leyenda} deshabilitado={deshabilitado} onColor={(punto) => conBase({ ...base, punto })} />
            </ol>
          </Apartado>
          <Apartado titulo="Separación entre hileras">
            <Contador etiqueta="Separación entre hileras de lunares" valor={base.separacion} min={2} max={12} deshabilitado={deshabilitado} onCambiar={(separacion) => conBase({ ...base, separacion })} formato={(valor) => `${valor} filas`} />
          </Apartado>
          <Apartado titulo="Lunares de la hilera">
            <Contador etiqueta="Un lunar cada tantos globos" valor={base.cada} min={1} max={4} deshabilitado={deshabilitado} onCambiar={(cada) => conBase({ ...base, cada })} formato={(valor) => (valor === 1 ? "todos" : `cada ${valor}`)} />
          </Apartado>
          <Apartado titulo="Escalonar">
            <Interruptor etiqueta="Escalonar los lunares" activo={base.escalonar} deshabilitado={deshabilitado} onCambiar={(escalonar) => conBase({ ...base, escalonar })} descripcion="Las hileras se corren para que no queden en columna" />
          </Apartado>
        </>
      );
    case "apilado":
    case "arcoiris": {
      const lista = base.modo === "apilado" ? base.capas : base.bandas;
      const minimo = base.modo === "apilado" ? 2 : 3;
      const maximo = base.modo === "apilado" ? 5 : 8;
      const conLista = (valores: number[]) => conBase(base.modo === "apilado" ? { ...base, capas: valores } : { ...base, bandas: valores });
      return (
        <>
          <Apartado titulo={base.modo === "apilado" ? "Capas, del borde al centro" : "Bandas, de afuera adentro"}>
            <ol className="space-y-1.5">
              {lista.map((material, posicion) => (
                <FilaColor key={posicion} nombre={`${base.modo === "apilado" ? "Capa" : "Banda"} ${posicion + 1}`} valor={material} leyenda={leyenda} deshabilitado={deshabilitado}
                  onColor={(indice) => conLista([...reemplazar(lista, posicion, indice)])}
                  onQuitar={lista.length > minimo ? () => conLista([...quitar(lista, posicion)]) : undefined} />
              ))}
            </ol>
            <button type="button" className={botonAnadir} disabled={deshabilitado || lista.length >= maximo} onClick={() => conLista([...lista, colorNuevo(lista, leyenda)])}>
              <Plus className="size-3.5" aria-hidden="true" />Añadir
            </button>
          </Apartado>
          <Apartado titulo="Orden">
            <Interruptor etiqueta="Invertir el orden" activo={base.invertir} deshabilitado={deshabilitado} onCambiar={(invertir) => conBase({ ...base, invertir })} descripcion="El primer color pasa al otro extremo" />
          </Apartado>
        </>
      );
    }
    case "doslados":
      return (
        <>
          <Apartado titulo="Los dos lados">
            <ol className="space-y-1.5">
              <FilaColor nombre="Exterior" valor={base.exterior} leyenda={leyenda} deshabilitado={deshabilitado} onColor={(exterior) => conBase({ ...base, exterior })} />
              <FilaColor nombre="Interior" valor={base.interior} leyenda={leyenda} deshabilitado={deshabilitado} onColor={(interior) => conBase({ ...base, interior })} />
            </ol>
          </Apartado>
          <Apartado titulo="Dónde cambia" ayuda="A lo ancho de la banda: menos deja más interior, más deja más exterior">
            <Contador etiqueta="Posición del corte" valor={base.corte} min={0.2} max={0.8} paso={0.05} deshabilitado={deshabilitado} onCambiar={(corte) => conBase({ ...base, corte })} formato={(valor) => `${Math.round(valor * 100)} %`} />
          </Apartado>
          <Apartado titulo="Intercambiar">
            <Interruptor etiqueta="Intercambiar en la clave" activo={base.alternar} deshabilitado={deshabilitado} onCambiar={(alternar) => conBase({ ...base, alternar })} descripcion="Pasada la mitad de la pieza, los lados cambian de color" />
          </Apartado>
        </>
      );
    case "damero":
      return (
        <>
          <Apartado titulo="Colores del damero" ayuda="Con dos colores, cuadros; con tres o cuatro, bandas diagonales">
            <ol className="space-y-1.5">
              {base.secuencia.map((material, posicion) => (
                <FilaColor key={posicion} nombre={`Color ${posicion + 1}`} valor={material} leyenda={leyenda} deshabilitado={deshabilitado}
                  onColor={(indice) => conBase({ ...base, secuencia: reemplazar(base.secuencia, posicion, indice) })}
                  onQuitar={base.secuencia.length > 2 ? () => conBase({ ...base, secuencia: quitar(base.secuencia, posicion) }) : undefined} />
              ))}
            </ol>
            <button type="button" className={botonAnadir} disabled={deshabilitado || base.secuencia.length >= 4} onClick={() => conBase({ ...base, secuencia: [...base.secuencia, colorNuevo(base.secuencia, leyenda)] })}>
              <Plus className="size-3.5" aria-hidden="true" />Añadir color
            </button>
          </Apartado>
          <Apartado titulo="Tamaño del cuadro">
            <Contador etiqueta="Globos por lado de cada cuadro" valor={base.tamano} min={1} max={4} deshabilitado={deshabilitado} onCambiar={(tamano) => conBase({ ...base, tamano })} formato={(valor) => `${valor} × ${valor} ${valor === 1 ? "globo" : "globos"}`} />
          </Apartado>
        </>
      );
  }
}
