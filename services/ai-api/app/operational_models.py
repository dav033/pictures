"""Shared strict request models for internal Python operations."""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict

from app.generated_models import OperationalContext
from app.patron_color import MODOS


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OperationalRequest(ContractModel):
    context: OperationalContext


def _modo_conocido(valor: str) -> str:
    if valor not in MODOS:
        raise ValueError(
            f"«{valor}» no es un estilo de patron-color.v1; los que hay son:"
            f" {', '.join(MODOS)}."
        )
    return valor


#: El estilo de un patrón de color, validado contra los modos del CONTRATO.
#:
#: Existe para que ningún modelo de pydantic vuelva a llevar esa lista a mano.
#: Ha pasado dos veces, y las dos con el mismo final: el modo ya estaba en el
#: contrato y `patron_color` ya sabía armarlo, pero la puerta de entrada no lo
#: dejaba pasar y la petición ENTERA moría con un 422 que la app mostraba como
#: «el servicio no está disponible».
#:
#: * 2026-09-29/30: `zonas` (ADR-0036), un día entero.
#: * 2026-10-01: los nueve modos porteados del diseñador de arcos, en cuanto la
#:   lectura de la foto devolvió uno.
#:
#: Con esto, añadir un modo al zod y reexportar el contrato basta: nadie más
#: tiene que acordarse.
ModoPatronColor = Annotated[str, AfterValidator(_modo_conocido)]


__all__ = ["ContractModel", "ModoPatronColor", "OperationalRequest"]
