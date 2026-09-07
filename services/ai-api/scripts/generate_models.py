"""Generate Pydantic models and runtime JSON Schema validators."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SERVICE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_DIR.parents[1]
OUTPUT_PATH = SERVICE_DIR / "app" / "generated_models.py"
CONTRACT_ROOTS = (
    REPO_ROOT / "contracts" / "chat" / "v1",
    REPO_ROOT / "contracts" / "domain" / "v1",
)


@dataclass(frozen=True)
class SchemaSource:
    relative_path: str
    model_name: str
    schema: dict[str, Any]


def _model_name(path: Path) -> str:
    stem = path.name.removesuffix(".schema.json")
    words = re.findall(r"[A-Za-z0-9]+", stem)
    return "".join(word[:1].upper() + word[1:] for word in words) or "Contract"


def _load_sources() -> tuple[SchemaSource, ...]:
    sources: list[SchemaSource] = []
    names: set[str] = set()
    for root in CONTRACT_ROOTS:
        for path in sorted(root.glob("*.schema.json")):
            relative = path.relative_to(REPO_ROOT).as_posix()
            try:
                schema = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise ValueError(f"invalid schema {relative}: {exc}") from exc
            if not isinstance(schema, dict):
                raise ValueError(f"schema must be an object: {relative}")
            model_name = _model_name(path)
            if model_name in names:
                raise ValueError(f"duplicate generated model name: {model_name}")
            names.add(model_name)
            sources.append(SchemaSource(relative, model_name, schema))
    if len(sources) != 33:
        raise ValueError(f"expected 33 schemas, found {len(sources)}")
    return tuple(sources)


def _json_literal(value: Any) -> str:
    def stable(item: Any) -> Any:
        if isinstance(item, dict):
            return {key: stable(item[key]) for key in sorted(item)}
        if isinstance(item, list):
            return [stable(entry) for entry in item]
        return item

    return repr(stable(value))


def _is_object_schema(schema: dict[str, Any]) -> bool:
    return schema.get("type") == "object" and "oneOf" not in schema and "anyOf" not in schema


def _field_names(schema: dict[str, Any]) -> list[tuple[str, bool]]:
    properties = schema.get("properties")
    required = schema.get("required", [])
    if not isinstance(properties, dict):
        return []
    if not isinstance(required, list) or any(not isinstance(name, str) for name in required):
        raise ValueError("required must be a list of strings")
    if any(not isinstance(name, str) or not name.isidentifier() for name in properties):
        raise ValueError("generated model requires identifier-compatible property names")
    required_set = set(required)
    if not required_set.issubset(properties):
        raise ValueError("required property missing from properties")
    ordered = [*required, *sorted(set(properties) - required_set)]
    return [(name, name in required_set) for name in ordered]


def build_source() -> str:
    sources = _load_sources()
    blocks = [
        "# Generated file. Do not edit by hand; run scripts/generate_models.py.\n",
        "# Source: all JSON Schema files under contracts/chat/v1 and contracts/domain/v1.\n",
        "from __future__ import annotations\n\n",
        "from typing import Any, ClassVar\n\n",
        "from jsonschema import Draft7Validator, FormatChecker\n",
        "from pydantic import BaseModel, ConfigDict, RootModel, model_validator\n\n",
        "_FORMAT_CHECKER = FormatChecker()\n",
        "_SCHEMAS: dict[str, dict[str, Any]] = {\n",
    ]
    for source in sources:
        blocks.append(f"    {source.model_name!r}: {_json_literal(source.schema)},\n")
    blocks.extend(
        [
            "}\n",
            "_VALIDATORS = {\n",
            "    name: Draft7Validator(schema, format_checker=_FORMAT_CHECKER)\n",
            "    for name, schema in _SCHEMAS.items()\n",
            "}\n\n",
            "def _validate_contract(model_name: str, value: Any) -> Any:\n",
            "    errors = sorted(_VALIDATORS[model_name].iter_errors(value), key=lambda error: list(error.path))\n",
            "    if errors:\n",
            "        first = errors[0]\n",
            "        location = '.'.join(str(part) for part in first.path) or '<root>'\n",
            "        raise ValueError(f'{model_name} schema validation failed at {location}: {first.message}')\n",
            "    return value\n\n",
        ]
    )

    exports: list[str] = []
    for source in sources:
        exports.append(source.model_name)
        if _is_object_schema(source.schema):
            blocks.extend(
                [
                    f"class {source.model_name}(BaseModel):\n",
                    '    model_config = ConfigDict(extra="forbid")\n',
                    f"    _schema_name: ClassVar[str] = {source.model_name!r}\n\n",
                ]
            )
            for name, required in _field_names(source.schema):
                blocks.append(f"    {name}: Any{'' if required else ' | None = None'}\n")
            blocks.extend(
                [
                    "\n",
                    '    @model_validator(mode="before")\n',
                    "    @classmethod\n",
                    "    def validate_contract(cls, value: Any) -> Any:\n",
                    "        return _validate_contract(cls._schema_name, value)\n\n",
                ]
            )
        else:
            blocks.extend(
                [
                    f"class {source.model_name}(RootModel[Any]):\n",
                    f"    _schema_name: ClassVar[str] = {source.model_name!r}\n\n",
                    '    @model_validator(mode="before")\n',
                    "    @classmethod\n",
                    "    def validate_contract(cls, value: Any) -> Any:\n",
                    "        return _validate_contract(cls._schema_name, value)\n\n",
                ]
            )

    blocks.append(f"CONTRACT_MODEL_COUNT = {len(exports)}\n")
    blocks.append(f"__all__ = {tuple(exports + ['CONTRACT_MODEL_COUNT'])!r}\n")
    return "".join(blocks)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when generated source differs")
    args = parser.parse_args(argv)
    try:
        expected = build_source()
    except (OSError, ValueError) as exc:
        print(f"generate_models.py: {exc}", file=sys.stderr)
        return 2

    if args.check:
        try:
            current = OUTPUT_PATH.read_text(encoding="utf-8")
        except FileNotFoundError:
            current = None
        if current != expected:
            print(
                "generated_models.py drift detected; run python scripts/generate_models.py",
                file=sys.stderr,
            )
            return 1
        print("generated_models.py is up to date")
        return 0

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(expected, encoding="utf-8", newline="\n")
    print(f"generated {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
