"""Runtime error codes."""

from __future__ import annotations


class OpenPlaitRuntimeError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# Back-compat alias for TypeScript naming; prefer OpenPlaitRuntimeError in Python.
RuntimeError = OpenPlaitRuntimeError
