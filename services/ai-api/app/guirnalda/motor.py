"""Fachada del motor de guirnalda: delega todo en el motor orgánico compartido.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/guirnalda/motor.ts``.

Lo único propio es el encuadre: un lienzo **horizontal** de 760 × 440 con la regla a la izquierda y, si se
pide, la persona de 1,70 m. La separación entre ``disposicion_guir`` (dónde va cada globo) y ``pintar_guir``
(de qué color y cómo se ve) es la que hace que cambiar un color repinte sin volver a acomodar nada.
"""

from __future__ import annotations

from app.guirnalda.espina import crear_espina_guirnalda
from app.guirnalda.tipos import ConfigGuir
from app.organico.motor import Disposicion, OpcionesPintado, ResultadoOrg, crear_disposicion_en, pintar

#: Lienzo horizontal en el que se dibuja la guirnalda.
LIENZO_GUIR = {"w": 760, "h": 440}


def disposicion_guir(cfg: ConfigGuir) -> Disposicion:
    """Dónde queda cada globo de la guirnalda (no depende de los colores)."""
    return crear_disposicion_en(cfg, lambda fase: crear_espina_guirnalda(cfg, fase))


def pintar_guir(cfg: ConfigGuir, disp: Disposicion) -> ResultadoOrg:
    """Colores, adornos, persona y regla sobre una disposición ya calculada."""
    persona = cfg["forma"]["persona"]
    return pintar(
        cfg,
        disp,
        OpcionesPintado(
            lienzo=LIENZO_GUIR,
            referencia={
                "persona": persona,
                # Con persona la guirnalda se corre a la derecha para dejarle sitio.
                "centro": 440 if persona else 400,
                "mitad": 285 if persona else 330,
                "personaX": 96,
                "reglaX": 34,
                "margenAbajo": 40,
            },
        ),
    )


def pintar_miniatura(cfg: ConfigGuir, disp: Disposicion) -> ResultadoOrg:
    """Miniatura: solo la guirnalda, encuadrada sobre lo que ocupa, sin persona ni regla ni adornos."""
    recortada = {**cfg, "forma": {**cfg["forma"], "suelo": False}, "adornos": {"follaje": 0, "flores": 0}}
    return pintar(recortada, disp, OpcionesPintado(lienzo=LIENZO_GUIR, ajustar=True))


def generar_guir(cfg: ConfigGuir) -> ResultadoOrg:
    """Acomoda y pinta una guirnalda de una sola vez."""
    return pintar_guir(cfg, disposicion_guir(cfg))
