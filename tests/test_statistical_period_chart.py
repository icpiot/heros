"""Exercise the actual report-card renderer for multi-day statistical periods."""
from pathlib import Path
import subprocess


def test_multi_day_statistical_chart_renders_dates() -> None:
    script = Path(__file__).with_name("statistical_period_check.js")
    subprocess.run(["node", str(script)], check=True, capture_output=True, text=True)