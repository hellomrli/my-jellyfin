#!/usr/bin/env python3
"""Download the unmodified, hash-pinned subtitle fonts and their licenses."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import tempfile
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


DEFAULT_MANIFEST = Path(__file__).with_name("fonts.json")


def load_manifest(filename):
    manifest = json.loads(Path(filename).read_text(encoding="utf-8"))
    files = manifest.get("files", [])
    if not isinstance(files, list) or not files:
        raise ValueError("The font manifest must contain files")
    names = set()
    for entry in files:
        name = entry.get("name", "")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name) or name.lower() in names:
            raise ValueError(f"Unsafe or duplicate font filename: {name!r}")
        names.add(name.lower())
        if entry.get("kind") not in ("font", "license"):
            raise ValueError(f"Invalid file kind: {name}")
        if not re.fullmatch(r"[0-9a-f]{64}", entry.get("sha256", "")):
            raise ValueError(f"Missing or invalid SHA-256: {name}")
        url = urlsplit(entry.get("url", ""))
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError(f"An HTTPS download URL is required: {name}")
    return manifest


def sha256(filename):
    digest = hashlib.sha256()
    with Path(filename).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(entry, directory):
    destination = directory / entry["name"]
    for attempt in range(3):
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, prefix=f".{entry['name']}-",
                                             suffix=".part", delete=False) as stream:
                temporary = Path(stream.name)
                request = Request(entry["url"], headers={"User-Agent": "my-jellyfin-font-installer"})
                digest = hashlib.sha256()
                with urlopen(request, timeout=90) as response:
                    for chunk in iter(lambda: response.read(1024 * 1024), b""):
                        stream.write(chunk)
                        digest.update(chunk)
            if digest.hexdigest() != entry["sha256"]:
                raise ValueError(f"SHA-256 mismatch: {entry['name']}")
            # Do not replace a previous download until the complete file is verified.
            temporary.replace(destination)
            return
        except (URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


def install_fonts(directory, manifest_path=DEFAULT_MANIFEST, check_only=False):
    manifest = load_manifest(manifest_path)
    directory = Path(directory)
    if not check_only:
        directory.mkdir(parents=True, exist_ok=True)
    for entry in manifest["files"]:
        filename = directory / entry["name"]
        if filename.is_file() and sha256(filename) == entry["sha256"]:
            print(f"Verified {entry['name']}")
            continue
        if check_only:
            raise ValueError(f"Missing or corrupt font dependency: {entry['name']}")
        print(f"Downloading {entry['name']}", flush=True)
        download(entry, directory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-O", "--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--check", action="store_true", help="Verify existing files without downloading")
    args = parser.parse_args()
    try:
        install_fonts(args.output, args.manifest, args.check)
    except (OSError, ValueError, URLError) as error:
        parser.exit(1, f"Font installation failed: {error}\n")


if __name__ == "__main__":
    main()
