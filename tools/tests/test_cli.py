from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

TOOLS=Path(__file__).resolve().parents[1]
ROOT=TOOLS.parent
sys.path.insert(0,str(TOOLS))
from srs_tools import cli
import test_study as fixtures


class CliTests(unittest.TestCase):
    def fixture(self):
        value=fixtures.StudyTests()
        value.setUp()
        self.addCleanup(value.tearDown)
        return value

    def test_ongoing_help_has_no_migration_commands(self):
        output=io.StringIO()
        with redirect_stdout(output),self.assertRaises(SystemExit) as result:
            cli.main(['--help'])
        self.assertEqual(result.exception.code,0)
        self.assertIn('refresh-cards',output.getvalue())
        self.assertIn('train',output.getvalue())
        self.assertNotIn('init-study',output.getvalue())
        self.assertNotIn('inspect',output.getvalue())
        for removed in ('install-view', 'upgrade-layout', 'seed-csv-uids'):
            self.assertNotIn(removed, output.getvalue())

    def test_refresh_works_from_another_directory_without_legacy_imports(self):
        fixture=self.fixture()
        (fixture.root/'words.csv').write_text('word,definition\nspume,foam\n')
        code='''import sys
class NoMigrationImports:
 def find_spec(self,name,*args):
  if name.split('.')[0] in {'anki','catalog','scheduling','sources','configuration','bootstrap'}:
   raise AssertionError('Ongoing tools imported migration module: '+name)
sys.meta_path.insert(0,NoMigrationImports())
from srs_tools.cli import main
raise SystemExit(main(sys.argv[1:]))
'''
        result=subprocess.run([sys.executable,'-c',code,'refresh-cards','--data',str(fixture.data),
                               '--study',str(fixture.study),'--config',str(fixture.config),'--vault',str(fixture.root)],
                              cwd=fixture.root,env={**__import__('os').environ,'PYTHONPATH':str(TOOLS)},capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout)['added'],1)

    def test_training_cli_applies_in_ongoing_environment(self):
        fixture=self.fixture();fixture.training_fixture()
        output=io.StringIO();progress=io.StringIO()
        with redirect_stdout(output),redirect_stderr(progress):
            result=cli.main(['train','--data',str(fixture.data),'--study',str(fixture.study),
                             '--vault',str(fixture.root),'--profile','vocab','--epochs','1','--apply'])
        self.assertEqual(result,0)
        self.assertTrue(json.loads(output.getvalue())['applied'])
        self.assertIn('Evaluating fitted parameters',progress.getvalue())

    def test_invalid_training_args_are_reported_without_applying(self):
        output=io.StringIO()
        with redirect_stderr(output):
            result=cli.main(['train','--profile','vocab','--epochs','0'])
        self.assertEqual(result,2)
        self.assertIn('must be positive',output.getvalue())

    def test_old_migration_commands_forward_to_the_new_project(self):
        script=ROOT/'migration/migrate.py'
        spec=importlib.util.spec_from_file_location('legacy_migration_cli',script)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with patch.object(module.shutil,'which',return_value='/usr/bin/uv'), \
             patch.object(module.subprocess,'run') as run,redirect_stderr(io.StringIO()):
            run.return_value.returncode=7
            self.assertEqual(module.main(['train','--profile','vocab','--apply']),7)
        args=run.call_args.args[0]
        self.assertEqual(args[:4],['/usr/bin/uv','run','--project',str(TOOLS)])
        self.assertEqual(args[4:],['python',str(TOOLS/'srs.py'),'train','--profile','vocab','--apply'])
