"""FoxESS V2's pinned WASM signer, with no JavaScript/Node runtime dependency.

The official binary is supplied by the operator, not redistributed by HEROS.
Construct and call this synchronous adapter in an executor from async code.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import threading
from urllib.parse import urlsplit

WASM_SHA256 = "c817419723bff8168497384db98719f7e10f2840c763df997ba66a5223ee3a5b"
VECTOR_PATH = "/foxess/biz/auth/login"
VECTOR_TIME = 1788705641429
VECTOR_SIGNATURE = "f733e2d52d22e24b73990c768f9289b0.5245784"


class FoxESSV2SignerError(Exception):
    """Safe, credential-free signing failure."""


def signing_path(path: str) -> str:
    """Accept relative URL paths only; queries are never signed."""
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/") or parsed.fragment:
        raise FoxESSV2SignerError("Expected a relative FoxESS request path")
    return parsed.path


class FoxESSV2Signer:
    """Execute the Emscripten string ABI with bounded memory and instruction fuel."""

    def __init__(self, wasm_path: str | Path) -> None:
        try:
            import wasmtime as wasm

            binary = Path(wasm_path).read_bytes()
            if hashlib.sha256(binary).hexdigest() != WASM_SHA256:
                raise FoxESSV2SignerError("FoxESS signer asset hash does not match the validated version")
            config = wasm.Config()
            config.consume_fuel = True
            engine = wasm.Engine(config)
            linker = wasm.Linker(engine)

            def memcpy(caller, destination, source, size):
                memory = caller.get("memory")
                memory.write(caller, memory.read(caller, source, source + size), destination)
                return destination

            i32 = wasm.ValType.i32()
            linker.define_func("env", "emscripten_memcpy_big",
                wasm.FuncType([i32, i32, i32], [i32]), memcpy, access_caller=True)
            # This small signer fits its initial heap. Deny unexpected growth.
            linker.define_func("env", "emscripten_resize_heap",
                wasm.FuncType([i32], [i32]), lambda size: 0)
            linker.define_func("env", "setTempRet0", wasm.FuncType([i32], []), lambda value: None)
            self._engine, self._linker = engine, linker
            self._module = wasm.Module(engine, binary)
            self._lock = threading.Lock()
            if self.sign(VECTOR_PATH, "", "en", VECTOR_TIME) != VECTOR_SIGNATURE:
                raise FoxESSV2SignerError("FoxESS signer acceptance vector failed")
        except FoxESSV2SignerError:
            raise
        except Exception:
            raise FoxESSV2SignerError("FoxESS WASM signer could not be initialized") from None

    def sign(self, path: str, token: str, language: str, timestamp_ms: int) -> str:
        path = signing_path(path)
        values = (path, token, language, str(timestamp_ms))
        if any(not isinstance(value, str) or "\0" in value or len(value.encode()) > 16384 for value in values):
            raise FoxESSV2SignerError("Invalid signer input")
        with self._lock:
            import wasmtime
            store = wasmtime.Store(self._engine)
            store.set_limits(memory_size=32 * 1024 * 1024)
            store.set_fuel(10_000_000)
            instance = self._linker.instantiate(store, self._module)
            exports = instance.exports(store)
            exports["__wasm_call_ctors"](store)
            stack = exports["stackSave"](store)
            begun = False
            try:
                memory = exports["memory"]
                pointers = []
                for value in values:
                    encoded = value.encode("utf-8") + b"\0"
                    pointer = exports["stackAlloc"](store, len(encoded))
                    memory.write(store, encoded, pointer)
                    pointers.append(pointer)
                pointer = exports["begin_signature"](store, *pointers)
                begun = True
                raw = bytes(memory.read(store, pointer, pointer + 256))
                if b"\0" not in raw:
                    raise FoxESSV2SignerError("Invalid signer output")
                return raw.split(b"\0", 1)[0].decode("ascii")
            except Exception:
                raise FoxESSV2SignerError("FoxESS request signing failed") from None
            finally:
                if begun:
                    # WASM declares one i32; JS endSignature() coerces its
                    # missing argument to zero. Match that exact call ABI.
                    exports["end_signature"](store, 0)
                exports["stackRestore"](store, stack)
                store.close()
