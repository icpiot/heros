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
LATEST_DEBUG_BUILD_PATH = ROOT / "examples" / "www" / "LATEST_DEBUG_BUILD.txt"
LATEST_REPORT_BUILD_PATH = ROOT / "examples" / "www" / "LATEST_REPORT_BUILD.txt"
README_PATH = ROOT / "README.md"
EXAMPLES_README_PATH = ROOT / "examples" / "README.md"


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


def test_report_battery_selector_updates_without_replacing_embedded_card():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")

    assert "_updateSharedBatterySelectorInPlace()" in panel_source
    assert "currentSelector.replaceWith(nextSelector)" in panel_source
    assert "if (this._updateEmbeddedPageInPlace())" in panel_source
    assert 'this._page !== "report" && this._page !== "debug"' in panel_source
    assert "if (panel._updateEmbeddedPageInPlace())" in panel_source
    assert "if (panel._isSharedBatterySelectorHeld())" in panel_source
    assert "if (panel._panel === value)" in panel_source


def test_panel_routes_forecast_setup_and_configured_entity_lookup():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")
    assert '{ value: "forecast", label: "Forecast"' not in panel_source
    assert 'requested === "forecast"' in panel_source
    assert 'return "solar"' in panel_source
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
    assert "CONF_FORECAST_GENERATION_THIS_HOUR_ENTITY" in config_flow_source
    assert "CONF_FORECAST_POWER_IN_24_HOURS_ENTITY" in config_flow_source


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
    integration_source = INIT_PATH.read_text(encoding="utf-8")
    example_build = re.search(r'panel\.js\?v=(\d+)', example)
    registered_build = re.search(r'panel\.js\?v=(\d+)', integration_source)

    assert "\n  module_url:" in example
    assert "\n    module_url:" not in example
    assert example_build is not None
    assert registered_build is not None
    assert example_build.group(1) == registered_build.group(1)


def test_readme_panel_url_matches_registered_build():
    readme = README_PATH.read_text(encoding="utf-8")
    integration_source = INIT_PATH.read_text(encoding="utf-8")
    readme_build = re.search(r'home-energy-manager-panel\.js\?v=(\d+)', readme)
    registered_build = re.search(r'panel\.js\?v=(\d+)', integration_source)

    assert readme_build is not None
    assert registered_build is not None
    assert readme_build.group(1) == registered_build.group(1)


def test_latest_debug_build_marker_matches_debug_card_import():
    latest_debug_build = LATEST_DEBUG_BUILD_PATH.read_text(encoding="utf-8")
    panel_source = PANEL_PATH.read_text(encoding="utf-8")
    marker_build = re.search(r'debug-card\.js\?v=(\d+)', latest_debug_build)
    panel_import_build = re.search(r'debug-card\.js\?v=(\d+)', panel_source)

    assert marker_build is not None
    assert panel_import_build is not None
    assert marker_build.group(1) == panel_import_build.group(1)


def test_latest_report_build_marker_matches_report_card_import():
    latest_report_build = LATEST_REPORT_BUILD_PATH.read_text(encoding="utf-8")
    panel_source = PANEL_PATH.read_text(encoding="utf-8")
    marker_build = re.search(r'report-card\.js\?v=(\d+)', latest_report_build)
    panel_import_build = re.search(r'report-card\.js\?v=(\d+)', panel_source)

    assert marker_build is not None
    assert panel_import_build is not None
    assert marker_build.group(1) == panel_import_build.group(1)


def test_examples_readme_report_url_matches_report_build_marker():
    examples_readme = EXAMPLES_README_PATH.read_text(encoding="utf-8")
    latest_report_build = LATEST_REPORT_BUILD_PATH.read_text(encoding="utf-8")
    readme_builds = re.findall(r'home-energy-manager-report-card\.js\?v=(\d+)', examples_readme)
    marker_build = re.search(r'report-card\.js\?v=(\d+)', latest_report_build)

    assert readme_builds
    assert marker_build is not None
    assert all(build == marker_build.group(1) for build in readme_builds)


