"""Make the sibling ongoing-tools package available to migration scripts."""
from pathlib import Path
import sys
TOOLS = Path(__file__).resolve().parents[2] / "tools"
if str(TOOLS) not in sys.path:
    sys.path.append(str(TOOLS))
