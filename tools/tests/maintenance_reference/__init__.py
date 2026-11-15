"""Frozen Python maintenance oracle; not part of the runtime tools."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from srs_tools import core, layout, store, vault
for module in (core, layout, store, vault):
    sys.modules[__name__ + '.' + module.__name__.split('.')[-1]] = module
