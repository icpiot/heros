"""Provider setup contract tests for HEROS."""
from __future__ import annotations

import inspect

from custom_components.heros.config_flow import (
    ByteWattConfigFlow,
    _provider_login_schema,
    _provider_options,
)
from custom_components.heros.const import (
    CONF_SCAN_INTERVAL,
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


def test_foxess_login_does_not_request_polling_interval():
    schema = _provider_login_schema(PROVIDER_FOXESS_V2)
    assert CONF_SCAN_INTERVAL not in {key.schema for key in schema.schema}


def test_bytewatt_login_keeps_polling_interval():
    schema = _provider_login_schema(PROVIDER_BYTEWATT)
    assert CONF_SCAN_INTERVAL in {key.schema for key in schema.schema}


def test_foxess_v2_setup_does_not_request_external_forecast_entities():
    source = inspect.getsource(ByteWattConfigFlow.async_step_provider_login)
    foxess_branch = source.split("if provider == PROVIDER_FOXESS_V2:", 1)[1].split(
        "client = ByteWattClient", 1
    )[0]
    assert "self._user_input[CONF_FORECAST_PROVIDER] = FORECAST_PROVIDER_NONE" in foxess_branch
    assert "return await self.async_step_forecast_setup()" not in foxess_branch


def test_foxess_v2_runtime_forwards_sensors_only():
    import custom_components.heros as integration

    assert integration.FOXESS_V2_PLATFORMS == ["sensor"]
    source = inspect.getsource(integration._async_setup_foxess_v2_entry)
    assert "async_forward_entry_setups(entry, FOXESS_V2_PLATFORMS)" in source


def test_foxess_v2_runtime_uses_fixed_polling_interval():
    import custom_components.heros as integration

    source = inspect.getsource(integration._async_setup_foxess_v2_entry)
    assert "scan_interval = FOXESS_V2_POLL_INTERVAL" in source
    assert "entry.data.get(CONF_SCAN_INTERVAL" not in source


def test_foxess_v2_options_do_not_expose_polling_interval():
    source = inspect.getsource(ByteWattConfigFlow.async_get_options_flow)
    assert "ByteWattOptionsFlowHandler" in source
    source = inspect.getsource(__import__("custom_components.heros.config_flow", fromlist=["ByteWattOptionsFlowHandler"]).ByteWattOptionsFlowHandler.async_step_init)
    assert "!= PROVIDER_FOXESS_V2" in source
