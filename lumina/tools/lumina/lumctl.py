#!/usr/bin/env python3
"""lumctl — the Lumina OS control tool.

One entry point for the things a person actually does with this system:

    lumctl.py status              what is built, tested and healthy
    lumctl.py doctor              environment + toolchain report
    lumctl.py apps                the installed apps and their syscalls
    lumctl.py syscalls            the 24-call surface
    lumctl.py agents              the pipeline and the last run
    lumctl.py build [--verify]    build through the agent pipeline
    lumctl.py shots [--out DIR]   render the screenshot tour
    lumctl.py preview [--port N]  serve the live desktop
    lumctl.py verify              every test lane (C++, Python, broker)
    lumctl.py release --check     release readiness

Stdlib only, no arguments required.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

HERE = Path(__file__).resolve().parent
LUMINA = HERE.parent.parent
REPO = LUMINA.parent

VERSION = "1.0.0"
CODENAME = "crystal"
BINARY = LUMINA / "build" / "lumina"
PIPELINE = LUMINA / "build" / "pipeline.json"


def run(command: List[str], cwd: Path = REPO) -> int:
    print("$ " + " ".join(command))
    return subprocess.call(command, cwd=str(cwd))


def have(tool: str) -> bool:
    return shutil.which(tool) is not None


def status() -> int:
    print(f"Lumina OS {VERSION} ({CODENAME})")
    print(f"tree      {REPO}")
    print(f"host      {sys.platform} · python {sys.version.split()[0]}")
    print()
    binary = "built" if BINARY.exists() else "not built (make -C lumina)"
    print(f"runtime   {binary}")
    shots = sorted((LUMINA / "out").glob("*.png")) if (LUMINA / "out").exists() else []
    print(f"stills    {len(shots)} frame(s) in lumina/out")
    if PIPELINE.exists():
        report = json.loads(PIPELINE.read_text())
        summary = report["summary"]
        print(
            f"pipeline  {summary['passed']} passed · {summary['skipped']} skipped · "
            f"{summary['failed']} failed  ({report['generated_at']})"
        )
    else:
        print("pipeline  never run (lumctl.py build)")
    toolchains = {tool: have(tool) for tool in ("g++", "make", "python3", "cargo", "rustc")}
    print("toolchain " + "  ".join(f"{tool}:{'yes' if ok else 'no'}" for tool, ok in toolchains.items()))
    return 0


def doctor() -> int:
    problems: List[str] = []
    print("environment")
    for tool, why in (
        ("g++", "C++ compositor"),
        ("make", "build driver"),
        ("python3", "syscall broker"),
        ("cargo", "Rust kernel (optional for the desktop build)"),
    ):
        ok = have(tool)
        print(f"  {'ok  ' if ok else 'miss'} {tool:<8} {why}")
        if not ok and tool != "cargo":
            problems.append(f"{tool} is required")

    print("\nchecks")
    kernel_sources = len(list((LUMINA / "kernel" / "src").glob("*.rs")))
    print(f"  kernel   {kernel_sources} Rust modules")
    print(f"  surface  {len(list((LUMINA / 'src').rglob('*.cpp')))} C++ translation units")
    print(f"  tools    {len(list((LUMINA / 'tools').rglob('*.py')))} Python tools")
    manifest = json.loads((LUMINA / "agents" / "manifest.json").read_text())
    print(f"  agents   {len(manifest['agents'])} roles")
    if (LUMINA / "out").exists() and not list((LUMINA / "out").glob("*.png")):
        problems.append("out/ exists but holds no stills")

    if problems:
        print("\nproblems:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("\nno blocking problems")
    return 0


def apps() -> int:
    catalogue = [
        ("Files", "c++17", "fs.read, fs.write", "the sandbox browser"),
        ("Terminal", "c++17", "fs.read, proc.info", "keyboard-first shell, history, scrollback"),
        ("Notes", "c++17", "fs.read, fs.write", "instant-save editor"),
        ("Settings", "c++17", "proc.info", "appearance, accent, motion, glass"),
        ("Monitor", "c++17", "proc.info, time.read", "frame pacing and machine telemetry"),
        ("About", "c++17", "proc.info", "identity and languages"),
        ("Build Studio", "c++17", "agent.query", "the pipeline that builds this OS"),
    ]
    print(f"{len(catalogue)} first-party apps")
    for name, language, caps, summary in catalogue:
        print(f"  {name:<14}{language:<7}{summary}")
        print(f"  {'':<14}syscalls: {caps}")
    return 0


def syscalls() -> int:
    return run([sys.executable, str(HERE / "sysd.py"), "--list"])


def agents() -> int:
    return run([sys.executable, str(LUMINA / "agents" / "orchestrator.py"), "--status"])


def build(verify: bool) -> int:
    command = [sys.executable, str(LUMINA / "agents" / "orchestrator.py"), "--run"]
    if verify:
        command.append("--verify")
    return run(command)


def shots(out: Optional[str]) -> int:
    if not BINARY.exists():
        code = run(["make", "-C", "lumina"])
        if code != 0:
            return code
    command = [str(BINARY), "--scenario", "tour", "--root", str(REPO)]
    if out:
        command += ["--out", out]
    return run(command, cwd=LUMINA)


def preview(port: int) -> int:
    if not BINARY.exists():
        code = run(["make", "-C", "lumina"])
        if code != 0:
            return code
    print(f"serving the live desktop on http://0.0.0.0:{port} (Ctrl+C to stop)")
    return run([str(BINARY), "--scenario", "serve", "--port", str(port), "--root", str(REPO)], cwd=LUMINA)


def verify() -> int:
    lanes = [
        ("C++ core suite", ["make", "-C", "lumina", "test"]),
        ("broker invariants", [sys.executable, "lumina/tools/lumina/sysd.py", "--self-test"]),
        ("python suites", [sys.executable, "-m", "unittest", "discover", "-s", "lumina/tests",
                           "-p", "test_*.py"]),
        ("manifest", [sys.executable, "lumina/agents/orchestrator.py", "--check"]),
    ]
    failures = 0
    for name, command in lanes:
        print(f"\n=== {name} ===")
        code = run(command)
        if code != 0:
            failures += 1
            print(f"lane failed: {name}")
    print(f"\n{len(lanes) - failures}/{len(lanes)} lanes green")
    return 1 if failures else 0


def release_check() -> int:
    required = [
        LUMINA / "README.md",
        LUMINA / "CHANGELOG.md",
        LUMINA / "docs" / "architecture.md",
        LUMINA / "docs" / "design-language.md",
        LUMINA / "docs" / "syscalls.md",
        LUMINA / "docs" / "security-model.md",
        LUMINA / "THIRD_PARTY_NOTICES.md",
        LUMINA / "agents" / "manifest.json",
    ]
    missing = [path for path in required if not path.exists()]
    print(f"release {VERSION} ({CODENAME})")
    for path in required:
        mark = "ok  " if path.exists() else "MISS"
        print(f"  {mark} {path.relative_to(REPO)}")
    if missing:
        print(f"\n{len(missing)} artifact(s) missing")
        return 1
    print("\nrelease artifacts present")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="lumctl", description="Lumina OS control tool")
    parser.add_argument("command", nargs="?", default="status",
                        choices=["status", "doctor", "apps", "syscalls", "agents", "build",
                                 "shots", "preview", "verify", "release"])
    parser.add_argument("--verify", action="store_true", help="build: also run verify commands")
    parser.add_argument("--check", action="store_true", help="release: check artifacts")
    parser.add_argument("--out", help="shots: output directory")
    parser.add_argument("--port", type=int, default=8080, help="preview: port")
    parser.add_argument("--version", action="version", version=f"lumctl {VERSION}")
    options = parser.parse_args(argv)

    dispatch = {
        "status": status,
        "doctor": doctor,
        "apps": apps,
        "syscalls": syscalls,
        "agents": agents,
        "build": lambda: build(options.verify),
        "shots": lambda: shots(options.out),
        "preview": lambda: preview(options.port),
        "verify": verify,
        "release": release_check,
    }
    return dispatch[options.command]()


if __name__ == "__main__":
    sys.exit(main())
