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


def test_foxess_v2_setup_offers_optional_forecast_step():
    source = inspect.getsource(ByteWattConfigFlow.async_step_provider_login)
    foxess_branch = source.split("if provider == PROVIDER_FOXESS_V2:", 1)[1].split(
        "client = ByteWattClient", 1
    )[0]
    assert "return await self.async_step_forecast_setup()" in foxess_branch


def test_no_forecast_setup_does_not_render_blank_entity_mappings():
    """A no-forecast installation must submit without invalid entity selectors."""
    source = inspect.getsource(ByteWattConfigFlow.async_step_forecast_setup)

    assert "CONF_FORECAST_PROVIDER" in source
    assert "EntitySelector" not in source
    assert "return self._create_entry()" in source

def test_foxess_v2_runtime_forwards_sensors_and_selector():
    import custom_components.heros as integration

    assert integration.FOXESS_V2_PLATFORMS == ["sensor", "select"]
    source = inspect.getsource(integration._async_setup_foxess_v2_entry)
    assert "async_forward_entry_setups(entry, FOXESS_V2_PLATFORMS)" in source


def test_foxess_v2_unload_uses_forwarded_platforms_only():
    import custom_components.heros as integration

    source = inspect.getsource(integration.async_unload_entry)
    assert "platforms = FOXESS_V2_PLATFORMS if provider == PROVIDER_FOXESS_V2 else PLATFORMS" in source
    assert "for platform in platforms" in source
    assert "for platform in PLATFORMS" not in source


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


def test_entry_unload_keeps_the_sidebar_panel_registered_across_reloads():
    import custom_components.heros as integration

    assert "async_remove_panel" not in inspect.getsource(integration)

def test_foxess_v2_debug_payload_sanitizer_redacts_identifiers_and_tokens():
    import custom_components.heros as integration

    sanitized = integration._sanitize_foxess_v2_debug({
        "token": "synthetic-token",
        "accessToken": "synthetic-access-token",
        "plantID": "synthetic-plant",
        "device": {"id": "synthetic-device", "serialNumber": "synthetic-sn", "value": 12},
        "rows": [{"batteryId": "synthetic-battery", "currentPower": {"value": 1.2}}],
    })
    assert sanitized["token"] == "[redacted]"
    assert sanitized["accessToken"] == "[redacted]"
    assert sanitized["plantID"] == "[redacted]"
    assert sanitized["device"] == {"id": "[redacted]", "serialNumber": "[redacted]", "value": 12}
    assert sanitized["rows"][0]["batteryId"] == "[redacted]"
    assert sanitized["rows"][0]["currentPower"] == {"value": 1.2}
