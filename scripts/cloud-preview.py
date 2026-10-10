#!/usr/bin/env python3
"""Cloud-environment test/build/Pages preview runner. Never deploy production."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

WRANGLER = '4.45.0'
PROJECTS = {
    'word-garden': ['test', 'test:feedback', 'build', 'test:smoke'],
    'void-swarm': ['test:cloud', 'build'],
}


class PreviewError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise PreviewError(message)


def validate_branch(branch, production=None):
    # No slash-to-hyphen aliases, omitted branch, case ambiguity or prod names.
    require(bool(re.fullmatch(r'preview-[a-z0-9](?:[a-z0-9-]{0,45}[a-z0-9])?', branch)),
            'Use an explicit lowercase preview-<task> branch (maximum 55 characters).')
    if production is not None:
        require(isinstance(production, str) and bool(production), 'Unknown production branch; refusing upload.')
        require(branch != production.lower().replace('/', '-'), 'Branch collides with production; refusing upload.')


def safe_env():
    env = dict(os.environ)
    # Do not expose deployment credentials to npm lifecycle hooks or game tests.
    for key in list(env):
        if any(word in key.upper() for word in ('TOKEN', 'SECRET', 'PASSWORD', 'CREDENTIAL')) or key.startswith('VITE_'):
            env.pop(key)
    for key in ('WORD_GARDEN_SMOKE_URL', 'WORD_GARDEN_SMOKE_TARGET', 'VOID_SWARM_SMOKE_URL'):
        env.pop(key, None)
    env.update(CI='true', WORD_GARDEN_SMOKE_DISPLAY='headless',
               VOID_SWARM_SMOKE_DISPLAY='headless', VOID_SWARM_SMOKE_CDP='port',
               WORD_GARDEN_SMOKE_BROWSER='playwright')
    return env


def run(args, cwd, env=None, capture=False):
    result = subprocess.run(args, cwd=cwd, env=env or safe_env(), text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None)
    # Never echo captured credential-bearing CLI output, even on error.
    require(result.returncode == 0, f'{args[0]} command failed (exit {result.returncode}).')
    return result.stdout.strip() if capture else ''


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def get(url, token=None):
    headers = {'User-Agent': 'cloud-preview-workflow/1', 'Cache-Control': 'no-cache'}
    if token:
        require(url.startswith('https://api.cloudflare.com/client/v4/'), 'Credential destination rejected.')
        headers['Authorization'] = 'Bearer ' + token
    # urllib uses the inherited proxy and system CA; auth never follows redirects.
    try:
        with urllib.request.build_opener(NoRedirect()).open(
                urllib.request.Request(url, headers=headers), timeout=30) as response:
            require(response.status == 200, 'Unexpected HTTP status.')
            return response.read()
    except (urllib.error.URLError, OSError) as error:
        # Do not include server bodies, headers, credentials or raw exception URLs.
        code = getattr(error, 'code', 'network')
        raise PreviewError(f'HTTP request failed ({code}); check network settings and authorization.') from None


class Cloudflare:
    def __init__(self, account, token, project):
        require(bool(re.fullmatch(r'[a-fA-F0-9]{32}', account)), 'CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID.')
        require(bool(token), 'Configure CLOUDFLARE_API_TOKEN as a Network secret for api.cloudflare.com.')
        require(project in PROJECTS, 'Project is not allow-listed.')
        self.base = f'https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{project}'
        self.token = token
        self.project = project

    def read(self, suffix=''):
        body = json.loads(get(self.base + suffix, self.token))
        require(body.get('success') is True and body.get('result') is not None, 'Cloudflare read failed.')
        if not suffix:
            require(body['result'].get('name') == self.project, 'Cloudflare returned the wrong project.')
        return body['result']


def production_snapshot(project, branch):
    require(project.get('name') in PROJECTS, 'Unexpected project returned by Cloudflare.')
    require(isinstance(project.get('production_branch'), str) and bool(project['production_branch']),
            'Unknown production branch; refusing upload.')
    validate_branch(branch, project.get('production_branch'))
    canonical = project.get('canonical_deployment') or {}
    return {'branch': project['production_branch'], 'deployment': canonical.get('id'),
            'config': project.get('deployment_configs', {}).get('production')}


def validate_deployment(deployment, branch, commit, message, project):
    require(deployment.get('environment') == 'preview', 'Deployment is not preview.')
    trigger = deployment.get('deployment_trigger', {})
    require(trigger.get('type') == 'ad_hoc', 'Unexpected deployment trigger.')
    metadata = trigger.get('metadata', {})
    require(metadata.get('branch') == branch and metadata.get('commit_hash') == commit
            and metadata.get('commit_message') == message, 'Deployment metadata does not match this run.')
    require(deployment.get('latest_stage', {}).get('status') == 'success', 'Deployment is not successful.')
    url = deployment.get('url', '')
    # Return only the immutable deployment origin, never production or an alias.
    require(bool(re.fullmatch(r'https://[a-z0-9]+\.' + re.escape(project) + r'\.pages\.dev', url)),
            'Unexpected deployment URL.')
    return url


def bundle_digest(directory):
    digest = hashlib.sha256()
    for path in sorted(directory.rglob('*')):
        require(not path.is_symlink(), 'Symlink in build output rejected.')
        if path.is_file():
            digest.update(path.relative_to(directory).as_posix().encode() + b'\0')
            digest.update(path.read_bytes())
    return digest.hexdigest()


def deploy_command(cli, branch, commit, message, project):
    validate_branch(branch)
    require(project in PROJECTS and re.fullmatch(r'[a-f0-9]{40}', commit), 'Invalid project or commit.')
    return ['node', str(cli), 'pages', 'deploy', 'dist', '--project-name', project,
            '--branch', branch, '--commit-hash', commit, '--commit-message', message,
            '--commit-dirty=false']


def wait_for_deployment(cf, branch, commit, message, project, marker):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        deployments = cf.read('/deployments?env=preview&per_page=25')
        for item in deployments:
            meta = item.get('deployment_trigger', {}).get('metadata', {})
            if meta.get('commit_message') != message:
                continue
            require(item.get('latest_stage', {}).get('status') not in ('failure', 'canceled'), 'Preview deployment failed.')
            if item.get('latest_stage', {}).get('status') != 'success':
                continue
            # Fetch by deployment ID as a second exact-deployment proof.
            deployment = cf.read('/deployments/' + item['id'])
            url = validate_deployment(deployment, branch, commit, message, project)
            try:
                require(json.loads(get(url + '/preview-proof.json')) == marker, 'Served commit marker mismatch.')
                html = get(url + '/')
                require(b'<html' in html.lower() and b'<script' in html.lower(), 'Preview did not serve the game HTML.')
            except PreviewError:
                time.sleep(3)
                continue
            return deployment['id'], url
        time.sleep(3)
    raise PreviewError('No verified preview deployment became available within 180 seconds.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--branch', required=True, help='Explicit Pages preview-<task> branch')
    parser.add_argument('--deploy', action='store_true', help='Upload and verify after all tests pass')
    parser.add_argument('--receipt', help='Evidence JSON path outside the repository; defaults to /tmp')
    args = parser.parse_args()
    validate_branch(args.branch)
    root = Path(__file__).resolve().parents[1]
    if args.receipt:
        require(not Path(args.receipt).resolve().is_relative_to(root), 'Receipt must be outside the repository.')
    require((root / 'package.json').exists(), 'Run from a complete repository checkout.')
    project = json.loads((root / 'package.json').read_text())['name']
    require(project in PROJECTS, 'Repository is not allow-listed.')
    require(int(run(['node', '--version'], root, capture=True).lstrip('v').split('.')[0]) >= 22, 'Use Node 22 or newer.')
    require(run(['git', 'rev-parse', '--show-toplevel'], root, capture=True) == str(root), 'Not a complete repository checkout.')
    require(not run(['git', 'status', '--porcelain', '--untracked-files=all'], root, capture=True),
            'Commit task changes first. Dirty or untracked work is preserved and cannot be deployed.')
    commit = run(['git', 'rev-parse', 'HEAD'], root, capture=True)
    cf = None
    before = None
    if args.deploy:
        cf = Cloudflare(os.environ.get('CLOUDFLARE_ACCOUNT_ID', ''),
                        os.environ.get('CLOUDFLARE_API_TOKEN', ''), project)
        before = production_snapshot(cf.read(), args.branch)
    # Preserve all original work. Tests, generated files and dependencies live in
    # a disposable detached worktree at the full immutable SHA.
    with tempfile.TemporaryDirectory(prefix='cloud-preview-') as temporary:
        workspace = Path(temporary)
        checkout = workspace / 'checkout'
        run(['git', 'worktree', 'add', '--detach', str(checkout), commit], root)
        try:
            env = safe_env()
            run(['npm', 'ci'], checkout, env)
            run(['npx', '--no-install', 'playwright', 'install', 'chromium', 'ffmpeg'], checkout, env)
            run(['python3', 'scripts/cloud-preview.test.py'], checkout, env)
            for command in PROJECTS[project]:
                print(f'Running required gate: npm run {command}', flush=True)
                run(['npm', 'run', command], checkout, env)
            # QA/sample tests can leave special builds in dist. Always rebuild.
            shutil.rmtree(checkout / 'dist', ignore_errors=True)
            run(['npm', 'run', 'build'], checkout, env)
            require((checkout / 'dist/index.html').is_file(), 'Build is missing index.html.')
            require(not run(['git', 'diff', 'HEAD', '--exit-code'], checkout, capture=True), 'Tests changed tracked source.')
            run_id = uuid.uuid4().hex
            marker = {'schema': 1, 'project': project, 'branch': args.branch, 'commit': commit,
                      'run_id': run_id, 'bundle_sha256': bundle_digest(checkout / 'dist'), 'cloud_saves': 'paused'}
            message = 'cloud-preview:' + run_id
            (checkout / 'dist/preview-proof.json').write_text(json.dumps(marker) + '\n')
            receipt = dict(marker, tests='passed', deployed=False)
            if args.deploy:
                # Install pinned CLI with NO credentials, outside the project.
                cli_dir = workspace / 'cli'
                cli_dir.mkdir()
                run(['npm', 'install', '--prefix', str(cli_dir), '--no-audit', '--no-fund',
                     'wrangler@' + WRANGLER], workspace, env)
                # Deploy from a config-free directory. No repository wrangler
                # config can redirect the upload or introduce production flags.
                upload = workspace / 'upload'
                upload.mkdir()
                shutil.copytree(checkout / 'dist', upload / 'dist')
                if (checkout / 'functions').is_dir():
                    shutil.copytree(checkout / 'functions', upload / 'functions')
                require(production_snapshot(cf.read(), args.branch) == before, 'Production changed during tests; aborting.')
                deploy_env = dict(env, CLOUDFLARE_ACCOUNT_ID=os.environ['CLOUDFLARE_ACCOUNT_ID'],
                                  CLOUDFLARE_API_TOKEN=os.environ['CLOUDFLARE_API_TOKEN'],
                                  WRANGLER_SEND_METRICS='false', WRANGLER_LOG='error', BROWSER='false')
                cli = cli_dir / 'node_modules/wrangler/bin/wrangler.js'
                run(deploy_command(cli, args.branch, commit, message, project), upload, deploy_env, capture=True)
                deployment_id, url = wait_for_deployment(cf, args.branch, commit, message, project, marker)
                run(['node', str(checkout / 'scripts/cloud-preview-browser.mjs'), url, project], checkout, env)
                require(production_snapshot(cf.read(), args.branch) == before, 'Production changed; preview is not accepted.')
                receipt.update(deployed=True, deployment_id=deployment_id, preview_url=url,
                               production_unchanged=True, browser='passed')
            receipt_path = Path(args.receipt).resolve() if args.receipt else Path('/tmp') / f'{project}-preview-{run_id}.json'
            require(not receipt_path.is_relative_to(root), 'Receipt must be outside the repository.')
            receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
            print(json.dumps(receipt, indent=2))
            print(f'Evidence: {receipt_path}')
        finally:
            run(['git', 'worktree', 'remove', '--force', str(checkout)], root)


if __name__ == '__main__':
    try:
        main()
    except (PreviewError, KeyError, ValueError, OSError) as error:
        # Known errors are controlled strings; unexpected OS messages may contain
        # paths or proxy detail, so do not dump a traceback or environment.
        print('Preview stopped: ' + (str(error) if isinstance(error, PreviewError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
