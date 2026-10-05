"""Auditoría 2026-10-04, S9: ai-api registra al arrancar el valor efectivo de sus banderas, sin secretos."""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

from app.main import Settings, create_app

SECRETO = "valor-secreto-que-no-debe-salir"


def test_el_arranque_registra_las_banderas_sin_secretos(caplog: pytest.LogCaptureFixture) -> None:
    app = create_app(Settings(environment="development", hmac_secret=SECRETO))
    with caplog.at_level(logging.INFO, logger="decoracion.ai_api"), TestClient(app):
        pass
    lineas = [
        registro.getMessage()
        for registro in caplog.records
        if "banderas_efectivas" in registro.getMessage()
    ]
    assert len(lineas) == 1
    assert '"hmac_configurado": true' in lineas[0]
    assert "PLAN_COST_OPTIMIZER_V2" in lineas[0]
    assert SECRETO not in lineas[0]
