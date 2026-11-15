"""Native Anki must use Python's bundled timezone data in isolated environments."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class TimezoneTests(unittest.TestCase):
    def test_native_cutoff_without_system_zoneinfo(self):
        library = str(Path(__file__).resolve().parents[1] / "lib")
        script = r'''
import sys, tempfile, time
from datetime import datetime
from zoneinfo import ZoneInfo
sys.path.insert(0, sys.argv[1])
import scheduling
scheduling.configure_timezone("America/Chicago")
from anki.collection import Collection
with tempfile.TemporaryDirectory() as directory:
    col = Collection(directory + "/collection.anki2")
    timing = col._backend.sched_timing_today()
    cutoff = datetime.fromtimestamp(timing.next_day_at, ZoneInfo("America/Chicago"))
    assert cutoff.hour == 4, (cutoff, timing)
    local = datetime.fromtimestamp(time.time(), ZoneInfo("America/Chicago"))
    assert time.localtime().tm_hour == local.hour
    col.close()
'''
        with tempfile.TemporaryDirectory() as directory:
            environment = dict(os.environ, TZ="America/Chicago", TZDIR=directory)
            result = subprocess.run([sys.executable, "-c", script, library], env=environment,
                                    capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
