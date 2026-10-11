"""Credential-free safety tests. Run: python3 scripts/cloud-preview.test.py"""
import importlib.util
from pathlib import Path
import tempfile
import json
import io
import sys
from contextlib import redirect_stdout
import unittest
import subprocess
from unittest.mock import patch
from unittest.mock import Mock

# Standalone guard tests must not dirty the source checkout with __pycache__.
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('preview', Path(__file__).with_name('cloud-preview.py'))
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class PreviewGuards(unittest.TestCase):
    def test_word_garden_package_maps_to_exact_pages_project(self):
        self.assertEqual(preview.REPOSITORY_PROJECTS,
                         {'word-garden': 'word-garden-6fl', 'void-swarm': 'void-swarm'})
        cf = preview.Cloudflare('a' * 32, 'fixture-only',
                                preview.REPOSITORY_PROJECTS['word-garden'])
        self.assertTrue(cf.base.endswith('/pages/projects/word-garden-6fl'))
        with self.assertRaises(preview.PreviewError):
            preview.Cloudflare('a' * 32, 'fixture-only', 'word-garden')
        with self.assertRaises(preview.PreviewError):
            preview.production_snapshot({'name': 'word-garden', 'production_branch': 'main'}, 'preview-a')
        item = self.deployment()
        item['url'] = 'https://abcd.word-garden.pages.dev'
        with self.assertRaises(preview.PreviewError):
            preview.validate_deployment(item, 'preview-a', 'a' * 40, 'cloud-preview:run', 'word-garden')

    def test_exact_project_origin_rejects_aliases_and_lookalikes(self):
        for url in ('https://abcd.word-garden.pages.dev',
                    'https://word-garden-6fl.pages.dev',
                    'https://preview-a.word-garden-6fl.pages.dev',
                    'https://abcd.word-garden-6flXpages.dev',
                    'https://abcd.word-garden-6fl.pages.dev.evil.example',
                    'https://abcdXword-garden-6fl.pages.dev',
                    'https://abcd.word-garden-6fl.pages.dev/',
                    'https://abcd.word-garden-6fl.pages.dev?alias=1',
                    'http://abcd.word-garden-6fl.pages.dev',
                    'https://abcd.void-swarm.pages.dev'):
            item = self.deployment(); item['url'] = url
            with self.subTest(url=url), self.assertRaises(preview.PreviewError):
                self.validate(item)

    def test_browser_validates_real_origins_and_word_garden_selector(self):
        # Import the exact validator used before browser launch, without npm or a
        # browser. This catches both a stale project and over-escaped regex dots.
        result = subprocess.run(['node', '--input-type=module', '-e', r'''
import assert from 'node:assert/strict';
import { validatePreviewOrigin } from './scripts/cloud-preview-url.mjs';
assert.equal(validatePreviewOrigin('https://abcd.word-garden-6fl.pages.dev', 'word-garden-6fl'), '.letter');
assert.equal(validatePreviewOrigin('https://abcd.void-swarm.pages.dev', 'void-swarm'), 'canvas');
for (const project of ['word-garden', 'other', 'word-garden-6fl.pages.dev']) {
  assert.throws(() => validatePreviewOrigin(`https://abcd.${project}.pages.dev`, project));
}
for (const url of [
  'https://abcd.word-garden.pages.dev', 'https://word-garden-6fl.pages.dev',
  'https://preview-a.word-garden-6fl.pages.dev',
  'https://abcdXword-garden-6fl.pages.dev', 'https://abcd.word-garden-6flXpages.dev',
  'https://abcd.word-garden-6fl.pagesXdev', 'https://abcd.word-garden-6fl.pages.dev.evil.example',
  'https://abcd.word-garden-6fl.pages.dev/', 'https://abcd.word-garden-6fl.pages.dev?alias=1',
  'http://abcd.word-garden-6fl.pages.dev', 'https://abcd.void-swarm.pages.dev',
  'https://abcd.word-garden-6fl.pages.dev\n', 'https://abcd.word-garden-6fl.pages.dev\r', undefined
]) assert.throws(() => validatePreviewOrigin(url, 'word-garden-6fl'));
'''], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_missing_production_and_branch_aliases(self):
        for branch in ('', 'main', 'master', 'production', 'gcp-preview', 'preview/a',
                       'Preview-a', 'preview-a --branch main', 'preview-', 'preview-a/', 'preview-a_'):
            with self.subTest(branch=branch), self.assertRaises(preview.PreviewError):
                preview.validate_branch(branch)
        for production in ('preview-a', 'Preview/a', '', None):
            with self.subTest(production=production), self.assertRaises(preview.PreviewError):
                preview.production_snapshot({'name': 'word-garden-6fl', 'production_branch': production}, 'preview-a')
        preview.validate_branch('preview-issue-123', 'main')

    def deployment(self):
        return {'id': 'one', 'environment': 'preview', 'url': 'https://abcd.word-garden-6fl.pages.dev',
                'latest_stage': {'status': 'success'},
                'deployment_trigger': {'type': 'ad_hoc', 'metadata': {'branch': 'preview-a',
                'commit_hash': 'a' * 40, 'commit_message': 'cloud-preview:run'}}}

    def validate(self, deployment):
        return preview.validate_deployment(deployment, 'preview-a', 'a' * 40, 'cloud-preview:run', 'word-garden-6fl')

    def test_exact_deployment_environment_sha_branch_and_run(self):
        self.assertEqual(self.validate(self.deployment()), 'https://abcd.word-garden-6fl.pages.dev')
        for key, value in [('environment', 'production'), ('url', 'https://word-garden-6fl.pages.dev'),
                           ('url', 'https://abcd.evil.example'), ('latest_stage', {'status': 'failure'})]:
            item = self.deployment(); item[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(preview.PreviewError):
                self.validate(item)
        for key, value in [('branch', 'main'), ('commit_hash', 'b' * 40), ('commit_message', 'old-run')]:
            item = self.deployment(); item['deployment_trigger']['metadata'][key] = value
            with self.subTest(key=key), self.assertRaises(preview.PreviewError):
                self.validate(item)

    def test_cli_cannot_omit_branch_or_select_other_project(self):
        command = preview.deploy_command('/cli', 'preview-a', 'a' * 40, 'cloud-preview:run', 'word-garden-6fl')
        self.assertEqual(command[command.index('--project-name') + 1], 'word-garden-6fl')
        self.assertEqual(command[command.index('--branch') + 1], 'preview-a')
        self.assertEqual(command[command.index('--commit-hash') + 1], 'a' * 40)
        self.assertIn('--commit-dirty=false', command)
        for project, branch, commit in [('word-garden', 'preview-a', 'a' * 40), ('other', 'preview-a', 'a' * 40), ('word-garden-6fl', '', 'a' * 40),
                                         ('word-garden-6fl', 'preview-a', 'short')]:
            with self.assertRaises(preview.PreviewError):
                preview.deploy_command('/cli', branch, commit, 'run', project)

    def test_secrets_and_special_build_flags_do_not_reach_tests(self):
        with patch.dict(preview.os.environ, {'CLOUDFLARE_API_TOKEN': 'fixture-only', 'GH_TOKEN': 'fixture-only',
                       'VITE_VOID_SWARM_QA': '1', 'VITE_VOID_SWARM_3D_SAMPLE': '1',
                       'HTTPS_PROXY': 'http://proxy:8080', 'WORD_GARDEN_SMOKE_URL': 'https://wrong.example'}):
            env = preview.safe_env()
            for key in ('CLOUDFLARE_API_TOKEN', 'GH_TOKEN', 'VITE_VOID_SWARM_QA',
                        'VITE_VOID_SWARM_3D_SAMPLE', 'WORD_GARDEN_SMOKE_URL'):
                self.assertNotIn(key, env)
            self.assertEqual(env['HTTPS_PROXY'], 'http://proxy:8080')

    def test_asset_digest_changes_and_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'index.html').write_text('first')
            first = preview.bundle_digest(root)
            (root / 'index.html').write_text('second')
            self.assertNotEqual(first, preview.bundle_digest(root))
            (root / 'link').symlink_to(root / 'index.html')
            with self.assertRaises(preview.PreviewError):
                preview.bundle_digest(root)

    def test_no_credentials_to_other_hosts_or_redirects(self):
        with self.assertRaises(preview.PreviewError):
            preview.get('https://example.com/', token='fixture-only')
        self.assertIsNone(preview.NoRedirect().redirect_request(None, None, None, None, None, None))

    def test_required_gates_preserved(self):
        self.assertEqual(preview.PROJECTS['word-garden-6fl'], ['test', 'test:feedback', 'build', 'test:smoke'])
        self.assertEqual(preview.PROJECTS['void-swarm'], ['test:cloud', 'build'])

    def test_orchestration_stops_on_gate_failure_and_rebuilds_after_cloud_tests(self):
        for fail in (True, False):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / 'scripts').mkdir()
                (root / 'package.json').write_text(json.dumps({'name': 'void-swarm'}))
                source = root / 'existing-work.txt'; source.write_text('preserve me')
                commands = []
                def fake_run(args, cwd, env=None, capture=False):
                    commands.append(args)
                    if args == ['node', '--version']: return 'v22.0.0'
                    if args[:3] == ['git', 'rev-parse', '--show-toplevel']: return str(root)
                    if args == ['git', 'rev-parse', 'HEAD']: return 'a' * 40
                    if args[:3] == ['git', 'worktree', 'add']:
                        checkout = Path(args[-2]); checkout.mkdir()
                        (checkout / 'scripts').mkdir()
                    if args == ['npm', 'run', 'test:cloud'] and fail:
                        raise preview.PreviewError('fixture failed test gate')
                    if args == ['npm', 'run', 'build']:
                        dist = Path(cwd) / 'dist'; dist.mkdir(exist_ok=True)
                        (dist / 'index.html').write_text('<html><script></script></html>')
                    return ''
                with patch.object(preview, '__file__', str(root / 'scripts/cloud-preview.py')), \
                     patch.object(preview, 'run', side_effect=fake_run), \
                     patch.object(preview.sys, 'argv', ['runner', '--branch', 'preview-test']), \
                     patch.object(preview, 'Cloudflare') as cloudflare, redirect_stdout(io.StringIO()):
                    if fail:
                        with self.assertRaises(preview.PreviewError): preview.main()
                        self.assertNotIn(['npm', 'run', 'build'], commands)
                    else:
                        preview.main()
                        self.assertEqual(commands.count(['npm', 'run', 'build']), 2)
                    cloudflare.assert_not_called()
                self.assertFalse(any('deploy' in command for command in commands))
                self.assertEqual(source.read_text(), 'preserve me')
                self.assertTrue(any(command[:3] == ['git', 'worktree', 'remove'] for command in commands))

    def test_dirty_work_cannot_reach_test_or_deployment(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'scripts').mkdir()
            (root / 'package.json').write_text(json.dumps({'name': 'word-garden'}))
            def fake_run(args, *unused, **kwargs):
                if args == ['node', '--version']: return 'v22.0.0'
                if '--show-toplevel' in args: return str(root)
                if 'status' in args: return ' M src/game.js'
                self.fail('Dirty checkout reached a test or deployment command')
            with patch.object(preview, '__file__', str(root / 'scripts/cloud-preview.py')), \
                 patch.object(preview, 'run', side_effect=fake_run), \
                 patch.object(preview.sys, 'argv', ['runner', '--branch', 'preview-test', '--deploy']), \
                 patch.object(preview, 'Cloudflare') as cf:
                with self.assertRaises(preview.PreviewError): preview.main()
                cf.assert_not_called()

    def test_poll_reads_exact_id_and_requires_served_run_proof(self):
        marker = {'commit': 'a' * 40, 'run_id': 'run', 'bundle_sha256': 'digest'}
        for served_marker in (marker, {'commit': 'b' * 40}):
            with self.subTest(served_marker=served_marker):
                cf = Mock()
                item = self.deployment()
                cf.read.side_effect = [[item], item]
                def response(url, token=None):
                    if url.endswith('/preview-proof.json'): return json.dumps(served_marker).encode()
                    return b'<html><script></script></html>'
                with patch.object(preview, 'get', side_effect=response), \
                     patch.object(preview.time, 'monotonic', side_effect=[0, 0, 181]), \
                     patch.object(preview.time, 'sleep'):
                    if served_marker == marker:
                        self.assertEqual(preview.wait_for_deployment(cf, 'preview-a', 'a' * 40,
                                         'cloud-preview:run', 'word-garden-6fl', marker),
                                         ('one', 'https://abcd.word-garden-6fl.pages.dev'))
                    else:
                        with self.assertRaises(preview.PreviewError):
                            preview.wait_for_deployment(cf, 'preview-a', 'a' * 40,
                                                        'cloud-preview:run', 'word-garden-6fl', marker)
                self.assertEqual(cf.read.call_args_list[-1].args, ('/deployments/one',))

    def test_production_snapshot_detects_deployment_or_configuration_changes(self):
        item = {'name': 'word-garden-6fl', 'production_branch': 'main',
                'canonical_deployment': {'id': 'production-one'},
                'deployment_configs': {'production': {'compatibility_date': '2026-01-01'}}}
        before = preview.production_snapshot(item, 'preview-a')
        item['canonical_deployment'] = {'id': 'production-two'}
        self.assertNotEqual(before, preview.production_snapshot(item, 'preview-a'))
        item['canonical_deployment'] = {'id': 'production-one'}
        item['deployment_configs']['production'] = {'compatibility_date': '2026-02-01'}
        self.assertNotEqual(before, preview.production_snapshot(item, 'preview-a'))


if __name__ == '__main__':
    unittest.main()
