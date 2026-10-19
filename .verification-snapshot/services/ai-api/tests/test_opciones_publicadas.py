"""Qué claves publica cada puerta del motor al editor, congeladas a propósito.

Las ``opciones`` viajan a TypeScript y allí las valida un esquema **estricto**
(``src/lib/plan/opciones-armado-*.ts``): una clave que esta puerta añada y aquel esquema no conozca tumba la
respuesta entera con ``PYTHON_INVALID_RESPONSE``, y el usuario ve «Algo no salió bien de nuestro lado».

Pasó de verdad el 2026-10-03: la puerta de la guirnalda orgánica empezó a publicar sus once formas listas y
sus cuatro estilos —que estaban portados y nadie publicaba— y el editor de guirnaldas dejó de funcionar
**por completo**. Ninguna prueba lo vio: las de TypeScript leen una respuesta congelada del motor
(``scripts/fixtures/guirnalda-organica-ui/vista-guirnalda-organica.json``) que seguía siendo la de antes.

Así que esta prueba no comprueba un valor: comprueba que **nadie añade una clave sin enterarse**. Si falla,
lo que toca no es cambiar la lista de aquí: es añadir la clave al esquema de TypeScript y regenerar la
fixture del editor, y entonces sí ponerla aquí.
"""

from __future__ import annotations

from app.armado_arco import opciones_admitidas as opciones_arco
from app.armado_columna import opciones_admitidas as opciones_columna
from app.armado_columna_organica import opciones_admitidas as opciones_columna_organica
from app.armado_guirnalda_organica import opciones_admitidas as opciones_guirnalda_organica

#: Puerta -> claves que publica, y el esquema estricto que las valida al otro lado.
PUBLICADAS: dict[str, tuple[frozenset[str], str]] = {
    "arco": (
        frozenset(
            {
                "patrones",
                "formas",
                "tamanos",
                "ancho_m",
                "alto_m",
                "seccion_m",
                "max_materiales",
                "max_secuencia",
            }
        ),
        "src/lib/plan/opciones-armado-arco.ts",
    ),
    "columna": (
        frozenset(
            {"patrones", "modos", "tamanos", "alto_m", "max_capas", "globos_capa", "remates"}
        ),
        "src/lib/plan/opciones-armado-columna.ts",
    ),
    "columna organica": (
        frozenset(
            {
                "acabados",
                "repartos",
                "roles",
                "tamanos",
                "alto_m",
                "grosor_m",
                "max_materiales",
                "formas",
                "estilos",
            }
        ),
        "src/lib/plan/opciones-armado-columna-organica.ts",
    ),
    "guirnalda organica": (
        frozenset(
            {
                "acabados",
                "repartos",
                "roles",
                "tamanos",
                "largo_m",
                "grosor_m",
                "altura_m",
                "max_materiales",
                "formas",
                "estilos",
            }
        ),
        "src/lib/plan/opciones-armado-guirnalda-organica.ts",
    ),
}


def test_ninguna_puerta_publica_una_clave_que_el_editor_no_conozca() -> None:
    puertas = {
        "arco": opciones_arco(),
        "columna": opciones_columna(),
        "columna organica": opciones_columna_organica(),
        "guirnalda organica": opciones_guirnalda_organica(),
    }
    for nombre, opciones in puertas.items():
        esperadas, esquema = PUBLICADAS[nombre]
        publicadas = frozenset(opciones)
        assert publicadas == esperadas, (
            f"la puerta de la {nombre} publica {sorted(publicadas - esperadas)} de más y"
            f" {sorted(esperadas - publicadas)} de menos. Lo que viaja al editor lo valida un esquema"
            f" estricto en {esquema}: añade allí la clave y regenera la fixture del editor antes de"
            " tocar esta lista, o el editor entero se cae con PYTHON_INVALID_RESPONSE."
        )
