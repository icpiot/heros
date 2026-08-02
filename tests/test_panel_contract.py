"""Contract checks for the bundled Home Energy Manager panel."""
from __future__ import annotations

import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
PANEL_PATH = ROOT / "examples" / "www" / "home-energy-manager-panel.js"
INIT_PATH = ROOT / "custom_components" / "home_energy_manager" / "__init__.py"
MANIFEST_PATH = ROOT / "custom_components" / "home_energy_manager" / "manifest.json"
PANEL_EXAMPLE_PATH = ROOT / "examples" / "panel" / "home-energy-manager-panel_custom.yaml"
CONFIG_FLOW_PATH = ROOT / "custom_components" / "home_energy_manager" / "config_flow.py"
CONST_PATH = ROOT / "custom_components" / "home_energy_manager" / "const.py"
SERVICES_PATH = ROOT / "custom_components" / "home_energy_manager" / "services.yaml"


def test_panel_build_matches_registered_cache_version():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")
    integration_source = INIT_PATH.read_text(encoding="utf-8")

    panel_build = re.search(r'PANEL_BUILD = "(\d+)"', panel_source)
    registered_build = re.search(r'panel\.js\?v=(\d+)', integration_source)

    assert panel_build is not None
    assert registered_build is not None
    assert panel_build.group(1) == registered_build.group(1)


def test_panel_uses_provider_neutral_entity_namespace():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")
    assert "home_energy_manager(?:_|$)" in panel_source
    assert "home_energy_manager_${key}" in panel_source
    assert "|bytewatt" not in panel_source.lower()


def test_panel_reads_configuration_from_home_assistant_panel_property():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")
    assert "this._config = panel?.config || this._config" in panel_source


def test_panel_exposes_forecast_page_and_configured_entity_lookup():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")
    assert "_forecastPage()" in panel_source
    assert "_configuredEntityId(key)" in panel_source
    assert "_stateForConfiguredEntity" in panel_source
    assert "Forecast Wiring" in panel_source


def test_panel_section_navigation_uses_page_fragment_links():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")
    assert 'HOME_ENERGY_MANAGER_PANEL_PAGE_FRAGMENT_KEY = "hem_page"' in panel_source
    assert 'HOME_ENERGY_MANAGER_PANEL_BATTERY_KEY = "home-energy-manager.panel.battery"' in panel_source
    assert "_pageHref(page)" in panel_source
    assert 'url.hash = `${HOME_ENERGY_MANAGER_PANEL_PAGE_FRAGMENT_KEY}=' in panel_source
    assert 'data-page="${page.value}"' in panel_source
    assert 'class="panel-nav__item ${page.value === this._page ? "is-active" : ""}"' in panel_source
    assert "overview__actions" not in panel_source


def test_panel_keeps_stats_links_on_settings_only():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")
    assert "settings-metrics" in panel_source
    assert "data-settings-focus" in panel_source
    assert "Settings Focus" not in panel_source
    assert '<section class="cards">' not in panel_source


def test_config_flow_collects_forecast_setup():
    config_flow_source = CONFIG_FLOW_PATH.read_text(encoding="utf-8")
    assert "async_step_forecast_setup" in config_flow_source
    assert "forecast_provider" in config_flow_source
    assert "CONF_FORECAST_GENERATION_TODAY_ENTITY" in config_flow_source
    assert "CONF_SOLAR_FORECAST_ENTITY" in config_flow_source


def test_integration_forwards_select_platform():
    integration_source = INIT_PATH.read_text(encoding="utf-8")
    platforms = re.search(r"PLATFORMS = \[(.*?)\]", integration_source)
    assert platforms is not None
    assert '"select"' in platforms.group(1)


def test_manifest_version_matches_panel_milestone():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    assert manifest["version"] == "1.2.3"
    assert manifest["codeowners"] == ["@icpiot"]


def test_legacy_panel_example_keeps_module_url_at_panel_level():
    example = PANEL_EXAMPLE_PATH.read_text(encoding="utf-8")
    assert "\n  module_url:" in example
    assert "\n    module_url:" not in example


def test_pricing_ui_exposes_rate_groups_records_and_overlap_guard():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")

    assert 'HOME_ENERGY_MANAGER_PANEL_PRICING_UI_KEY = "home-energy-manager.panel.pricing.ui"' in panel_source
    assert "_pricingUiGroupDefaults()" in panel_source
    assert "_pricingUiRuleDefaults()" in panel_source
    assert "_pricingRulesOverlap(ruleA, ruleB)" in panel_source
    assert "_pricingUiValidationForRule(group, candidateRule" in panel_source
    assert "_handlePricingUiAddGroup()" in panel_source
    assert '_handlePricingUiAddRule(recordType = "buy")' in panel_source
    assert 'data-pricing-ui-add-group' in panel_source
    assert 'data-pricing-ui-delete-group' in panel_source
    assert 'data-pricing-ui-add-rule' in panel_source
    assert 'data-pricing-ui-delete-rule' in panel_source
    assert "this._handlePricingUiAddGroup()" in panel_source
    assert "this._handlePricingUiDeleteRule(button.dataset.pricingUiDeleteRule)" in panel_source
    assert '"public_holiday"' in panel_source
    assert "data-pricing-rule-day" in panel_source
    assert 'model.warning = warning' in panel_source


def test_pricing_group_services_are_registered_and_documented():
    integration_source = INIT_PATH.read_text(encoding="utf-8")
    const_source = CONST_PATH.read_text(encoding="utf-8")
    services_source = SERVICES_PATH.read_text(encoding="utf-8")

    for service in (
        "pricing_upsert_group",
        "pricing_remove_group",
        "pricing_upsert_record",
        "pricing_remove_record",
    ):
        assert service in const_source
        assert service in services_source
        assert service in integration_source

    for attr in (
        "ATTR_GROUP_ID",
        "ATTR_RECORD_ID",
        "ATTR_EFFECTIVE_START_DATE",
        "ATTR_DAY_TYPES",
        "ATTR_CONTROLLED_LOAD_RATE",
        "ATTR_DAILY_CONNECTION_CHARGE",
        "ATTR_OTHER_CHARGES",
    ):
        assert attr in const_source
        assert attr in integration_source