def test_examples_readme_debug_url_matches_debug_build_marker():
    examples_readme = EXAMPLES_README_PATH.read_text(encoding="utf-8")
    latest_debug_build = LATEST_DEBUG_BUILD_PATH.read_text(encoding="utf-8")
    readme_builds = re.findall(r'home-energy-manager-debug-card\.js\?v=(\d+)', examples_readme)
    marker_build = re.search(r'debug-card\.js\?v=(\d+)', latest_debug_build)

    assert readme_builds
    assert marker_build is not None
    assert all(build == marker_build.group(1) for build in readme_builds)


def test_examples_readme_policy_url_matches_panel_policy_import():
    examples_readme = EXAMPLES_README_PATH.read_text(encoding="utf-8")
    panel_source = PANEL_PATH.read_text(encoding="utf-8")
    readme_builds = re.findall(r'home-energy-manager-policy-card\.js\?v=(\d+)', examples_readme)
    panel_import_build = re.search(r'policy-card\.js\?v=(\d+)', panel_source)

    assert readme_builds
    assert panel_import_build is not None
    assert all(build == panel_import_build.group(1) for build in readme_builds)


def test_pricing_ui_exposes_rate_groups_records_and_overlap_guard():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")

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


def test_pricing_ui_runtime_state_stays_out_of_browser_storage():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")

    load_draft = re.search(
        r"  _loadPricingDraft\(\) \{\n(?P<body>.*?)\n  \}\n\n  _isForecastInteractionTarget",
        panel_source,
        re.DOTALL,
    )
    save_draft = re.search(
        r"  _savePricingDraft\(draft\) \{\n(?P<body>.*?)\n  \}\n\n  _clearPricingDraft",
        panel_source,
        re.DOTALL,
    )
    load_ui = re.search(
        r"  _loadStoredPricingUi\(\) \{\n(?P<body>.*?)\n  \}\n\n  _loadPricingUi",
        panel_source,
        re.DOTALL,
    )
    save_ui = re.search(
        r"  _savePricingUi\(model\) \{\n(?P<body>.*?)\n  \}\n\n  _savePricingUiFromBackend",
        panel_source,
        re.DOTALL,
    )
    save_ui_backend = re.search(
        r"  _savePricingUiFromBackend\(model\) \{\n(?P<body>.*?)\n  \}\n\n  _pricingUiGroupDefaults",
        panel_source,
        re.DOTALL,
    )
    save_custom_tariff = re.search(
        r"  _saveCustomPurchaseTariff\(label\) \{\n(?P<body>.*?)\n  \}\n\n  _handlePurchaseTariffOther",
        panel_source,
        re.DOTALL,
    )

    assert load_draft is not None
    assert save_draft is not None
    assert load_ui is not None
    assert save_ui is not None
    assert save_ui_backend is not None
    assert save_custom_tariff is not None

    assert "localStorage" not in load_draft.group("body")
    assert "localStorage" not in save_draft.group("body")
    assert "localStorage" not in load_ui.group("body")
    assert "localStorage" not in save_ui.group("body")
    assert "localStorage" not in save_ui_backend.group("body")
    assert "localStorage" not in save_custom_tariff.group("body")


def test_policy_charge_ui_runtime_state_stays_out_of_browser_storage():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")

    load_ui = re.search(
        r"  _loadPolicyChargeUi\(\) \{\n(?P<body>.*?)\n  \}\n\n  _savePolicyChargeUi",
        panel_source,
        re.DOTALL,
    )
    save_ui = re.search(
        r"  _savePolicyChargeUi\(model\) \{\n(?P<body>.*?)\n  \}\n\n  _readPolicyChargeForm",
        panel_source,
        re.DOTALL,
    )

    assert load_ui is not None
    assert save_ui is not None

    assert "localStorage" not in load_ui.group("body")
    assert "localStorage" not in save_ui.group("body")


