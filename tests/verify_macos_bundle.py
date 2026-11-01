#!/usr/bin/env python3
"""Reject missing/non-portable Mach-O dependencies and overstated macOS support."""

import os
import platform
import plistlib
import re
import subprocess
import sys
from pathlib import Path


def command(*args):
    return subprocess.check_output(args, text=True)


def version(value):
    parts = tuple(int(part) for part in value.split("."))
    return parts + (0,) * (3 - len(parts))


def main():
    app = Path(sys.argv[1]).resolve()
    with (app / "Contents/Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    minimum = version(info["LSMinimumSystemVersion"])
    for key in ("CFBundleShortVersionString", "CFBundleVersion"):
        assert re.fullmatch(r"\d+\.\d+\.\d+", info[key]), (key, info[key])
    executable = app / "Contents/MacOS" / info["CFBundleExecutable"]
    frameworks = app / "Contents/Frameworks"
    assert executable.is_file()
    assert (app / "Contents/Resources/LICENSE").is_file()
    arch = platform.machine()
    magics = {b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf",
              b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca",
              b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"}
    images = []
    for directory, _, names in os.walk(app):
        for name in names:
            image = Path(directory) / name
            if image.is_symlink() or not image.is_file():
                continue
            with image.open("rb") as stream:
                if stream.read(4) in magics:
                    images.append(image)
    assert images, "No Mach-O images found"
    errors = []
    for image in images:
        relative = image.relative_to(app)
        if arch not in command("lipo", "-archs", str(image)).split():
            errors.append(f"{relative}: missing {arch} architecture")
            continue
        load_commands = command("otool", "-arch", arch, "-l", str(image))
        for block in re.split(r"Load command \d+\n", load_commands):
            if not re.search(r"cmd LC_(?:BUILD_VERSION|VERSION_MIN_MACOSX)\b", block):
                continue
            match = re.search(r"^\s+(?:minos|version) ([0-9.]+)\s*$", block, re.M)
            if match and version(match[1]) > minimum:
                errors.append(f"{relative}: requires macOS {match[1]}, plist claims {info['LSMinimumSystemVersion']}")

        # Helpers have their own executable_path; the Qt helper's Frameworks
        # symlink must resolve back into the outer app, not into the build kit.
        exe_dir = image.parent if image.parent.name == "MacOS" else executable.parent

        def expand(value):
            return Path(value.replace("@loader_path", str(image.parent))
                        .replace("@executable_path", str(exe_dir)))

        runpaths = [frameworks]
        for block in re.split(r"Load command \d+\n", load_commands):
            if re.search(r"cmd LC_RPATH\b", block):
                match = re.search(r"^\s+path (.+) \(offset \d+\)", block, re.M)
                if match:
                    runpaths.append(expand(match[1]))
        dependencies = command("otool", "-arch", arch, "-L", str(image))
        for match in re.finditer(r"^\s+(.+?) \(compatibility version", dependencies, re.M):
            dependency = match[1]
            if dependency.startswith(("/System/Library/", "/usr/lib/")):
                continue
            if dependency.startswith("/"):
                errors.append(f"{relative}: external dependency {dependency}")
                continue
            candidates = ([directory / dependency[len("@rpath/"):] for directory in runpaths]
                          if dependency.startswith("@rpath/") else [expand(dependency)])
            if not any(candidate.is_file() and candidate.resolve().is_relative_to(app) for candidate in candidates):
                errors.append(f"{relative}: unresolved bundled dependency {dependency}")
    if errors:
        raise RuntimeError("\n".join(errors))
    print(f"Verified {len(images)} Mach-O images for {arch}, macOS {info['LSMinimumSystemVersion']}+.")


if __name__ == "__main__":
    main()
