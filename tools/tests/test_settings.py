from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from srs_tools import settings


class SettingsTests(unittest.TestCase):
    def test_configured_vault_is_relative_to_settings_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'local.json'
            path.write_text(json.dumps({'vault': 'vault', 'timezone': None}))
            with patch.dict(os.environ, {'SRS_SETTINGS': str(path)}, clear=True):
                self.assertEqual(settings.default_vault(), path.parent / 'vault')
                with patch.dict(os.environ, {'SRS_VAULT': str(path.parent / 'override')}):
                    self.assertEqual(settings.default_vault(), path.parent / 'override')

    def test_timezone_defaults_to_system_and_allows_private_override(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'local.json'
            path.write_text(json.dumps({'timezone': None}))
            with patch.dict(os.environ, {'SRS_SETTINGS': str(path)}, clear=True), \
                 patch.object(settings, 'system_timezone', return_value='UTC'):
                self.assertEqual(settings.default_timezone(), 'UTC')
                path.write_text(json.dumps({'timezone': 'Europe/Berlin'}))
                self.assertEqual(settings.default_timezone(), 'Europe/Berlin')

    def test_system_timezone_honors_tz(self):
        with patch.dict(os.environ, {'TZ': 'Europe/Berlin'}):
            self.assertEqual(settings.system_timezone(), 'Europe/Berlin')

    def test_system_timezone_matches_operating_system_clock(self):
        with patch.dict(os.environ, {}, clear=True):
            zone = ZoneInfo(settings.system_timezone())
            stamp = datetime.now(timezone.utc).timestamp()
            self.assertEqual(datetime.fromtimestamp(stamp, zone).utcoffset(),
                             datetime.fromtimestamp(stamp).astimezone().utcoffset())

    def test_invalid_local_settings_are_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'local.json'
            for value in ({'vault': 12}, {'unexpected': True}, []):
                path.write_text(json.dumps(value))
                with patch.dict(os.environ, {'SRS_SETTINGS': str(path)}):
                    with self.assertRaises(ValueError):
                        settings.local_settings()
