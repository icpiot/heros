"""Provider setup contract tests for HEROS."""
from __future__ import annotations

import inspect

from custom_components.heros.config_flow import (
    ByteWattConfigFlow,
    _provider_login_schema,
    _provider_options,
)
from custom_components.heros.const import (
    CONF_FOXESS_V2_WASM_PATH,
    DEFAULT_FOXESS_V2_WASM_PATH,
    PROVIDER_BYTEWATT,
    PROVIDER_FOXESS_MODBUS,
    PROVIDER_FOXESS_V1,
    PROVIDER_FOXESS_V2,
)


def test_provider_selector_lists_supported_provider_paths():
    """The setup flow exposes every provider path the project tracks."""
    assert list(_provider_options()) == [
        {"value": PROVIDER_BYTEWATT, "label": "Bytewatt"},
        {"value": PROVIDER_FOXESS_V1, "label": "FoxESS_v1"},
        {"value": PROVIDER_FOXESS_V2, "label": "FoxESS_v2"},
        {"value": PROVIDER_FOXESS_MODBUS, "label": "FoxESS_Modbus"},
    ]


def test_foxess_v2_wasm_path_config_key_is_stable():
    """FoxESS_v2 setup points at the WASM signer added for Cloud V2."""
    assert CONF_FOXESS_V2_WASM_PATH == "foxess_v2_wasm_path"
    assert DEFAULT_FOXESS_V2_WASM_PATH == "/config/heros/foxess/signature.wasm"


def test_foxess_login_does_not_request_signer_path():
    schema = _provider_login_schema(PROVIDER_FOXESS_V2)
    assert CONF_FOXESS_V2_WASM_PATH not in {key.schema for key in schema.schema}


def test_foxess_v2_setup_does_not_request_external_forecast_entities():
    source = inspect.getsource(ByteWattConfigFlow.async_step_provider_login)
    foxess_branch = source.split("if provider == PROVIDER_FOXESS_V2:", 1)[1].split(
        "client = ByteWattClient", 1
    )[0]
    assert "self._user_input[CONF_FORECAST_PROVIDER] = FORECAST_PROVIDER_NONE" in foxess_branch
    assert "return await self.async_step_forecast_setup()" not in foxess_branch
