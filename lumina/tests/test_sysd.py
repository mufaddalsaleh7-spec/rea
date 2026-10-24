"""Lumina OS — broker, manifest and pipeline tests (stdlib unittest).

Run from the repository root:

    python3 -m unittest discover -s lumina/tests -p 'test_*.py' -v
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
sys.path.insert(0, str(ROOT / "tools" / "lumina"))
sys.path.insert(0, str(ROOT / "agents"))

import orchestrator  # noqa: E402
import sysd  # noqa: E402


class SurfaceTests(unittest.TestCase):
    def test_numbers_are_dense_and_ordered(self) -> None:
        self.assertEqual([c.number for c in sysd.SYSCALLS], list(range(1, 25)))

    def test_names_and_numbers_are_unique(self) -> None:
        self.assertEqual(len(sysd.BY_NAME), len(sysd.SYSCALLS))
        self.assertEqual(len(sysd.BY_NUMBER), len(sysd.SYSCALLS))

    def test_every_call_declares_domain_args_and_capability(self) -> None:
        for call in sysd.SYSCALLS:
            with self.subTest(call=call.name):
                self.assertTrue(call.domain)
                self.assertTrue(call.args)
                self.assertTrue(call.returns)
                self.assertTrue(call.capability)
                self.assertTrue(call.summary)

    def test_domains_are_from_the_documented_set(self) -> None:
        allowed = {"io", "proc", "mem", "gfx", "fs", "ipc", "time", "agent"}
        self.assertTrue({c.domain for c in sysd.SYSCALLS} <= allowed)

    def test_every_call_has_an_implementation(self) -> None:
        for call in sysd.SYSCALLS:
            with self.subTest(call=call.name):
                self.assertTrue(hasattr(sysd.Broker, f"_sys_{call.name}"),
                                f"{call.name} has no broker handler")

    def test_rust_kernel_table_matches(self) -> None:
        rust = sysd.parse_rust_table(ROOT / "kernel" / "src" / "syscall.rs")
        self.assertTrue(rust, "could not parse the kernel SYS_TABLE")
        self.assertEqual(rust, [(c.number, c.name) for c in sysd.SYSCALLS])

    def test_describe_is_json_serialisable(self) -> None:
        described = sysd.describe_surface()
        self.assertEqual(described["syscall_count"], 24)
        json.dumps(described)
        self.assertEqual(described["domains"], sorted(described["domains"]))


class PolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "notes").mkdir()
        (self.root / "notes" / "hello.md").write_text("hello lumina\n", encoding="utf-8")
        (self.root / "agents").mkdir()
        self.broker = sysd.Broker(root=self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_reads_within_the_sandbox(self) -> None:
        fd = self.broker.call("open", path="notes/hello.md")
        self.assertEqual(self.broker.call("read", fd=fd), "hello lumina\n")

    def test_directory_reads_list_entries(self) -> None:
        fd = self.broker.call("open", path="notes")
        self.assertEqual(self.broker.call("read", fd=fd), "hello.md")

    def test_traversal_is_denied(self) -> None:
        with self.assertRaises(sysd.SyscallError) as ctx:
            self.broker.call("open", path="../outside")
        self.assertEqual(ctx.exception.errno, sysd.EACCES)
        self.assertIn("sandbox", ctx.exception.reason)

    def test_absolute_escape_is_denied(self) -> None:
        with self.assertRaises(sysd.SyscallError) as ctx:
            self.broker.call("open", path="/etc/passwd")
        self.assertEqual(ctx.exception.errno, sysd.EACCES)

    def test_home_prefix_stays_inside(self) -> None:
        fd = self.broker.call("open", path="~/notes/hello.md")
        self.assertEqual(self.broker.call("read", fd=fd), "hello lumina\n")

    def test_missing_path_is_enoent(self) -> None:
        with self.assertRaises(sysd.SyscallError) as ctx:
            self.broker.call("stat", path="nope")
        self.assertEqual(ctx.exception.errno, sysd.ENOENT)

    def test_bad_descriptor_is_einval(self) -> None:
        with self.assertRaises(sysd.SyscallError) as ctx:
            self.broker.call("read", fd=99)
        self.assertEqual(ctx.exception.errno, sysd.EINVAL)

    def test_unknown_syscall_is_enosys(self) -> None:
        with self.assertRaises(sysd.SyscallError) as ctx:
            self.broker.call("teleport")
        self.assertEqual(ctx.exception.errno, sysd.ENOSYS)

    def test_bad_arguments_are_einval_and_audited(self) -> None:
        with self.assertRaises(sysd.SyscallError) as ctx:
            self.broker.call("open")  # `path` is required
        self.assertEqual(ctx.exception.errno, sysd.EINVAL)
        self.assertEqual(self.broker.audit[-1].verdict, "denied")

    def test_read_only_refuses_writes(self) -> None:
        broker = sysd.Broker(root=self.root, read_only=True)
        with self.assertRaises(sysd.SyscallError) as ctx:
            broker.call("open", path="notes/hello.md", flags="w")
        self.assertEqual(ctx.exception.errno, sysd.EPERM)

    def test_write_round_trip(self) -> None:
        fd = self.broker.call("open", path="notes/hello.md", flags="w")
        self.assertEqual(self.broker.call("write_fd", fd=fd, buf="rewritten"), 9)
        self.assertEqual((self.root / "notes" / "hello.md").read_text(), "rewritten")

    def test_stat_reports_kind_and_size(self) -> None:
        info = self.broker.call("stat", path="notes/hello.md")
        self.assertEqual(info["kind"], "file")
        self.assertEqual(info["bytes"], len("hello lumina\n"))
        directory = self.broker.call("stat", path="notes")
        self.assertEqual(directory["kind"], "dir")


class BudgetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.broker = sysd.Broker(root=Path(self.tmp.name))

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_frame_budget_is_enforced(self) -> None:
        self.broker.max_frames = 4
        self.broker.call("mmap", len=sysd.FRAME_SIZE * 2)
        with self.assertRaises(sysd.SyscallError) as ctx:
            self.broker.call("mmap", len=sysd.FRAME_SIZE * 3)
        self.assertEqual(ctx.exception.errno, sysd.ENOMEM)
        self.broker.call("munmap", len=sysd.FRAME_SIZE * 2)
        self.assertEqual(self.broker.call("mmap", len=sysd.FRAME_SIZE * 3), sysd.FRAME_SIZE * 3)

    def test_surface_budget_is_enforced(self) -> None:
        self.broker.max_surface_bytes = 1024 * 1024
        self.broker.call("surface_create", w=256, h=256)  # 256 KiB
        self.broker.call("surface_create", w=256, h=256)
        with self.assertRaises(sysd.SyscallError) as ctx:
            self.broker.call("surface_create", w=1024, h=1024)
        self.assertEqual(ctx.exception.errno, sysd.ENOMEM)

    def test_surface_handles_are_unique_and_presentable(self) -> None:
        first = self.broker.call("surface_create", w=100, h=100)
        second = self.broker.call("surface_create", w=200, h=200)
        self.assertNotEqual(first, second)
        self.assertEqual(self.broker.call("surface_present", handle=first), 0)
        with self.assertRaises(sysd.SyscallError):
            self.broker.call("surface_present", handle=999)

    def test_invalid_surface_sizes(self) -> None:
        for w, h in ((0, 10), (10, 0), (9000, 10), (-4, 10)):
            with self.subTest(w=w, h=h):
                with self.assertRaises(sysd.SyscallError) as ctx:
                    self.broker.call("surface_create", w=w, h=h)
                self.assertEqual(ctx.exception.errno, sysd.EINVAL)

    def test_ipc_bounded_queue(self) -> None:
        for i in range(sysd.MAX_IPC_MESSAGES):
            self.broker.call("ipc_send", channel="bus", msg=str(i))
        with self.assertRaises(sysd.SyscallError) as ctx:
            self.broker.call("ipc_send", channel="bus", msg="overflow")
        self.assertEqual(ctx.exception.errno, sysd.EAGAIN)
        self.assertEqual(self.broker.call("ipc_recv", channel="bus"), "0")

    def test_sleep_bounds(self) -> None:
        self.assertEqual(self.broker.call("sleep", ms=10), 0)
        with self.assertRaises(sysd.SyscallError):
            self.broker.call("sleep", ms=10_000_000)

    def test_thread_lifecycle(self) -> None:
        pid = self.broker.call("spawn", entry="compose")
        self.assertEqual(pid, 1)
        self.assertEqual(self.broker.call("wait", pid=pid)["status"], 0)
        self.assertEqual(self.broker.call("signal", pid=pid, sig="SIGTERM"), 0)
        with self.assertRaises(sysd.SyscallError):
            self.broker.call("signal", pid=99, sig="SIGTERM")


class AuditTests(unittest.TestCase):
    def test_audit_records_every_verdict(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "audit.jsonl"
            broker = sysd.Broker(root=ROOT, audit_path=log)
            broker.call("surface_create", w=64, h=64)
            with self.assertRaises(sysd.SyscallError):
                broker.call("open", path="../../escape")
            lines = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual([entry["verdict"] for entry in lines], ["allowed", "denied"])
            self.assertEqual(lines[1]["error"], "EACCES")
            self.assertEqual(lines[0]["call"], "surface_create")
            self.assertEqual(lines[0]["seq"], 1)
            self.assertEqual(lines[1]["seq"], 2)

    def test_audit_sequence_is_monotonic(self) -> None:
        broker = sysd.Broker(root=ROOT)
        for _ in range(5):
            broker.call("uptime")
        sequence = [record.seq for record in broker.audit]
        self.assertEqual(sequence, sorted(sequence))
        self.assertEqual(len(set(sequence)), len(sequence))


class ShellTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.broker = sysd.Broker(root=ROOT, read_only=True)

    def run_line(self, line: str) -> tuple[list[str], int]:
        return sysd.shell_exec(self.broker, line)

    def test_help_lists_commands(self) -> None:
        lines, code = self.run_line("help")
        self.assertEqual(code, 0)
        self.assertTrue(any("lumina shell" in line for line in lines))

    def test_lumina_overview(self) -> None:
        lines, code = self.run_line("lumina")
        self.assertEqual(code, 0)
        self.assertTrue(any("Lumina 1.0" in line for line in lines))

    def test_agents_reads_the_manifest(self) -> None:
        lines, code = self.run_line("agents")
        self.assertEqual(code, 0)
        self.assertIn("9 roles", lines[0])
        self.assertEqual(len(lines), 10)

    def test_agents_single_role(self) -> None:
        lines, code = self.run_line("agents qa-engineer")
        self.assertEqual(code, 0)
        self.assertTrue(any("qa-engineer" in line for line in lines))
        self.assertTrue(any("owns" in line for line in lines))

    def test_syscalls_lists_every_name(self) -> None:
        lines, code = self.run_line("syscalls")
        self.assertEqual(code, 0)
        joined = " ".join(lines)
        for call in sysd.SYSCALLS:
            self.assertIn(call.name, joined)

    def test_unknown_command_reports_and_fails(self) -> None:
        lines, code = self.run_line("frobnicate now")
        self.assertEqual(code, 1)
        self.assertIn("not found", lines[0])

    def test_stat_and_cat(self) -> None:
        lines, code = self.run_line("stat agents/manifest.json")
        self.assertEqual(code, 0)
        self.assertTrue(any(line.startswith("bytes") for line in lines))
        lines, code = self.run_line("cat README.md")
        self.assertEqual(code, 0)
        self.assertTrue(lines)

    def test_empty_line_is_a_no_op(self) -> None:
        self.assertEqual(self.run_line("   "), ([], 0))

    def test_clear_returns_control_sequence(self) -> None:
        lines, _ = self.run_line("clear")
        self.assertEqual(lines, ["\x0c"])


class ManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads((ROOT / "agents" / "manifest.json").read_text())
        cls.repo = REPO

    def test_schema_and_languages(self) -> None:
        self.assertEqual(self.manifest["schema"], "lumina.agents/1")
        self.assertEqual(self.manifest["languages"], ["C++", "Rust", "Python"])

    def test_nine_roles_are_unique(self) -> None:
        roles = [agent["role"] for agent in self.manifest["agents"]]
        self.assertEqual(len(roles), 9)
        self.assertEqual(len(set(roles)), 9)

    def test_every_agent_owns_a_target_and_outputs(self) -> None:
        for agent in self.manifest["agents"]:
            with self.subTest(agent=agent["role"]):
                self.assertIn(agent["target"], {"kernel", "compositor", "lumina-host", "syscalls"})
                self.assertTrue(agent["outputs"])
                for output in agent["outputs"]:
                    self.assertTrue((REPO / output).exists(), f"missing {output}")

    def test_capabilities_are_within_the_surface(self) -> None:
        surface = {call.capability for call in sysd.SYSCALLS}
        declared = {cap for agent in self.manifest["agents"] for cap in agent["capabilities"]}
        self.assertTrue(declared <= surface, f"unknown capabilities: {declared - surface}")

    def test_orchestrator_check_passes(self) -> None:
        self.assertEqual(orchestrator.check(self.manifest), 0)

    def test_plan_covers_every_agent(self) -> None:
        self.assertEqual(orchestrator.plan(self.manifest), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
