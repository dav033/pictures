"""El dibujo de una estructura orgánica: el SVG tal cual lo escribe el diseñador.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/organico/dibujo.ts``.

El SVG se migra porque **lo que el cliente aprueba es cómo se ve**. Sale con el mismo sha256 que el original,
y para eso lo que importa no es la geometría (que ya viene resuelta) sino cómo se escribe cada número:
``_numero`` de ``app.motores.js`` lo hace como lo haría JavaScript dentro de una plantilla de texto, y ``_f``
redondea a dos decimales antes, igual que el ``f`` del original.

El azar del dibujo es aparte del de la colocación: cada globo, cada rama y cada flor tiene su propio
generador, sembrado con su **posición en el orden de dibujo** (no en el de colocación). Por eso el ovalado de
un globo cambia si cambia su profundidad.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.motores import mate
from app.motores.js import _maximo, _minimo, _numero, _piso, _redondear, crear_rng, mezclar

if TYPE_CHECKING:  # pragma: no cover - solo para el tipado; en ejecución lo importa el motor.
    from app.organico.motor import FlorOrg, GloboOrg, RamaOrg

LIENZO = 600

_SOMBRA = "#0a1a16"
_SUELO = "#8fa39a"
_TALLO = "#3d5c38"

_TONOS_FLOR = ["#ffffff", "#fff3e6", "#f9d5df", "#f4b6c2"]


def _f(valor: float) -> str:
    """Un número del SVG: a dos decimales y escrito como lo escribe JavaScript."""
    return str(_numero(_redondear(valor * 100) / 100))


@dataclass(slots=True)
class Marco:
    """Dónde cae el dibujo en el lienzo, en píxeles."""

    escala: float
    piso: float
    #: x en pantalla del origen (x = 0) de la estructura.
    cx: float
    #: x en pantalla del centro de lo dibujado.
    centro: float
    anchoPx: float
    w: float
    h: float
    #: Regla y persona de referencia.
    referencia: dict[str, Any] | None = None


def degradado(ident: str, color: str, acabado: str) -> str:
    """Degradado de un globo según su acabado: el reflejo queda siempre arriba a la izquierda."""
    if acabado == "cromado":
        return (
            f'<radialGradient id="{ident}" cx="0.4" cy="0.32" r="0.95" fx="0.3" fy="0.22">'
            f'<stop offset="0" stop-color="{mezclar(color, "#ffffff", 0.85)}"/>'
            f'<stop offset="0.12" stop-color="{mezclar(color, "#ffffff", 0.5)}"/>'
            f'<stop offset="0.34" stop-color="{color}"/>'
            f'<stop offset="0.58" stop-color="{mezclar(color, "#000000", 0.6)}"/>'
            f'<stop offset="0.76" stop-color="{mezclar(color, "#000000", 0.36)}"/>'
            f'<stop offset="0.92" stop-color="{mezclar(color, "#ffffff", 0.2)}"/>'
            f'<stop offset="1" stop-color="{mezclar(color, "#000000", 0.3)}"/></radialGradient>'
        )
    return (
        f'<radialGradient id="{ident}" cx="0.36" cy="0.3" r="0.85" fx="0.32" fy="0.24">'
        f'<stop offset="0" stop-color="{mezclar(color, "#ffffff", 0.42)}"/>'
        f'<stop offset="0.5" stop-color="{color}"/>'
        f'<stop offset="1" stop-color="{mezclar(color, "#000000", 0.34)}"/></radialGradient>'
    )


def dibujar(
    globos: list[GloboOrg],
    ramas: list[RamaOrg],
    flores: list[FlorOrg],
    cfg: dict[str, Any],
    m: Marco,
    capas: int,
) -> str:
    """Interior del SVG: ramas, globos y flores mezclados de atrás hacia adelante."""
    a = cfg["aspecto"]
    forma = cfg["forma"]

    def X(x: float) -> float:
        return m.cx + x * m.escala

    def Y(y: float) -> float:
        return m.piso - y * m.escala

    grad: dict[str, str] = {}

    def id_grad(color: str, acabado: str) -> str:
        ident = f"o{color[1:]}{acabado[0]}"
        if ident not in grad:
            grad[ident] = degradado(ident, color, acabado)
        return ident

    # (z, svg) de cada pieza; se ordena al final por z, de forma estable.
    items: list[tuple[float, str]] = []

    for i, b in enumerate(globos):
        cx = X(b.x)
        cy = Y(b.y)
        R = b.r * m.escala
        rnd = crear_rng(i * 2654435761 + cfg["aspecto"]["semilla"])
        ry = R * (1 + 0.05 * rnd())
        s = ""
        if a["sombra"] > 0:
            s += (
                f'<ellipse cx="{_f(cx + R * 0.07)}" cy="{_f(cy + R * 0.1)}" rx="{_f(R * 1.01)}"'
                f' ry="{_f(ry * 1.01)}" fill="{_SOMBRA}" fill-opacity="{_numero(a["sombra"])}"/>'
            )
        trazo = (
            f' stroke="{mezclar(b.color, "#000000", 0.45)}" stroke-opacity="0.6"'
            f' stroke-width="{_numero(a["contorno"])}"'
            if a["contorno"] > 0
            else ""
        )
        if b.acabado in ("confeti", "transparente"):
            opacidad = 0.3 if b.acabado == "confeti" else 0.16
            s += (
                f'<ellipse cx="{_f(cx)}" cy="{_f(cy)}" rx="{_f(R)}" ry="{_f(ry)}"'
                f' fill="{mezclar(b.color, "#ffffff", 0.78)}" fill-opacity="{_numero(opacidad)}"{trazo}/>'
            )
            s += (
                f'<ellipse cx="{_f(cx)}" cy="{_f(cy)}" rx="{_f(R * 0.9)}" ry="{_f(ry * 0.9)}" fill="none"'
                f' stroke="#fff" stroke-opacity="0.22" stroke-width="{_f(_maximo(0.8, R * 0.05))}"/>'
            )
            puntos = _maximo(6, _minimo(14, _redondear(R / 3))) if b.acabado == "confeti" else 0
            tonos = [b.color, "#ffffff", "#d4af37", mezclar(b.color, "#ffffff", 0.5)]
            k = 0
            while k < puntos:
                ang = rnd() * mate.pi * 2
                rad = mate.sqrt(rnd()) * R * 0.78
                t = R * (0.06 + rnd() * 0.06)
                s += (
                    f'<circle cx="{_f(cx + mate.cos(ang) * rad)}" cy="{_f(cy + mate.sin(ang) * rad)}"'
                    f' r="{_f(t)}" fill="{tonos[k % len(tonos)]}" fill-opacity="0.92"/>'
                )
                k += 1
        else:
            s += (
                f'<ellipse cx="{_f(cx)}" cy="{_f(cy)}" rx="{_f(R)}" ry="{_f(ry)}"'
                f' fill="url(#{id_grad(b.color, b.acabado)})"{trazo}/>'
            )
        if a["profundidad"] > 0 and capas > 1 and b.capa < capas - 1:
            s += (
                f'<ellipse cx="{_f(cx)}" cy="{_f(cy)}" rx="{_f(R)}" ry="{_f(ry)}" fill="{_SOMBRA}"'
                f' fill-opacity="{_f(0.26 * a["profundidad"] * (1 - b.capa / (capas - 1)))}"/>'
            )
        if a["brillo"] > 0:
            brillo = _minimo(1, a["brillo"] * 1.3) if b.acabado == "cromado" else a["brillo"]
            hx = cx - 0.38 * R
            hy = cy - 0.46 * R
            s += (
                f'<ellipse cx="{_f(hx)}" cy="{_f(hy)}" rx="{_f(0.17 * R)}" ry="{_f(0.27 * R)}"'
                f' transform="rotate(30 {_f(hx)} {_f(hy)})" fill="#fff" fill-opacity="{_f(brillo)}"/>'
            )
            s += (
                f'<path d="M{_f(cx + 0.64 * R)} {_f(cy + 0.62 * R)}A{_f(0.9 * R)} {_f(0.9 * R)} 0 0 1'
                f' {_f(cx - 0.18 * R)} {_f(cy + 0.9 * R)}" fill="none" stroke="#fff"'
                f' stroke-opacity="{_f(0.28 * brillo)}" stroke-width="{_f(0.06 * R)}" stroke-linecap="round"/>'
            )
        items.append((b.capa, s))

    for i, r in enumerate(ramas):
        rnd = crear_rng(i * 40503 + 9)
        x0 = X(r.x)
        y0 = Y(r.y)
        largo = r.largo * m.escala
        # En pantalla y crece hacia abajo, así que el ángulo se refleja.
        dx = mate.cos(r.ang)
        dy = -mate.sin(r.ang)
        x1 = x0 + dx * largo
        y1 = y0 + dy * largo
        s = (
            f'<path d="M{_f(x0)} {_f(y0)}Q{_f((x0 + x1) / 2 - dy * largo * 0.12)}'
            f' {_f((y0 + y1) / 2 + dx * largo * 0.12)} {_f(x1)} {_f(y1)}" fill="none" stroke="{_TALLO}"'
            f' stroke-width="{_f(_maximo(1.2, m.escala * 0.016))}" stroke-linecap="round"/>'
        )
        for h in r.hojas:
            px = x0 + dx * largo * h.t
            py = y0 + dy * largo * h.t
            ang = (mate.atan2(dy, dx) * 180) / mate.pi + h.lado * (38 + rnd() * 18)
            L = h.largo * m.escala
            w = L * 0.34
            color = mezclar("#2f5d3a", "#7aa353", h.tono)
            s += (
                f'<path transform="translate({_f(px)} {_f(py)}) rotate({_f(ang)})"'
                f' d="M0 0C{_f(L * 0.3)} {_f(-w)} {_f(L * 0.8)} {_f(-w * 0.7)} {_f(L)} 0C{_f(L * 0.8)}'
                f' {_f(w * 0.7)} {_f(L * 0.3)} {_f(w)} 0 0Z" fill="{color}"'
                f' stroke="{mezclar(color, "#000000", 0.4)}" stroke-opacity="0.5" stroke-width="0.6"/>'
            )
        # Hoja terminal.
        L = 0.14 * m.escala
        ang = (mate.atan2(dy, dx) * 180) / mate.pi
        s += (
            f'<path transform="translate({_f(x1)} {_f(y1)}) rotate({_f(ang)})"'
            f' d="M0 0C{_f(L * 0.3)} {_f(-L * 0.34)} {_f(L * 0.8)} {_f(-L * 0.24)} {_f(L)} 0C{_f(L * 0.8)}'
            f' {_f(L * 0.24)} {_f(L * 0.3)} {_f(L * 0.34)} 0 0Z" fill="{mezclar("#2f5d3a", "#7aa353", 0.5)}"/>'
        )
        items.append((r.capa, s))

    for i, fl in enumerate(flores):
        cx = X(fl.x)
        cy = Y(fl.y)
        R = fl.r * m.escala
        rnd = crear_rng(i * 92821 + 5)
        pet = _TONOS_FLOR[int(_minimo(len(_TONOS_FLOR) - 1, _piso(fl.tono * len(_TONOS_FLOR))))]
        s = ""
        giro = rnd() * 72
        for k in range(5):
            ang_rad = ((giro + k * 72) * mate.pi) / 180
            s += (
                f'<circle cx="{_f(cx + mate.cos(ang_rad) * R * 0.62)}"'
                f' cy="{_f(cy + mate.sin(ang_rad) * R * 0.62)}" r="{_f(R * 0.5)}" fill="{pet}"'
                f' stroke="{mezclar(pet, "#000000", 0.28)}" stroke-opacity="0.55" stroke-width="0.6"/>'
            )
        s += f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(R * 0.26)}" fill="#e8b93a"/>'
        items.append((capas, s))

    items.sort(key=lambda it: it[0])

    partes: list[str] = []
    if m.referencia is not None:
        partes.append(referencias(m))
    if forma["suelo"]:
        x1 = 20 if m.referencia is not None else m.centro - m.anchoPx / 2 - 10
        x2 = m.w - 20 if m.referencia is not None else m.centro + m.anchoPx / 2 + 10
        partes.append(
            f'<line x1="{_f(x1)}" y1="{_f(m.piso + 8)}" x2="{_f(x2)}" y2="{_f(m.piso + 8)}"'
            f' stroke="{_SUELO}" stroke-width="3" stroke-linecap="round" stroke-opacity="0.55"/>'
        )
    for _z, svg in items:
        partes.append(svg)
    return f'<defs>{"".join(grad.values())}</defs>{"".join(partes)}'


def referencias(m: Marco) -> str:
    """Regla lateral (marcas cada 0,5 m, número cada metro) y persona de 1,70 m, a la escala del dibujo."""
    ref = m.referencia
    if ref is None:
        return ""

    def Y(y: float) -> float:
        return m.piso - y * m.escala

    partes: list[str] = []
    regla_x = ref["reglaX"] if ref.get("reglaX") is not None else 44
    tope = mate.ceil(ref["altoRef"] * 2) / 2
    partes.append(
        f'<line x1="{_numero(regla_x)}" y1="{_f(Y(0))}" x2="{_numero(regla_x)}" y2="{_f(Y(tope))}"'
        f' stroke="#8fa39a" stroke-opacity="0.45" stroke-width="1.5"/>'
    )
    # Acumulación en coma flotante, como el `for (mtr = 0; mtr <= tope + 1e-9; mtr += 0.5)` del original.
    mtr = 0.0
    while mtr <= tope + 1e-9:
        entero = mate.fabs(mtr - _redondear(mtr)) < 1e-9
        partes.append(
            f'<line x1="{_numero(regla_x)}" y1="{_f(Y(mtr))}" x2="{_numero(regla_x + (10 if entero else 6))}"'
            f' y2="{_f(Y(mtr))}" stroke="#8fa39a" stroke-opacity="0.55" stroke-width="1.5"/>'
        )
        if entero:
            etiqueta = "0" if mtr == 0 else f"{_numero(mtr)} m"
            partes.append(
                f'<text x="{_numero(regla_x + 14)}" y="{_f(Y(mtr) + 3.5)}"'
                f' font-family="JetBrains Mono, monospace" font-size="10.5" fill="#9fb0a8">{etiqueta}</text>'
            )
        mtr += 0.5
    if ref["persona"]:
        px = ref["personaX"] if ref.get("personaX") is not None else 128

        def w(metros: float) -> float:
            return metros * m.escala

        partes.append(
            f'<g fill="#6b7c74" fill-opacity="0.5">'
            f'<circle cx="{_numero(px)}" cy="{_f(Y(1.6))}" r="{_f(w(0.105))}"/>'
            f'<rect x="{_f(px - w(0.2))}" y="{_f(Y(1.48))}" width="{_f(w(0.4))}" height="{_f(w(0.62))}"'
            f' rx="{_f(w(0.08))}"/>'
            f'<rect x="{_f(px - w(0.17))}" y="{_f(Y(0.88))}" width="{_f(w(0.14))}" height="{_f(w(0.88))}"'
            f' rx="{_f(w(0.04))}"/>'
            f'<rect x="{_f(px + w(0.03))}" y="{_f(Y(0.88))}" width="{_f(w(0.14))}" height="{_f(w(0.88))}"'
            f' rx="{_f(w(0.04))}"/>'
            f"</g>"
            f'<text x="{_numero(px)}" y="{_f(Y(1.74) - 4)}" text-anchor="middle"'
            f' font-family="JetBrains Mono, monospace" font-size="10.5" fill="#9fb0a8">1,70 m</text>'
        )
    return "".join(partes)


def svg_documento(interior: str, titulo: str = "Arco orgánico de globos", w: float = LIENZO, h: float = LIENZO) -> str:
    """Documento SVG completo, listo para descargar."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_numero(w)} {_numero(h)}" width="{_numero(w)}"'
        f' height="{_numero(h)}" role="img" aria-label="{titulo}">{interior}</svg>\n'
    )
