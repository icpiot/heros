"""Interactively verify only the captured FoxESS V2 REST reads.

No credentials on the command line or disk; no raw payloads or identifiers printed.
Use the operator-provided WASM. This does not install/sync anything into HA.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime
from getpass import getpass
import importlib
from pathlib import Path
import sys
import types
from zoneinfo import ZoneInfo


async def check(args):
    import aiohttp

    # Run the HA-independent API without importing HA's integration __init__.
    package = types.ModuleType("_heros_foxess_diagnostic")
    package.__path__ = [str(Path(__file__).resolve().parents[1] / "custom_components" / "heros" / "api")]
    sys.modules[package.__name__] = package
    api = importlib.import_module(f"{package.__name__}.foxess_v2")
    try:
        signer = await asyncio.to_thread(api.FoxESSV2Signer, args.wasm)
    except Exception:
        print("Signer verification failed. Check the pinned WASM asset and Python runtime.")
        return 1
    print("Signer acceptance vector passed.")
    username = getpass("FoxESS V2 username (hidden): ")
    password = getpass("FoxESS V2 password (hidden): ")
    async with aiohttp.ClientSession() as http:
        session = api.FoxESSV2Session(http, signer, username, password, timezone=args.timezone)
        del username, password
        client = api.FoxESSV2Client(session)
        try:
            plants = await client.list_plants()
            print(f"Login and discovery passed: {len(plants)} plant(s).")
            if not plants:
                print("No plants available to test.")
                return 1
            if len(plants) > 1 and args.plant_index is None:
                print("Multiple plants found. Re-run with --plant-index N (zero-based discovery order).")
                return 1
            index = args.plant_index if args.plant_index is not None else 0
            if not 0 <= index < len(plants):
                print("Plant index is outside the discovered list.")
                return 1
            plant_id = plants[index]["plantID"]
            for name in ("get_plant_extra_info", "get_work_mode", "get_last_energy", "get_alarms",
                         "get_flow_preinfo", "get_plant_detail", "get_green_energy"):
                await getattr(client, name)(plant_id)
                print(f"{name}: passed")
            day = datetime.now(ZoneInfo(args.timezone)).date()
            await client.get_raw_analysis(plant_id, "DAY", {
                "year": str(day.year), "month": str(day.month), "day": str(day.day),
            })
            print("DAY history: passed")
            return 0
        except api.FoxESSV2Error as error:
            print(str(error))
            return 1
        finally:
            session.clear_credentials()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wasm", required=True, type=Path)
    parser.add_argument("--timezone", required=True, help="IANA timezone, matching Home Assistant")
    parser.add_argument("--plant-index", type=int)
    args = parser.parse_args()
    try:
        ZoneInfo(args.timezone)
        raise SystemExit(asyncio.run(check(args)))
    except (KeyboardInterrupt, EOFError):
        raise SystemExit("Connection check cancelled.") from None
    except Exception:
        raise SystemExit("Connection check failed; verify runtime dependencies and timezone.") from None
