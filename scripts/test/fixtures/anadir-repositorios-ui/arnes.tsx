/**
 * Arnés del navegador para `test-anadir-repositorios-ui.ts`: monta el panel «Añadir» REAL (`PanelAnadir`) como lo monta `Taller3D`
 * —a la izquierda en el escritorio, dentro de la hoja inferior (`HojaMovil`) en el teléfono— con la escena en el historial
 * REAL (`useHistorialEscena`, con el `agrupar: "panel"` de `cambiarDesdePanel`) y su botón «Deshacer». Lo único falso es el motor
 * de la biblioteca (`biblioteca-cliente-falsa.ts`) y que «una pieza nueva» solo se suma a la escena (el taller además abre su editor).
 */
import { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { TablaProductos } from "../../../../src/components/tres-d/Biblioteca";
import { HojaMovil, type AlturaHoja } from "../../../../src/components/tres-d/HojaMovil";
import type { PiezaParaAnadir } from "../../../../src/components/tres-d/nuevas-taller";
import { PanelAnadir } from "../../../../src/components/tres-d/PanelAnadir";
import { ProcedenciaDeItem } from "../../../../src/components/tres-d/ProcedenciaDeItem";
import { useHistorialEscena } from "../../../../src/components/tres-d/useEdicionEscena";
import { useEstadoAnadir } from "../../../../src/components/tres-d/useEstadoAnadir";
import { BIBLIOTECA_FABRICA, itemDeEscena, productosDe } from "../../../../src/lib/globos3d/biblioteca";
import { armarEscena, idNuevo, SALA_INICIAL, type Escena } from "../../../../src/lib/globos3d/escena";
import { entradaDeCatalogo } from "../../../../src/lib/globos3d/fondos-escenografia";
import { piezaDeEntrada } from "../../../../src/lib/globos3d/mobiliario-pieza";

declare global {
  interface Window {
    __montarAnadir: (opciones: { movil: boolean }) => void;
    __montarLista: () => void;
  }
}

const escenaVacia = (): Escena => ({ sala: structuredClone(SALA_INICIAL), nodos: [] });

function Taller({ movil }: { movil: boolean }) {
  const historial = useHistorialEscena(escenaVacia);
  const anadir = useEstadoAnadir();
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [hoja, setHoja] = useState<AlturaHoja>("media");
  const armada = useMemo(() => armarEscena(historial.escena), [historial.escena]);
  const cambiarDesdePanel = useCallback((e: Escena) => historial.cambiar(e, { agrupar: "panel" }), [historial]);
  const sumarNueva = useCallback((p: PiezaParaAnadir) => {
    const escena = historial.escena;
    const id = idNuevo(escena, p.idBase);
    historial.cambiar({ ...escena, nodos: [...escena.nodos, { id, nombre: p.nombre, pieza: structuredClone(p.pieza), colocacion: p.colocacion }] });
    setSeleccion(id);
  }, [historial]);

  const panel = (
    <PanelAnadir escena={historial.escena} armada={armada} onEscena={cambiarDesdePanel} seleccion={seleccion} onSeleccion={setSeleccion}
      pestana={anadir.pestana} onPestana={anadir.setPestana} eleccion={anadir.eleccion} onEleccion={anadir.setEleccion} onNueva={sumarNueva} onFicha={() => {}} enHoja={movil} />
  );
  const escena = (
    <div className="flex flex-col gap-2 p-3 text-sm text-taller-texto">
      <div className="flex items-center gap-2">
        <button type="button" onClick={historial.deshacer} disabled={!historial.puedeDeshacer} aria-label="Deshacer" className="min-h-11 rounded-lg border border-taller-borde px-3">Deshacer</button>
        <button type="button" data-testid="colgar-otra" onClick={anadir.pedirDecoraciones} className="min-h-11 rounded-lg border border-taller-borde px-3">Colgar otra (pide Decoraciones)</button>
      </div>
      <p>En la escena: <b data-testid="cuantas">{historial.escena.nodos.length}</b></p>
      <ul data-testid="escena" className="list-disc pl-5">{historial.escena.nodos.map((n) => <li key={n.id}>{n.nombre}</li>)}</ul>
    </div>
  );

  if (!movil) {
    return (
      <div className="taller-3d fixed inset-0 flex overflow-hidden font-sans">
        <aside aria-label="Panel Añadir" className="flex min-h-0 w-[380px] shrink-0 flex-col border-r border-taller-borde bg-taller-panel">{panel}</aside>
        <main className="min-w-0 flex-1 overflow-auto">{escena}</main>
      </div>
    );
  }
  return (
    <div className="taller-3d fixed inset-0 overflow-hidden font-sans">
      <main className="h-full overflow-auto">{escena}</main>
      <HojaMovil hoja={hoja} alCambiarAltura={(paso) => setHoja((h) => (paso > 0 ? (h === "cerrada" ? "media" : "alta") : (h === "alta" ? "media" : "cerrada")))} alEscribir={() => setHoja("alta")}
        pestanas={[{ id: "anadir", nombre: "Añadir", icono: null }]} activa="anadir" alElegir={() => {}}>
        {panel}
      </HojaMovil>
    </div>
  );
}

const MUEBLES_DE_LA_LISTA = ["silla_tiffany", "mesa_redonda", "sofa", "panel_redondo", "base_pastel"] as const;

/** La lista de compra de una escena con mobiliario y escenografía del catálogo, y la ficha de una idea de Sempertex: lo que pinta el taller con el hook de cada una. */
function ListaDeCompra() {
  const item = useMemo(() => itemDeEscena({
    id: "vista:escena-actual", nombre: "Prueba", ocasiones: ["general"],
    escena: {
      sala: structuredClone(SALA_INICIAL),
      nodos: MUEBLES_DE_LA_LISTA.map((id, i) => ({ id, nombre: entradaDeCatalogo(id)!.nombre, pieza: piezaDeEntrada(entradaDeCatalogo(id)!), colocacion: { en: "piso" as const, xCm: i * 100, zCm: 0, giroGrados: 0 } })),
    },
  }), []);
  const productos = useMemo(() => productosDe(item), [item]);
  return (
    <div className="flex max-w-3xl flex-col gap-3 p-3">
      <TablaProductos item={item} productos={productos} />
      <p>Ficha de una idea de Sempertex: <ProcedenciaDeItem item={BIBLIOTECA_FABRICA[0]!} /></p>
    </div>
  );
}

window.__montarLista = () => {
  createRoot(document.getElementById("raiz") as HTMLElement).render(<ListaDeCompra />);
};

window.__montarAnadir = ({ movil }) => {
  createRoot(document.getElementById("raiz") as HTMLElement).render(<Taller movil={movil} />);
};
