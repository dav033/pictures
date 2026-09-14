"""Shared strict request models for internal Python operations."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.generated_models import OperationalContext


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OperationalRequest(ContractModel):
    context: OperationalContext


__all__ = ["ContractModel", "OperationalRequest"]
