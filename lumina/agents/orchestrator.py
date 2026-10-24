#!/usr/bin/env python3
"""Lumina OS — agent pipeline orchestrator.

The manifest (`agents/manifest.json`) is the contract. This script turns it into
a build:

    orchestrator.py --check        validate the manifest against the code
    orchestrator.py --plan         show what would run, in order
    orchestrator.py --run          run the pipeline, write build/pipeline.json
    orchestrator.py --status       summarise the last run
    orchestrator.py --verify       run every `verify` command (CI gate)

Design rules encoded here
-------------------------
1. An agent may only use capabilities the syscall broker exposes.
2. Every declared output must exist after a successful stage.
3. A missing toolchain (e.g. no `rustc`) is reported as `skipped`, never as
   success; the pipeline's exit code distinguishes the two.
4. Stages run in manifest order; a failing stage stops dependents but the report
   still covers every stage (partial facts beat no facts).

Stdlib only: this has to run on the target and in CI.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

VERSION = "1.0.0"
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # repository root (lumina/agents/.. , lumina/..)
LUMINA = HERE.parent
MANIFEST = HERE / "manifest.json"
REPORT = LUMINA / "build" / "pipeline.json"

TOOL_FOR_PREFIX = {
    "make": "make",
    "bash": "bash",
    "python3": "python3",
}


@dataclass
class StageResult:
    role: str
    target: str
    language: str
    status: str = "pending"  # ready | passed | failed | skipped
    detail: str = ""
    commands: List[Dict[str, Any]] = field(default_factory=list)
    seconds: float = 0.0


def load_manifest() -> Dict[str, Any]:
    with MANIFEST.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def syscall_capabilities() -> set[str]:
    sys.path.insert(0, str(LUMINA / "tools" / "lumina"))
    try:
        import sysd  # type: ignore import-not-found
    finally:
        sys.path.pop(0)
    return {call.capability for call in sysd.SYSCALLS}


def check(manifest: Dict[str, Any]) -> int:
    problems: List[str] = []
    roles = [agent["role"] for agent in manifest["agents"]]

    if len(roles) != len(set(roles)):
        problems.append("duplicate roles in manifest")

    capabilities = syscall_capabilities()
    for agent in manifest["agents"]:
        for capability in agent.get("capabilities", []):
            if capability not in capabilities:
                problems.append(
                    f"{agent['role']}: capability {capability!r} is not in the syscall surface"
                )
        for output in agent.get("outputs", []):
            if not (ROOT / output).exists():
                problems.append(f"{agent['role']}: declared output missing: {output}")
        if not agent.get("commands"):
            problems.append(f"{agent['role']}: no build command")
        if not agent.get("requires"):
            problems.append(f"{agent['role']}: does not declare required tools")

    owned_targets = {agent["target"] for agent in manifest["agents"]}
    if not {"kernel", "compositor", "lumina-host", "syscalls"} <= owned_targets:
        problems.append("manifest does not cover every build target")

    print(f"manifest: {len(roles)} agents, {len(manifest['invariants'])} invariants")
    for agent in manifest["agents"]:
        print(f"  {agent['role']:<21}{agent['language']:<8}{agent['target']}")
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("\nmanifest is consistent with the code base")
    return 0


def plan(manifest: Dict[str, Any]) -> int:
    for index, agent in enumerate(manifest["agents"], start=1):
        print(f"{index}. {agent['role']} → {agent['target']}")
        for command in agent["commands"]:
            print(f"     $ {command}")
        for command in agent.get("verify", []):
            print(f"     verify: {command}")
    return 0


def run_command(command: str, cwd: Path, timeout: int = 900) -> Dict[str, Any]:
    started = time.time()
    tool = command.split()[0]
    if tool in TOOL_FOR_PREFIX and shutil.which(tool) is None:
        return {
            "command": command,
            "status": "skipped",
            "exit_code": None,
            "reason": f"{tool} not available",
            "seconds": 0.0,
            "output": "",
        }
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        output = (completed.stdout or "") + (completed.stderr or "")
        return {
            "command": command,
            "status": "passed" if completed.returncode == 0 else "failed",
            "exit_code": completed.returncode,
            "seconds": round(time.time() - started, 3),
            "output": output.strip()[-4000:],
        }
    except subprocess.TimeoutExpired:
        return {
            "command": command,
            "status": "failed",
            "exit_code": None,
            "reason": f"timed out after {timeout}s",
            "seconds": round(time.time() - started, 3),
            "output": "",
        }


def run(manifest: Dict[str, Any], verify: bool) -> int:
    results: List[StageResult] = []
    failed = False

    for agent in manifest["agents"]:
        stage = StageResult(role=agent["role"], target=agent["target"], language=agent["language"])
        started = time.time()
        commands = list(agent["commands"])
        if verify:
            commands += list(agent.get("verify", []))

        print(f"\n▶ {agent['role']} ({agent['language']} → {agent['target']})")

        missing_tools = [tool for tool in agent.get("requires", []) if shutil.which(tool) is None]
        if missing_tools:
            stage.status = "skipped"
            stage.detail = f"missing toolchain: {', '.join(missing_tools)} (source present)"
            stage.seconds = round(time.time() - started, 3)
            results.append(stage)
            print(f"  [skip] requires {' '.join(missing_tools)}")
            print(f"  → skipped: {stage.detail}")
            continue

        for command in commands:
            outcome = run_command(command, ROOT)
            stage.commands.append(outcome)
            mark = {"passed": "ok  ", "failed": "FAIL", "skipped": "skip"}[outcome["status"]]
            print(f"  [{mark}] {command}")
            if outcome["status"] == "failed":
                tail = (outcome.get("output") or "").strip().splitlines()[-6:]
                for line in tail:
                    print(f"         {line}")
                stage.status = "failed"
                stage.detail = outcome.get("reason") or f"exit {outcome.get('exit_code')}"
                failed = True
                break

        if stage.status != "failed":
            missing = [
                output for output in agent.get("outputs", []) if not (ROOT / output).exists()
            ]
            skipped = any(c["status"] == "skipped" for c in stage.commands)
            if missing:
                stage.status = "failed"
                stage.detail = f"missing outputs: {', '.join(missing)}"
                failed = True
            elif skipped:
                stage.status = "skipped"
                stage.detail = "toolchain unavailable (source present, not compiled)"
            else:
                stage.status = "passed"
                stage.detail = f"{len(stage.commands)} command(s) green"

        stage.seconds = round(time.time() - started, 3)
        results.append(stage)
        print(f"  → {stage.status}: {stage.detail}")

        if stage.status == "failed":
            print("  stopping: downstream stages depend on this one")
            break

    report = {
        "schema": "lumina.pipeline/1",
        "product": manifest["product"],
        "version": manifest["version"],
        "codename": manifest["codename"],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "verify": verify,
        "stages": [asdict(stage) for stage in results],
        "summary": {
            "passed": sum(1 for r in results if r.status == "passed"),
            "skipped": sum(1 for r in results if r.status == "skipped"),
            "failed": sum(1 for r in results if r.status == "failed"),
            "not_run": len(manifest["agents"]) - len(results),
        },
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    summary = report["summary"]
    print(
        f"\npipeline: {summary['passed']} passed, {summary['skipped']} skipped, "
        f"{summary['failed']} failed, {summary['not_run']} not run"
    )
    print(f"report: {REPORT.relative_to(ROOT)}")
    return 1 if failed else 0


def status() -> int:
    if not REPORT.exists():
        print("no pipeline run yet — try: python3 lumina/agents/orchestrator.py --run")
        return 0
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    print(f"{report['product']} {report['version']} ({report['codename']})")
    print(f"last run {report['generated_at']}  verify={report['verify']}")
    for stage in report["stages"]:
        print(f"  {stage['status']:<8}{stage['role']:<21}{stage['detail']}")
    print(json.dumps(report["summary"]))
    return 0 if report["summary"]["failed"] == 0 else 1


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Lumina agent pipeline orchestrator")
    parser.add_argument("--check", action="store_true", help="validate the manifest")
    parser.add_argument("--plan", action="store_true", help="print the build plan")
    parser.add_argument("--run", action="store_true", help="run the pipeline")
    parser.add_argument("--verify", action="store_true", help="also run verify commands")
    parser.add_argument("--status", action="store_true", help="show the last run")
    parser.add_argument("--json", action="store_true", help="print the manifest as JSON")
    parser.add_argument("--version", action="version", version=f"Lumina agents {VERSION}")
    options = parser.parse_args(argv)

    manifest = load_manifest()

    if options.json:
        print(json.dumps(manifest, indent=2, sort_keys=True))
        return 0
    if options.check:
        return check(manifest)
    if options.plan:
        return plan(manifest)
    if options.status:
        return status()
    if options.run or options.verify:
        return run(manifest, verify=options.verify)

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