def test_browser_storage_is_limited_to_ui_preferences_only():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")

    local_storage_keys = set(re.findall(r'localStorage\.(?:getItem|setItem|removeItem)\(([^)]+)\)', panel_source))

    assert {
        "HOME_ENERGY_MANAGER_PANEL_PAGE_KEY",
        "HOME_ENERGY_MANAGER_PANEL_BATTERY_KEY",
        "HOME_ENERGY_MANAGER_PANEL_DEBUG_KEY",
        "HOME_ENERGY_MANAGER_PANEL_ENTRY_ID_KEY",
        '"home-energy-manager.panel.settings.focus"',
    }.issubset(local_storage_keys)

    assert "home-energy-manager.panel.pricing.ui" not in panel_source
    assert "home-energy-manager.panel.pricing.draft" not in panel_source
    assert "home-energy-manager.panel.policy.charge.ui" not in panel_source


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


def test_hero_mapping_service_is_registered_and_documented():
    integration_source = INIT_PATH.read_text(encoding="utf-8")
    const_source = CONST_PATH.read_text(encoding="utf-8")
    services_source = SERVICES_PATH.read_text(encoding="utf-8")

    assert "set_hero_mapping" in const_source
    assert "set_hero_mapping" in services_source
    assert "SERVICE_SET_HERO_MAPPING" in integration_source

    for attr in (
        "CONF_BATTERY_HERO_MAPPING",
        "CONF_SOLAR_HERO_MAPPING",
    ):
        assert attr in const_source
        assert attr in integration_source

    for field in (
        "battery_hero_mapping",
        "solar_hero_mapping",
    ):
        assert field in services_source


def test_setup_mapping_persistence_stays_in_backend_config_and_services():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")

    load_forecast = re.search(
        r"  _loadForecastMapping\(\) \{\n(?P<body>.*?)\n  \}\n\n  _saveForecastMapping",
        panel_source,
        re.DOTALL,
    )
    load_battery = re.search(
        r"  _loadBatteryMapping\(\) \{\n(?P<body>.*?)\n  \}\n\n  _saveBatteryMapping",
        panel_source,
        re.DOTALL,
    )
    load_hero = re.search(
        r"  _loadBatteryHeroMapping\(\) \{\n(?P<body>.*?)\n  \}\n\n  _splitHeroMappings",
        panel_source,
        re.DOTALL,
    )
    save_forecast = re.search(
        r"  async _saveForecastSetup\(\) \{\n(?P<body>.*?)\n  \}\n\n  _forecastMappingKeyForField",
        panel_source,
        re.DOTALL,
    )
    save_battery = re.search(
        r"  async _saveBatterySetup\(\) \{\n(?P<body>.*?)\n  \}\n\n  _batteryMappingKeyForField",
        panel_source,
        re.DOTALL,
    )
    save_hero = re.search(
        r"  async _saveBatteryHeroMapping\(mapping\) \{\n(?P<body>.*?)\n  \}\n\n  _batteryHeroMappingDraft",
        panel_source,
        re.DOTALL,
    )

    assert load_forecast is not None
    assert load_battery is not None
    assert load_hero is not None
    assert save_forecast is not None
    assert save_battery is not None
    assert save_hero is not None

    assert "localStorage" not in load_forecast.group("body")
    assert "localStorage" not in load_battery.group("body")
    assert "localStorage" not in load_hero.group("body")

    assert 'this._config?.forecast_provider' in load_forecast.group("body")
    assert 'this._config?.battery_provider' in load_battery.group("body")
    assert 'this._config?.battery_hero_mapping' in load_hero.group("body")
    assert 'this._config?.solar_hero_mapping' in load_hero.group("body")

    assert 'callService("home_energy_manager", "set_forecast_mapping"' in save_forecast.group("body")
    assert 'callService("home_energy_manager", "set_battery_mapping"' in save_battery.group("body")
    assert 'callService("home_energy_manager", "set_hero_mapping"' in save_hero.group("body")


def test_forecast_setup_page_keeps_mapping_status_and_live_summary_sections():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")
    forecast_setup_page = re.search(
        r"  _forecastSetupPage\(\) \{\n(?P<body>.*?)\n  \}\n\n  _heroMappingFieldSelectField",
        panel_source,
        re.DOTALL,
    )

    assert forecast_setup_page is not None
    body = forecast_setup_page.group("body")

    assert "const setupStatus =" in body
    assert "const batterySetupStatus =" in body
    assert "const showBatterySensorsCard =" in body

    assert '<div class="pricing-loading forecast-loading" role="status">${setupStatus}</div>' in body
    assert '<div class="pricing-loading forecast-loading" role="status">${batterySetupStatus}</div>' in body

    for heading in (
        "<h2>Battery Hero Mapping Summary.</h2>",
        "<h2>Solar Hero Mapping Summary.</h2>",
        "<h2>Bytewatt Sensors.</h2>",
        "<h2>HEM Hero Sensors.</h2>",
    ):
        assert heading in body


