"""Provider setup contract tests for HEROS."""
from __future__ import annotations

from custom_components.heros.config_flow import _provider_options
from custom_components.heros.const import (
    CONF_FOXESS_V2_WASM_PATH,
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
