import hashlib
import json
import os
from pathlib import Path


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    root = Path(__file__).resolve().parents[2]
    build = root / 'build'
    version = (root / 'VERSION').read_text().strip()
    prefix = f'JellyfinDesktop-{version}-x64'
    packages = [build / f'{prefix}.exe', build / f'{prefix}.zip']
    checksums = {package.name: sha256(package) for package in packages}
    smoke = {}
    for scenario in ('portable-primary', 'portable-fallback', 'installed-primary'):
        result = json.loads((build / 'package-checks' / scenario / 'result.json').read_text(encoding='utf-8'))
        smoke[scenario] = {
            'connectivity': result['connectivity'], 'direct_ms': result['direct']['duration'],
            'transcode_ms': result['transcode']['duration'], 'waiting': result['events'].count('waiting'),
            'canplay': result['events'].count('canplay'),
        }
    info = {
        'repository': os.environ['GITHUB_REPOSITORY'], 'application_version': version,
        'source_commit': os.environ['GITHUB_SHA'], 'authenticode_signed': False,
        'ci_run': f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}",
        'ci_attempt': int(os.environ['GITHUB_RUN_ATTEMPT']), 'qt_core': os.environ['QT_VERSION'],
        'mpv_archive_version': os.environ['MPV_VERSION'], 'mpv_architectures': ['x86_64-v3', 'x86_64'],
        'playback': smoke, 'artifacts': {name: {'sha256': value, 'bytes': (build / name).stat().st_size} for name, value in checksums.items()},
        'bundled_dll_sha256': {name: sha256(build / 'output' / name) for name in ('libmpv-2.dll', 'libmpv-fallback.dll')},
    }
    metadata = build / 'BUILD-INFO.json'
    metadata.write_text(json.dumps(info, indent=2) + '\n', encoding='utf-8', newline='\n')
    checksums[metadata.name] = sha256(metadata)
    (build / 'SHA256SUMS').write_text(''.join(f'{value}  {name}\n' for name, value in sorted(checksums.items())), encoding='ascii', newline='\n')


if __name__ == '__main__':
    main()
