#!/usr/bin/env python3
"""Lumina OS — the syscall broker.

Every user-space request in Lumina is brokered. The kernel exposes 24 typed
calls (`kernel/src/syscall.rs`, table `SYS_TABLE`); this module is the ring-3
half: it validates arguments against a policy, accounts for resources, records
an audit trail and only then performs the effect.

It is deliberately dependency-free (stdlib only) so it can run on the live
system, in CI and inside the host simulator's terminal.

Usage
-----
    sysd.py --list                      # the 24-call surface
    sysd.py --call ls path=.            # one audited call
    sysd.py --exec "agents"             # run a shell line (used by the terminal)
    sysd.py --self-test                 # invariants + policy suite
    sysd.py --describe                  # machine-readable manifest (JSON)

The table below is the single source of truth shared with:
  * `kernel/src/syscall.rs`  — parsed by `tests/test_sysd.py`
  * `agents/manifest.json`   — every agent declares the calls it may use
  * the C++ shell            — `syscalls` in the terminal mirrors these names
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

VERSION = "1.0.0"
CODENAME = "crystal"

# ---------------------------------------------------------------------------
# Error algebra: every failure carries a stable errno and a human reason.
# ---------------------------------------------------------------------------
ENOSYS = 38
EINVAL = 22
EACCES = 13
ENOENT = 2
EAGAIN = 11
ENOMEM = 12
ENOSPC = 28
EPERM = 1
EBUSY = 16

ERRNO_NAMES = {
    EPERM: "EPERM",
    ENOENT: "ENOENT",
    EACCES: "EACCES",
    EAGAIN: "EAGAIN",
    ENOMEM: "ENOMEM",
    EBUSY: "EBUSY",
    EINVAL: "EINVAL",
    ENOSPC: "ENOSPC",
    ENOSYS: "ENOSYS",
}


class SyscallError(Exception):
    """A denied or failed syscall. Never raised silently: always audited."""

    def __init__(self, errno: int, reason: str) -> None:
        super().__init__(reason)
        self.errno = errno
        self.reason = reason

    @property
    def symbol(self) -> str:
        return ERRNO_NAMES.get(self.errno, f"E{self.errno}")

    def __str__(self) -> str:  # pragma: no cover - formatting only
        return f"{self.symbol}: {self.reason}"


@dataclass(frozen=True)
class Syscall:
    number: int
    name: str
    domain: str
    args: str
    returns: str
    summary: str
    capability: str


# ---------------------------------------------------------------------------
# The surface: 24 calls. Changing this list requires updating the kernel table
# (checked by tests/test_sysd.py) and the manifest.
# ---------------------------------------------------------------------------
SYSCALLS: List[Syscall] = [
    Syscall(1, "write", "io", "fd, buf, len", "bytes", "Write to a std stream", "io.write"),
    Syscall(2, "exit", "proc", "code", "never", "Terminate the calling thread", "proc.exit"),
    Syscall(3, "yield", "proc", "-", "0", "Give up the rest of the quantum", "proc.yield"),
    Syscall(4, "time", "time", "-", "ticks", "Monotonic scheduler ticks", "time.read"),
    Syscall(5, "brk", "mem", "addr", "break", "Adjust the program break", "mem.alloc"),
    Syscall(6, "mmap", "mem", "len, prot", "addr", "Map physical frames", "mem.alloc"),
    Syscall(7, "munmap", "mem", "addr, len", "0", "Return frames to the allocator", "mem.free"),
    Syscall(8, "surface_create", "gfx", "w, h", "handle", "Allocate a render surface", "gfx.surface"),
    Syscall(9, "surface_present", "gfx", "handle", "0", "Present to the framebuffer", "gfx.present"),
    Syscall(10, "surface_blit", "gfx", "dst, src, rect", "0", "Composite one surface onto another", "gfx.blit"),
    Syscall(11, "open", "fs", "path, flags", "fd", "Open a path in the sandbox", "fs.read"),
    Syscall(12, "close", "fs", "fd", "0", "Close a descriptor", "fs.read"),
    Syscall(13, "read", "fs", "fd, buf, len", "bytes", "Read from a descriptor", "fs.read"),
    Syscall(14, "write_fd", "fs", "fd, buf, len", "bytes", "Write to a descriptor", "fs.write"),
    Syscall(15, "stat", "fs", "path, out", "0", "Metadata for a path", "fs.read"),
    Syscall(16, "spawn", "proc", "entry, arg", "pid", "Start a kernel thread", "proc.spawn"),
    Syscall(17, "wait", "proc", "pid", "status", "Reap a thread", "proc.spawn"),
    Syscall(18, "signal", "ipc", "pid, sig", "0", "Deliver a signal", "ipc.signal"),
    Syscall(19, "ipc_send", "ipc", "channel, msg", "0", "Send on a channel", "ipc.send"),
    Syscall(20, "ipc_recv", "ipc", "channel, out", "bytes", "Receive from a channel", "ipc.recv"),
    Syscall(21, "agent_query", "agent", "role, out", "0", "Ask the pipeline about a role", "agent.query"),
    Syscall(22, "uptime", "time", "-", "millis", "Milliseconds since boot", "time.read"),
    Syscall(23, "sleep", "time", "ms", "0", "Sleep for a duration", "time.sleep"),
    Syscall(24, "info", "proc", "field", "value", "Kernel counters (free frames, threads)", "proc.info"),
]

BY_NAME: Dict[str, Syscall] = {call.name: call for call in SYSCALLS}
BY_NUMBER: Dict[int, Syscall] = {call.number: call for call in SYSCALLS}

MAX_SURFACE_BYTES = 64 * 1024 * 1024
MAX_SURFACES = 128
MAX_FRAMES = 4096
FRAME_SIZE = 4096
MAX_IPC_MESSAGES = 256
MAX_READ_BYTES = 1 * 1024 * 1024


@dataclass
class AuditRecord:
    seq: int
    at: float
    call: str
    domain: str
    args: Dict[str, Any]
    verdict: str
    result: Any = None
    errno: Optional[int] = None
    reason: str = ""

    def as_dict(self) -> Dict[str, Any]:
        out = {
            "seq": self.seq,
            "at": round(self.at, 6),
            "call": self.call,
            "domain": self.domain,
            "args": self.args,
            "verdict": self.verdict,
        }
        if self.result is not None:
            out["result"] = self.result
        if self.errno is not None:
            out["errno"] = self.errno
            out["error"] = ERRNO_NAMES.get(self.errno, str(self.errno))
        if self.reason:
            out["reason"] = self.reason
        return out


@dataclass
class Broker:
    """Ring-3 syscall proxy with policy, accounting and an audit trail."""

    root: Path
    read_only: bool = False
    audit_path: Optional[Path] = None
    max_surface_bytes: int = MAX_SURFACE_BYTES
    max_frames: int = MAX_FRAMES
    started_at: float = field(default_factory=time.monotonic)

    audit: List[AuditRecord] = field(default_factory=list)
    surfaces: Dict[int, Dict[str, int]] = field(default_factory=dict)
    frames_in_use: int = 0
    channels: Dict[str, List[str]] = field(default_factory=dict)
    threads: List[Dict[str, Any]] = field(default_factory=list)
    handles: Dict[int, Path] = field(default_factory=dict)
    _next_handle: int = 3
    _seq: int = 0

    # -- plumbing ---------------------------------------------------------
    def __post_init__(self) -> None:
        self.root = Path(self.root).resolve()
        if self.audit_path is not None:
            self.audit_path = Path(self.audit_path)

    def _record(self, record: AuditRecord) -> None:
        self.audit.append(record)
        if self.audit_path is None:
            return
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)
        with self.audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record.as_dict(), sort_keys=True) + "\n")

    def call(self, name: str, **args: Any) -> Any:
        """Dispatch `name` with keyword arguments. Every path is audited."""
        self._seq += 1
        seq = self._seq
        now = time.monotonic()
        definition = BY_NAME.get(name)
        if definition is None:
            self._record(
                AuditRecord(seq, now, name, "?", args, "denied", errno=ENOSYS,
                            reason="unknown syscall")
            )
            raise SyscallError(ENOSYS, f"unknown syscall {name!r}")

        handler: Optional[Callable[..., Any]] = getattr(self, f"_sys_{name}", None)
        if handler is None:
            self._record(
                AuditRecord(seq, now, name, definition.domain, args, "denied",
                            errno=ENOSYS, reason="not implemented in this broker")
            )
            raise SyscallError(ENOSYS, f"{name} is not implemented in this broker")

        try:
            result = handler(**args)
        except SyscallError as error:
            self._record(
                AuditRecord(seq, now, name, definition.domain, args, "denied",
                            errno=error.errno, reason=error.reason)
            )
            raise
        except TypeError as error:
            self._record(
                AuditRecord(seq, now, name, definition.domain, args, "denied",
                            errno=EINVAL, reason=f"bad arguments: {error}")
            )
            raise SyscallError(EINVAL, f"bad arguments for {name}: {error}") from error
        self._record(
            AuditRecord(seq, now, name, definition.domain, args, "allowed", result=result)
        )
        return result

    # -- policy -----------------------------------------------------------
    def resolve(self, path: str) -> Path:
        """Maps a caller path into the sandbox, refusing escapes."""
        if path in ("", "."):
            return self.root
        candidate = path
        if candidate.startswith("~"):
            candidate = candidate[1:].lstrip("/")
        target = (self.root / candidate).resolve() if not os.path.isabs(candidate) else Path(candidate).resolve()
        try:
            target.relative_to(self.root)
        except ValueError as error:
            raise SyscallError(EACCES, f"path escapes the sandbox: {path}") from error
        return target

    # -- fs ---------------------------------------------------------------
    def _sys_open(self, path: str, flags: str = "r") -> int:
        target = self.resolve(path)
        if not target.exists():
            raise SyscallError(ENOENT, f"no such path: {path}")
        if flags not in ("r", "w"):
            raise SyscallError(EINVAL, f"unsupported flags {flags!r}")
        if flags == "w" and self.read_only:
            raise SyscallError(EPERM, "sandbox is read-only")
        handle = self._next_handle
        self._next_handle += 1
        self.handles[handle] = target
        return handle

    def _sys_close(self, fd: int) -> int:
        if fd not in self.handles:
            raise SyscallError(EINVAL, f"bad descriptor {fd}")
        del self.handles[fd]
        return 0

    def _sys_read(self, fd: int, len: int = 4096) -> str:
        target = self.handles.get(fd)
        if target is None:
            raise SyscallError(EINVAL, f"bad descriptor {fd}")
        if len <= 0 or len > MAX_READ_BYTES:
            raise SyscallError(EINVAL, f"bad length {len}")
        if target.is_dir():
            return "\n".join(sorted(entry.name for entry in target.iterdir()))
        return target.read_text(encoding="utf-8", errors="replace")[:len]

    def _sys_write_fd(self, fd: int, buf: str = "") -> int:
        if self.read_only:
            raise SyscallError(EPERM, "sandbox is read-only")
        target = self.handles.get(fd)
        if target is None:
            raise SyscallError(EINVAL, f"bad descriptor {fd}")
        target.write_text(buf, encoding="utf-8")
        return len(buf)

    def _sys_stat(self, path: str) -> Dict[str, Any]:
        target = self.resolve(path)
        if not target.exists():
            raise SyscallError(ENOENT, f"no such path: {path}")
        info = target.stat()
        return {
            "path": str(target.relative_to(self.root)) or ".",
            "kind": "dir" if target.is_dir() else "file",
            "bytes": 0 if target.is_dir() else info.st_size,
            "modified": int(info.st_mtime),
        }

    # -- mem --------------------------------------------------------------
    def _sys_mmap(self, len: int = FRAME_SIZE, prot: str = "rw") -> int:
        frames = max(1, (int(len) + FRAME_SIZE - 1) // FRAME_SIZE)
        if prot not in ("r", "rw", "rx"):
            raise SyscallError(EINVAL, f"bad protection {prot!r}")
        if self.frames_in_use + frames > self.max_frames:
            raise SyscallError(ENOMEM, "frame budget exhausted")
        self.frames_in_use += frames
        return frames * FRAME_SIZE

    def _sys_munmap(self, len: int = FRAME_SIZE) -> int:
        frames = max(1, (int(len) + FRAME_SIZE - 1) // FRAME_SIZE)
        self.frames_in_use = max(0, self.frames_in_use - frames)
        return 0

    def _sys_brk(self, addr: int = 0) -> int:
        if addr < 0:
            raise SyscallError(EINVAL, "negative break")
        return int(addr)

    # -- gfx --------------------------------------------------------------
    def _sys_surface_create(self, w: int = 0, h: int = 0) -> int:
        w, h = int(w), int(h)
        if w <= 0 or h <= 0 or w > 8192 or h > 8192:
            raise SyscallError(EINVAL, f"bad surface size {w}x{h}")
        cost = w * h * 4
        in_use = sum(s["bytes"] for s in self.surfaces.values())
        if len(self.surfaces) >= MAX_SURFACES:
            raise SyscallError(ENOSPC, "surface table full")
        if in_use + cost > self.max_surface_bytes:
            raise SyscallError(ENOMEM, "surface budget exceeded")
        handle = 1 + len(self.surfaces)
        self.surfaces[handle] = {"w": w, "h": h, "bytes": cost}
        return handle

    def _sys_surface_present(self, handle: int = 0) -> int:
        if int(handle) not in self.surfaces:
            raise SyscallError(EINVAL, f"unknown surface {handle}")
        return 0

    def _sys_surface_blit(self, dst: int = 0, src: int = 0) -> int:
        for handle in (dst, src):
            if int(handle) not in self.surfaces:
                raise SyscallError(EINVAL, f"unknown surface {handle}")
        return 0

    # -- proc -------------------------------------------------------------
    def _sys_yield(self) -> int:
        return 0

    def _sys_exit(self, code: int = 0) -> int:
        return int(code)

    def _sys_spawn(self, entry: str = "thread", arg: str = "") -> int:
        if len(self.threads) >= 64:
            raise SyscallError(EAGAIN, "thread table full")
        self.threads.append({"pid": len(self.threads) + 1, "entry": entry, "arg": arg})
        return len(self.threads)

    def _sys_wait(self, pid: int = 0) -> Dict[str, Any]:
        for thread in self.threads:
            if thread["pid"] == int(pid):
                return {"pid": thread["pid"], "status": 0}
        raise SyscallError(ENOENT, f"no such thread {pid}")

    def _sys_info(self, field: str = "free_frames") -> Any:
        if field == "free_frames":
            return self.max_frames - self.frames_in_use
        if field == "threads":
            return len(self.threads)
        if field == "surfaces":
            return len(self.surfaces)
        if field == "uptime_ms":
            return int((time.monotonic() - self.started_at) * 1000)
        raise SyscallError(EINVAL, f"unknown info field {field!r}")

    # -- ipc --------------------------------------------------------------
    def _sys_signal(self, pid: int = 0, sig: str = "SIGTERM") -> int:
        if sig not in ("SIGTERM", "SIGINT", "SIGUSR1", "SIGUSR2", "SIGCHLD"):
            raise SyscallError(EINVAL, f"unknown signal {sig!r}")
        if not any(t["pid"] == int(pid) for t in self.threads):
            raise SyscallError(ENOENT, f"no such thread {pid}")
        return 0

    def _sys_ipc_send(self, channel: str = "", msg: str = "") -> int:
        if not channel:
            raise SyscallError(EINVAL, "empty channel")
        queue = self.channels.setdefault(channel, [])
        if len(queue) >= MAX_IPC_MESSAGES:
            raise SyscallError(EAGAIN, f"channel {channel} is full")
        queue.append(msg)
        return 0

    def _sys_ipc_recv(self, channel: str = "") -> str:
        queue = self.channels.get(channel, [])
        if not queue:
            raise SyscallError(EAGAIN, f"channel {channel} is empty")
        return queue.pop(0)

    # -- time -------------------------------------------------------------
    def _sys_time(self) -> int:
        return int((time.monotonic() - self.started_at) * 100)

    def _sys_uptime(self) -> int:
        return int((time.monotonic() - self.started_at) * 1000)

    def _sys_sleep(self, ms: int = 0) -> int:
        delay = int(ms)
        if delay < 0 or delay > 60_000:
            raise SyscallError(EINVAL, f"bad sleep {ms}")
        return 0  # the broker never blocks the caller; the scheduler does

    # -- agent ------------------------------------------------------------
    def _sys_agent_query(self, role: str = "") -> Dict[str, Any]:
        manifest = load_manifest(self.root / "agents" / "manifest.json")
        for agent in manifest["agents"]:
            if agent["role"] == role:
                return agent
        raise SyscallError(ENOENT, f"no such agent {role!r}")

    # -- io ---------------------------------------------------------------
    def _sys_write(self, fd: int = 1, buf: str = "") -> int:
        if int(fd) not in (0, 1, 2):
            raise SyscallError(EINVAL, f"bad stream {fd}")
        return len(buf)


# ---------------------------------------------------------------------------
# Manifest helpers
# ---------------------------------------------------------------------------
def load_manifest(path: Path) -> Dict[str, Any]:
    if not Path(path).exists():
        raise FileNotFoundError(f"agent manifest missing: {path}")
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def describe_surface() -> Dict[str, Any]:
    return {
        "os": f"Lumina {VERSION} ({CODENAME})",
        "syscall_count": len(SYSCALLS),
        "domains": sorted({call.domain for call in SYSCALLS}),
        "syscalls": [
            {
                "number": call.number,
                "name": call.name,
                "domain": call.domain,
                "args": call.args,
                "returns": call.returns,
                "capability": call.capability,
                "summary": call.summary,
            }
            for call in SYSCALLS
        ],
    }


# ---------------------------------------------------------------------------
# The shell: how a terminal line becomes syscalls. Everything the Terminal app
# prints for these commands is produced here, so the app and the CLI cannot
# disagree.
# ---------------------------------------------------------------------------
def shell_exec(broker: Broker, line: str) -> tuple[List[str], int]:
    line = line.strip()
    if not line:
        return [], 0
    try:
        parts = shlex.split(line)
    except ValueError as error:
        return [f"parse error: {error}"], 1
    command, args = parts[0], parts[1:]
    out: List[str] = []

    try:
        if command in ("help", "?"):
            broker.call("write", fd=1, buf="help")
            out += [
                "lumina shell — commands",
                "  help                 this list",
                "  lumina               system overview",
                "  ls [path]            list the sandbox",
                "  cat <file>           print a file",
                "  stat <path>          metadata via SYS_STAT",
                "  agents [role]        the agent pipeline",
                "  syscalls             the 24-call surface",
                "  sysinfo              broker counters",
                "  audit [n]            last n audit records",
                "  spawn <entry>        start a thread",
                "  signal <pid> <sig>   signal a thread",
                "  clear                clear the screen",
                "  version              build identity",
            ]
            return out, 0

        if command in ("lumina", "neofetch"):
            info = broker.call("info", field="uptime_ms")
            out += [
                "        #        lumina@crystal",
                "       ###       -------------",
                "      #####      OS       Lumina 1.0 (crystal)",
                "   ##########    Kernel   rust · x86_64 · preempt",
                "                 Shell    c++17 · software compositor",
                "                 Broker   python 3 · 24 syscalls",
                f"                 Uptime   {info // 1000}s",
                "                 Agents   9 roles · 1 manifest",
            ]
            return out, 0

        if command == "ls":
            path = args[0] if args else "."
            out += broker.call("read", fd=broker.call("open", path=path), len=MAX_READ_BYTES).splitlines()
            return out, 0

        if command == "cat":
            if not args:
                raise SyscallError(EINVAL, "usage: cat <file>")
            text = broker.call("read", fd=broker.call("open", path=args[0]), len=MAX_READ_BYTES)
            return text.splitlines(), 0

        if command == "stat":
            if not args:
                raise SyscallError(EINVAL, "usage: stat <path>")
            info = broker.call("stat", path=args[0])
            out += [f"{key:<10} {value}" for key, value in info.items()]
            return out, 0

        if command == "agents":
            manifest = load_manifest(broker.root / "agents" / "manifest.json")
            if args:
                agent = broker.call("agent_query", role=args[0])
                out += [f"{agent['role']}  ({agent['language']})"]
                out += [f"  target   {agent['target']}"]
                out += [f"  owns     {agent['owns']}"]
                out += [f"  skills   {', '.join(agent['skills'])}"]
                out += [f"  outputs  {', '.join(agent['outputs'])}"]
                return out, 0
            out.append(f"agent pipeline — {len(manifest['agents'])} roles, 1 manifest")
            for agent in manifest["agents"]:
                out.append(
                    f"  {agent['role']:<21}{agent['target']:<18}{agent['status']:<8}"
                    f"{agent['language']}"
                )
            return out, 0

        if command == "syscalls":
            out.append(f"{len(SYSCALLS)} calls across {len({c.domain for c in SYSCALLS})} domains")
            for domain in sorted({call.domain for call in SYSCALLS}):
                names = " ".join(call.name for call in SYSCALLS if call.domain == domain)
                out.append(f"  {domain:<6} {names}")
            out.append("every call is brokered, typed and audited by tools/lumina/sysd.py")
            return out, 0

        if command == "sysinfo":
            out += [
                f"free_frames  {broker.call('info', field='free_frames')}",
                f"threads      {broker.call('info', field='threads')}",
                f"surfaces     {broker.call('info', field='surfaces')}",
                f"uptime_ms    {broker.call('info', field='uptime_ms')}",
                f"audited      {len(broker.audit)}",
            ]
            return out, 0

        if command == "audit":
            count = int(args[0]) if args else 8
            for record in broker.audit[-count:]:
                out.append(json.dumps(record.as_dict(), sort_keys=True))
            return out, 0

        if command == "spawn":
            entry = args[0] if args else "thread"
            out.append(f"pid {broker.call('spawn', entry=entry)}")
            return out, 0

        if command == "signal":
            if len(args) < 2:
                raise SyscallError(EINVAL, "usage: signal <pid> <sig>")
            broker.call("signal", pid=int(args[0]), sig=args[1])
            out.append(f"signal {args[1]} -> {args[0]}")
            return out, 0

        if command == "clear":
            return ["\x0c"], 0

        if command == "version":
            out.append(f"Lumina {VERSION} ({CODENAME}) — rust kernel, c++17 shell, python broker")
            return out, 0

        raise SyscallError(ENOENT, f"{command}: command not found — try 'help'")
    except SyscallError as error:
        return [f"{command}: {error}"], 1


# ---------------------------------------------------------------------------
# Self-test: the invariants that make the surface trustworthy.
# ---------------------------------------------------------------------------
def self_test(verbose: bool = True) -> int:
    failures: List[str] = []
    checks = 0

    def check(name: str, condition: bool) -> None:
        nonlocal checks
        checks += 1
        if verbose:
            print(f"  {'ok  ' if condition else 'FAIL'} {name}")
        if not condition:
            failures.append(name)

    numbers = [call.number for call in SYSCALLS]
    check("numbers are 1..24 without gaps", numbers == list(range(1, 25)))
    check("names are unique", len({call.name for call in SYSCALLS}) == len(SYSCALLS))
    check("every call has a capability", all(call.capability for call in SYSCALLS))
    check("every domain has a handler", all(
        hasattr(Broker, f"_sys_{call.name}") or call.name in {"open"}
        for call in SYSCALLS
    ))

    root = Path(__file__).resolve().parent.parent.parent
    broker = Broker(root=root, read_only=True)

    check("policy refuses traversal", _expect_error(broker, "open", EACCES, path="../../etc/passwd"))
    check("missing path is ENOENT", _expect_error(broker, "open", ENOENT, path="definitely-missing"))
    check("read-only refuses writes", _expect_error(broker, "write_fd", EPERM, fd=3, buf="x"))
    check("unknown syscall is ENOSYS", _expect_error(broker, "frobnicate", ENOSYS))
    check("surface budget is enforced", _expect_error(
        broker, "surface_create", ENOMEM, w=8192, h=8192))
    check("bad surface size is EINVAL", _expect_error(broker, "surface_create", EINVAL, w=0, h=10))
    delivered = broker.call("ipc_send", channel="test", msg="ping")
    check("ipc send/recv round-trips", delivered == 0 and broker.call("ipc_recv", channel="test") == "ping")
    check("empty channel is EAGAIN", _expect_error(broker, "ipc_recv", EAGAIN, channel="empty"))

    manifest_path = root / "agents" / "manifest.json"
    if manifest_path.exists():
        manifest = load_manifest(manifest_path)
        # It is legitimate for main to have created its own manifest entry.
        roles = [agent["role"] for agent in manifest["agents"]]
        check("manifest roles are unique", len(roles) == len(set(roles)))
        check("manifest covers the 9 pipeline roles", len(roles) >= 9)
        declared = {cap for agent in manifest["agents"] for cap in agent["capabilities"]}
        known = {call.capability for call in SYSCALLS}
        check("manifest capabilities exist in the surface", declared <= known)

    # Audit trail integrity: sequence numbers are strictly increasing.
    seqs = [record.seq for record in broker.audit]
    check("audit sequence is monotonic", seqs == sorted(seqs) and len(set(seqs)) == len(seqs))

    # Cross-language parity with the Rust kernel table.
    rust_table = parse_rust_table(root / "kernel" / "src" / "syscall.rs")
    if rust_table:
        check("rust kernel table matches python surface",
              [(n, name) for n, name in rust_table] == [(c.number, c.name) for c in SYSCALLS])
    else:
        check("rust kernel table found", False)

    if failures:
        print(f"\n{len(failures)} failure(s): {', '.join(failures)}")
        return 1
    if verbose:
        print(f"\n{checks} invariants hold over {len(SYSCALLS)} syscalls "
              f"({len(broker.audit)} calls audited)")
    return 0


def _expect_error(broker: Broker, call: str, errno: int, **args: Any) -> bool:
    try:
        broker.call(call, **args)
    except SyscallError as error:
        return error.errno == errno
    return False


def parse_rust_table(path: Path) -> List[tuple[int, str]]:
    """Extracts (number, name) pairs from the kernel's `SYS_TABLE` literal.

    The kernel writes `number: SYS_WRITE` (a named constant) rather than a bare
    literal, so the constants are resolved from the same file first.
    """
    if not path.exists():
        return []
    source = path.read_text(encoding="utf-8")
    constants: Dict[str, int] = {}
    for raw in source.splitlines():
        line = raw.strip()
        if line.startswith("pub const SYS_") and "u64" in line and "=" in line:
            name, _, value = line.partition("=")
            name = name.split("pub const")[1].split(":")[0].strip()
            value = value.strip().rstrip(";")
            if value.isdigit():
                constants[name] = int(value)

    entries: List[tuple[int, str]] = []
    inside = False
    for raw in source.splitlines():
        line = raw.strip()
        if "SYS_TABLE:" in line:
            inside = True
            continue
        if not inside:
            continue
        if line.startswith("];"):
            break
        if not line.startswith("SyscallDef"):
            continue
        number_token = _token(line, "number")
        name = _string_field(line, "name")
        if number_token is None or name is None:
            continue
        if number_token.isdigit():
            entries.append((int(number_token), name))
        elif number_token in constants:
            entries.append((constants[number_token], name))
    return entries


def _token(line: str, key: str) -> Optional[str]:
    """Returns the identifier/literal that follows `key:` on a table row."""
    marker = f"{key}:"
    index = line.find(marker)
    if index < 0:
        return None
    rest = line[index + len(marker):].lstrip()
    token = ""
    while rest and (rest[0].isalnum() or rest[0] == "_"):
        token += rest[0]
        rest = rest[1:]
    return token or None


def _string_field(line: str, key: str) -> Optional[str]:
    marker = f'{key}: "'
    index = line.find(marker)
    if index < 0:
        return None
    rest = line[index + len(marker):]
    end = rest.find('"')
    return rest[:end] if end >= 0 else None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="sysd",
        description="Lumina syscall broker (ring 3 half of the int 0x80 surface)",
    )
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent.parent),
                        help="sandbox root (default: the Lumina tree)")
    parser.add_argument("--list", action="store_true", help="print the syscall surface")
    parser.add_argument("--describe", action="store_true", help="print the surface as JSON")
    parser.add_argument("--call", metavar="NAME", help="perform one audited syscall")
    parser.add_argument("--args", nargs="*", default=[], metavar="k=v",
                        help="keyword arguments for --call")
    parser.add_argument("--exec", metavar="LINE", help="run a shell line through the broker")
    parser.add_argument("--self-test", action="store_true", help="run the invariant suite")
    parser.add_argument("--audit", metavar="PATH", help="append audit records as JSONL")
    parser.add_argument("--read-only", action="store_true", help="refuse mutating calls")
    parser.add_argument("--version", action="version", version=f"Lumina {VERSION} ({CODENAME})")
    options = parser.parse_args(list(argv) if argv is not None else None)

    if options.list:
        print(f"{len(SYSCALLS)} syscalls — Lumina {VERSION} ({CODENAME})")
        for call in SYSCALLS:
            print(f"  {call.number:>2}  {call.name:<16} {call.domain:<6} "
                  f"({call.args}) -> {call.returns}")
            print(f"      {call.summary}")
        return 0

    if options.describe:
        print(json.dumps(describe_surface(), indent=2, sort_keys=True))
        return 0

    if options.self_test:
        print("lumina syscall broker — invariant suite")
        return self_test()

    broker = Broker(
        root=Path(options.root),
        read_only=options.read_only,
        audit_path=Path(options.audit) if options.audit else None,
    )

    if options.call:
        kwargs: Dict[str, Any] = {}
        for item in options.args:
            if "=" not in item:
                print(f"bad argument {item!r}: expected k=v", file=sys.stderr)
                return 2
            key, value = item.split("=", 1)
            kwargs[key] = _coerce(value)
        try:
            result = broker.call(options.call, **kwargs)
        except SyscallError as error:
            print(str(error), file=sys.stderr)
            return 1
        print(json.dumps(result, sort_keys=True) if not isinstance(result, str) else result)
        return 0

    if options.exec is not None:
        lines, code = shell_exec(broker, options.exec)
        for line in lines:
            print(line.replace("\x0c", "<clear>"))
        return code

    parser.print_help()
    return 0


def _coerce(value: str) -> Any:
    if value.isdigit() or (value.startswith("-") and value[1:].isdigit()):
        return int(value)
    if value in ("true", "false"):
        return value == "true"
    return value


if __name__ == "__main__":
    sys.exit(main())
