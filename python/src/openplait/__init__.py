"""OpenPlait Python SDK — portable queries and datasource adapters."""

from openplait.version import OPENPLAIT_API_VERSION, OPENPLAIT_SPEC_VERSION

__all__ = [
    "OPENPLAIT_API_VERSION",
    "OPENPLAIT_SPEC_VERSION",
    "__version__",
]

__version__ = OPENPLAIT_SPEC_VERSION