def test_forecast_setup_keeps_shared_battery_selector_visible():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")

    assert '${this._page === "pricing" ? "" : this._renderSharedBatterySelector()}' in panel_source


def test_report_page_uses_embedded_report_card_and_documents_storage_layers():
    panel_source = PANEL_PATH.read_text(encoding="utf-8")
    report_page = re.search(
        r"  _reportPage\(\) \{\n(?P<body>.*?)\n  \}\n\n  _solarPage",
        panel_source,
        re.DOTALL,
    )

    assert report_page is not None
    body = report_page.group("body")

    assert 'data-embedded="report"' in body
    assert "<h2>Archive Snapshot</h2>" in body
    assert "<h2>Archive Scope Coverage</h2>" in body
    assert "<h2>Archive Status</h2>" in body
    assert "<h2>Storage Strategy</h2>" in body
    assert "No archive rows are stored for this scope yet." in body
    assert "Open Scope CSV" in body
    assert "Open History JSON" in body
    assert "Payload source" in body
    assert "Payload storage" in body
    assert "Diagram source" in body
    assert "Stored provider payload" in body
    assert "Provider payload keys" in body
    assert "Provider payload fields" in body
    assert "Stored raw provider subset" in body
    assert "Archive health" in body
    assert "Archive age" in body
    assert "Archive freshness" in body
    assert "Archive lag" in body
    assert "Archive completeness" in body
    assert "Known archive days" in body
    assert "Archive coverage" in body
    assert "Archive range" in body
    assert "All systems + battery scopes" in body
    assert "Report Context" in body
    assert "Archive Health" in body
    assert "Archive Files" in body
    assert "Backfill" in body
    assert "Stored report rows" in body
    assert "Missing report dates" in body
    assert "First stored date" in body
    assert "Last stored date" in body
    assert "Scope updated" in body
    assert "Scope CSV" in body
    assert "Scope CSV URL" in body
    assert "History JSON" in body
    assert "History JSON URL" in body
    assert "InfluxDB will hold detailed sensor history for long-range analysis" in body
    assert "www/home-energy-manager-history/<entry_id>/history.json" in body


def test_report_card_exposes_backend_vs_fallback_source_banner():
    report_card_source = (ROOT / "examples" / "www" / "home-energy-manager-report-card.008.js").read_text(encoding="utf-8")

    assert "synthesized_live_entities" in report_card_source
    assert "ephemeral_live_state" in report_card_source
    assert "live_entity_synthesis" in report_card_source
    assert "backend_reporting" in report_card_source
    assert "local_archive" in report_card_source
    assert "provider_power_diagram" in report_card_source
    assert "synthesized_from_backend_snapshot" in report_card_source
    assert "Live Fallback Active" in report_card_source
    assert "Backend Reporting Active" in report_card_source


def test_report_card_supports_archived_date_selection_from_history():
    report_card_source = (ROOT / "examples" / "www" / "home-energy-manager-report-card.008.js").read_text(encoding="utf-8")

    assert "data-report-date" in report_card_source
    assert "data-shift-date" in report_card_source
    assert "ensure_report_history" in report_card_source
    assert "Archived report loaded for" in report_card_source
    assert "No stored archive found yet" in report_card_source
    assert "history.json" in report_card_source


def test_debug_card_reads_archive_from_ha_without_browser_history_cache():
    debug_card_source = (ROOT / "examples" / "www" / "home-energy-manager-debug-card.js").read_text(encoding="utf-8")

    assert "history.json" in debug_card_source
    assert "home-energy-manager-debug-history" not in debug_card_source
    assert "_writeLocalHistory" not in debug_card_source
    assert "_readLocalHistory" not in debug_card_source
