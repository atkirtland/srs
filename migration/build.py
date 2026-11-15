"""Compatibility entry point for tools/build.py."""
from pathlib import Path
import runpy
import sys
TOOLS = Path(__file__).resolve().parent.parent / "tools"
sys.path.insert(0, str(TOOLS))
runpy.run_path(str(TOOLS / "build.py"), run_name="__main__")
