import importlib.metadata
import importlib.util
import json
from pathlib import Path
import sys
import unittest
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from scheduling import anki_versions_match


class BackendVersionTests(unittest.TestCase):
    def test_date_style_and_uv_spellings_are_equivalent(self):
        self.assertTrue(anki_versions_match("26.09.4", "26.9.4"))
        self.assertTrue(anki_versions_match("26.9.4", "26.09.4"))
        self.assertTrue(anki_versions_match("25.09.2", "25.9.2"))

    def test_different_releases_and_prereleases_still_fail(self):
        for installed, requested in [("25.9.2", "26.9.4"), ("26.9.3", "26.9.4"),
                                     ("26.9.4b1", "26.9.4"), ("26.9.4+local", "26.9.4"),
                                     (None, "26.9.4"), ("", "")]:
            with self.subTest(installed=installed, requested=requested):
                self.assertFalse(anki_versions_match(installed, requested))

    def test_installed_backend_accepts_normalized_release(self):
        installed = importlib.metadata.version("anki")
        normalized = ".".join(str(int(part)) for part in installed.split("."))
        self.assertTrue(anki_versions_match(installed, normalized))

    def test_migration_reaches_snapshot_read_with_either_spelling(self):
        script = Path(__file__).resolve().parents[1] / "migrate.py"
        spec = importlib.util.spec_from_file_location("migration_cli", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for requested in ("26.9.4", "26.09.4"):
            with self.subTest(requested=requested), \
                 patch("importlib.metadata.version", return_value="26.09.4"), \
                 patch.object(module.srs, "load_config", return_value={}), \
                 patch.object(module.srs, "read_snapshot", side_effect=RuntimeError("snapshot reached")):
                with self.assertRaisesRegex(RuntimeError, "snapshot reached"):
                    module.main(["migrate", "--collection", "unused.anki2", "--vault", ".",
                                 "--anki-version", requested, "--timezone", "America/Chicago",
                                 "--day-zero", "2000-01-01", "--rollover-hour", "3"])

    def test_verification_accepts_both_installed_and_stored_spellings(self):
        import srs
        import verification
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            (data / "manifest.json").write_text(json.dumps({"scheduling": {"source_anki_version": "26.09.4"}}))
            for requested in ("26.9.4", "26.09.4"):
                args = SimpleNamespace(anki_version=requested, data=data, collection=Path("unused.anki2"))
                with self.subTest(requested=requested), \
                     patch("importlib.metadata.version", return_value="26.09.4"), \
                     patch.object(srs, "read_snapshot", side_effect=RuntimeError("snapshot reached")):
                    with self.assertRaisesRegex(RuntimeError, "snapshot reached"):
                        verification.run(args)
