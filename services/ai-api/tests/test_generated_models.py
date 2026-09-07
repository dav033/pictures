import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app import generated_models


def test_all_versioned_contracts_have_generated_models() -> None:
    schema_files = sorted(Path(__file__).parents[3].glob("contracts/chat/v1/*.schema.json"))
    schema_files += sorted(Path(__file__).parents[3].glob("contracts/domain/v1/*.schema.json"))
    model_names = set(generated_models.__all__) - {"CONTRACT_MODEL_COUNT"}

    assert len(schema_files) == 33
    assert generated_models.CONTRACT_MODEL_COUNT == 33
    assert len(model_names) == 33


def test_generated_model_validates_shared_fixture_and_rejects_extra_root_field() -> None:
    fixture_path = (
        Path(__file__).parents[3] / "contracts/domain/v1/fixtures/plan-decoracion-ok.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    parsed = generated_models.PlanDecoracion.model_validate(fixture)

    assert parsed.plan_version == "1.0"
    with pytest.raises(ValidationError):
        generated_models.PlanDecoracion.model_validate({**fixture, "unexpected": True})


def test_union_root_model_uses_schema_validator() -> None:
    with pytest.raises(ValidationError):
        generated_models.SseEvent.model_validate(
            {"schema_version": "chat.sse.v1", "type": "unknown"}
        )
