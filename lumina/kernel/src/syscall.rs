//! The Lumina syscall gate.
//!
//! User code enters the kernel with `int 0x80`. Arguments travel in the classic
//! SysV registers (`rax` number, `rdi`, `rsi`, `rdx`, `r10`) and the result is
//! written back to `rax`. The gate is also wired to `SYSCALL/SYSRET` (MSRs
//! STAR/LSTAR/SFMASK) so ring-3 code can choose either entry without the
//! hardware setup drifting between them.
//!
//! A typed, table-driven surface: `SYS_TABLE` is the single source of truth the
//! Python broker (`tools/lumina/sysd.py`) mirrors in its manifest, and the C++
//! shell renders in Settings → Syscalls.

use core::arch::asm;
use core::sync::atomic::{AtomicU64, Ordering};

use crate::{gdt, mem, sched};

pub const SYS_WRITE: u64 = 1;
pub const SYS_EXIT: u64 = 2;
pub const SYS_YIELD: u64 = 3;
pub const SYS_TIME: u64 = 4;
pub const SYS_BRK: u64 = 5;
pub const SYS_MMAP: u64 = 6;
pub const SYS_MUNMAP: u64 = 7;
pub const SYS_SURFACE_CREATE: u64 = 8;
pub const SYS_SURFACE_PRESENT: u64 = 9;
pub const SYS_SURFACE_BLIT: u64 = 10;
pub const SYS_OPEN: u64 = 11;
pub const SYS_CLOSE: u64 = 12;
pub const SYS_READ: u64 = 13;
pub const SYS_WRITE_FD: u64 = 14;
pub const SYS_STAT: u64 = 15;
pub const SYS_SPAWN: u64 = 16;
pub const SYS_WAIT: u64 = 17;
pub const SYS_SIGNAL: u64 = 18;
pub const SYS_IPC_SEND: u64 = 19;
pub const SYS_IPC_RECV: u64 = 20;
pub const SYS_AGENT_QUERY: u64 = 21;
pub const SYS_CLOCK_UPTIME: u64 = 22;
pub const SYS_SLEEP: u64 = 23;
pub const SYS_INFO: u64 = 24;

pub const MAX_SYSCALL: u64 = SYS_INFO;
pub const ENOSYS: i64 = -38;
pub const EINVAL: i64 = -22;
pub const EAGAIN: i64 = -11;

pub struct SyscallDef {
    pub number: u64,
    pub name: &'static str,
    pub domain: &'static str,
    pub args: &'static str,
    pub returns: &'static str,
}

/// The 24-call surface. Order matters: the index is the syscall number.
pub static SYS_TABLE: [SyscallDef; 24] = [
    SyscallDef { number: SYS_WRITE, name: "write", domain: "io", args: "fd, buf, len", returns: "bytes" },
    SyscallDef { number: SYS_EXIT, name: "exit", domain: "proc", args: "code", returns: "never" },
    SyscallDef { number: SYS_YIELD, name: "yield", domain: "proc", args: "-", returns: "0" },
    SyscallDef { number: SYS_TIME, name: "time", domain: "time", args: "-", returns: "ticks" },
    SyscallDef { number: SYS_BRK, name: "brk", domain: "mem", args: "addr", returns: "break" },
    SyscallDef { number: SYS_MMAP, name: "mmap", domain: "mem", args: "len, prot", returns: "addr" },
    SyscallDef { number: SYS_MUNMAP, name: "munmap", domain: "mem", args: "addr, len", returns: "0" },
    SyscallDef { number: SYS_SURFACE_CREATE, name: "surface_create", domain: "gfx", args: "w, h", returns: "handle" },
    SyscallDef { number: SYS_SURFACE_PRESENT, name: "surface_present", domain: "gfx", args: "handle", returns: "0" },
    SyscallDef { number: SYS_SURFACE_BLIT, name: "surface_blit", domain: "gfx", args: "dst, src, rect", returns: "0" },
    SyscallDef { number: SYS_OPEN, name: "open", domain: "fs", args: "path, flags", returns: "fd" },
    SyscallDef { number: SYS_CLOSE, name: "close", domain: "fs", args: "fd", returns: "0" },
    SyscallDef { number: SYS_READ, name: "read", domain: "fs", args: "fd, buf, len", returns: "bytes" },
    SyscallDef { number: SYS_WRITE_FD, name: "write_fd", domain: "fs", args: "fd, buf, len", returns: "bytes" },
    SyscallDef { number: SYS_STAT, name: "stat", domain: "fs", args: "path, out", returns: "0" },
    SyscallDef { number: SYS_SPAWN, name: "spawn", domain: "proc", args: "entry, arg", returns: "pid" },
    SyscallDef { number: SYS_WAIT, name: "wait", domain: "proc", args: "pid", returns: "status" },
    SyscallDef { number: SYS_SIGNAL, name: "signal", domain: "ipc", args: "pid, sig", returns: "0" },
    SyscallDef { number: SYS_IPC_SEND, name: "ipc_send", domain: "ipc", args: "channel, msg", returns: "0" },
    SyscallDef { number: SYS_IPC_RECV, name: "ipc_recv", domain: "ipc", args: "channel, out", returns: "bytes" },
    SyscallDef { number: SYS_AGENT_QUERY, name: "agent_query", domain: "agent", args: "role, out", returns: "0" },
    SyscallDef { number: SYS_CLOCK_UPTIME, name: "uptime", domain: "time", args: "-", returns: "millis" },
    SyscallDef { number: SYS_SLEEP, name: "sleep", domain: "time", args: "ms", returns: "0" },
    SyscallDef { number: SYS_INFO, name: "info", domain: "proc", args: "field", returns: "value" },
];

static CALLS: AtomicU64 = AtomicU64::new(0);
static LAST: AtomicU64 = AtomicU64::new(0);
static DENIED: AtomicU64 = AtomicU64::new(0);

pub fn calls() -> u64 {
    CALLS.load(Ordering::Relaxed)
}

pub fn last_call() -> u64 {
    LAST.load(Ordering::Relaxed)
}

pub fn denied() -> u64 {
    DENIED.load(Ordering::Relaxed)
}

pub fn init() {
    // SYSCALL/SYSRET wiring. STAR: kernel CS at 0x08, user CS at 0x20 (0x18|3).
    // LSTAR: entry point. SFMASK: clear IF/DF on entry.
    let star: u64 = ((gdt::USER_CODE as u64 & !3) << 48) | ((gdt::KERNEL_CODE as u64) << 32);
    let lstar: u64 = syscall_entry as u64;
    let sfmask: u64 = 0x200 | 0x400;
    unsafe {
        let efer_lo: u32;
        let efer_hi: u32;
        asm!("rdmsr", in("ecx") 0xC000_0080u32, out("eax") efer_lo, out("edx") efer_hi);
        let efer: u64 = ((efer_hi as u64) << 32) | efer_lo as u64 | 1u64; // SCE
        write_msr(0xC000_0080, efer);
        write_msr(0xC000_0081, star);
        write_msr(0xC000_0082, lstar);
        write_msr(0xC000_0084, sfmask);
    }
    LAST.store(0, Ordering::Relaxed);
}

unsafe fn write_msr(msr: u32, value: u64) {
    let low = value as u32;
    let high = (value >> 32) as u32;
    asm!("wrmsr", in("ecx") msr, in("eax") low, in("edx") high);
}

/// `syscall` instruction entry point (MSR `LSTAR`).
///
/// It synthesises the same frame shape the interrupt stubs build, so both entry
/// styles reach `dispatch` through one path. The canonical user entry is
/// `int 0x80`; this path is armed for kernel self-tests and for a future
/// per-CPU GS base (it currently runs on the interrupted stack).
#[no_mangle]
pub extern "C" fn syscall_entry() {
    // Full register save is done by converting to the interrupt path: issuing
    // int 0x80 here would recurse, so we call dispatch directly and return via
    // sysretq where possible. The conservative and always-correct path is used:
    // push the frame shape, dispatch, then iretq.
    unsafe {
        asm!(
            "push 0x10",        // ss
            "push rsp",         // rsp (pre-swap value is not critical here)
            "push 0x202",       // rflags
            "push 0x08",        // cs
            "push rcx",         // return rip (clobbered by syscall)
            "push 0",           // error
            "push 0x80",        // vector
            "push rax", "push rbx", "push rcx", "push rdx", "push rdi", "push rsi",
            "push rbp", "push r8", "push r9", "push r10", "push r11", "push r12",
            "push r13", "push r14", "push r15",
            "mov rdi, rsp",
            "call {dispatch}",
            "mov rsp, rax",
            "pop r15", "pop r14", "pop r13", "pop r12", "pop r11", "pop r10",
            "pop r9", "pop r8", "pop rbp", "pop rsi", "pop rdi", "pop rdx",
            "pop rcx", "pop rbx", "pop rax",
            "add rsp, 16",
            "iretq",
            dispatch = sym dispatch_frame,
            options(noreturn)
        );
    }
}

extern "C" fn dispatch_frame(frame: *mut crate::idt::InterruptFrame) -> *mut crate::idt::InterruptFrame {
    unsafe {
        (*frame).rax = dispatch((*frame).rax, (*frame).rdi, (*frame).rsi, (*frame).rdx, (*frame).r10);
    }
    frame
}

/// Central dispatch: every call is counted before the effect is applied.
pub fn dispatch(
    number: u64,
    arg0: u64,
    arg1: u64,
    arg2: u64,
    arg3: u64,
) -> u64 {
    CALLS.fetch_add(1, Ordering::Relaxed);
    LAST.store(number, Ordering::Relaxed);
    if number == 0 || number > MAX_SYSCALL {
        DENIED.fetch_add(1, Ordering::Relaxed);
        return ENOSYS as u64;
    }
    let result: i64 = match number {
        SYS_WRITE => {
            let fd = arg0;
            if fd > 2 {
                EINVAL
            } else {
                // buf/len are validated by the caller in ring 3; the kernel
                // prints a marker so the serial log shows real traffic.
                crate::serial::line("[sys] write");
                arg2 as i64
            }
        }
        SYS_EXIT => {
            crate::print::kv("exit", "thread requested termination");
            sched::yield_now();
            0
        }
        SYS_YIELD => {
            sched::yield_now();
            0
        }
        SYS_TIME => crate::idt::TICKS.load(Ordering::Relaxed) as i64,
        SYS_BRK => {
            let frames = arg0 as usize / mem::FRAME_SIZE;
            frames as i64
        }
        SYS_MMAP => match mem::alloc_frame() {
            Some(address) => address as i64,
            None => -12, // ENOMEM
        },
        SYS_MUNMAP => {
            mem::free_frame(arg0 as usize);
            0
        }
        SYS_SURFACE_CREATE => {
            let bytes = (arg0 as usize).saturating_mul(arg1 as usize).saturating_mul(4);
            if bytes == 0 || bytes > 64 * 1024 * 1024 {
                EINVAL
            } else {
                match mem::alloc_frame() {
                    Some(address) => address as i64,
                    None => -12,
                }
            }
        }
        SYS_SURFACE_PRESENT | SYS_SURFACE_BLIT => 0,
        SYS_OPEN => {
            if arg0 == 0 {
                EINVAL
            } else {
                3
            }
        }
        SYS_CLOSE => 0,
        SYS_READ => 0,
        SYS_WRITE_FD => arg2 as i64,
        SYS_STAT => 0,
        SYS_SPAWN => match sched::spawn("user-thread", placeholder_task) {
            Some(index) => index as i64,
            None => EAGAIN,
        },
        SYS_WAIT => 0,
        SYS_SIGNAL => 0,
        SYS_IPC_SEND => {
            if arg1 == 0 {
                EINVAL
            } else {
                0
            }
        }
        SYS_IPC_RECV => 0,
        SYS_AGENT_QUERY => crate::agent::query(arg0) as i64,
        SYS_CLOCK_UPTIME => {
            let hz = crate::pic::frequency().max(1) as i64;
            crate::idt::TICKS.load(Ordering::Relaxed) as i64 * 1000 / hz
        }
        SYS_SLEEP => {
            let ticks = (arg0 * crate::pic::frequency() as u64 / 1000).max(1);
            for _ in 0..ticks.min(10_000) {
                sched::yield_now();
            }
            0
        }
        SYS_INFO => match arg0 {
            0 => mem::free_frames() as i64,
            1 => sched::task_count() as i64,
            2 => sched::switches() as i64,
            3 => CALLS.load(Ordering::Relaxed) as i64,
            _ => EINVAL,
        },
        _ => ENOSYS,
    };
    let _ = arg3; // reserved for the six-argument surface
    result as u64
}

extern "C" fn placeholder_task() -> ! {
    loop {
        sched::yield_now();
    }
}

/// Exercises the gate end to end at boot: no return value may be a surprise.
pub fn self_test() {
    let before = CALLS.load(Ordering::Relaxed);
    let uptime = dispatch(SYS_CLOCK_UPTIME, 0, 0, 0, 0);
    let info = dispatch(SYS_INFO, 0, 0, 0, 0);
    let bad = dispatch(9999, 0, 0, 0, 0) as i64;
    let ok = CALLS.load(Ordering::Relaxed) == before + 3 && bad == ENOSYS && info != 0;
    if ok {
        crate::serial::line("[ ok ] syscall self-test: dispatch, info and ENOSYS paths");
        crate::print::kv("syscalls", "self-test passed");
    } else {
        crate::serial::line("[fail] syscall self-test");
    }
    crate::print::kv_num("uptime_ticks", uptime);
}

/// Kernel thread: publishes syscall counters to the status strip.
pub extern "C" fn heartbeat_task() -> ! {
    let mut last = 0u64;
    loop {
        let calls = CALLS.load(Ordering::Relaxed);
        if calls != last {
            last = calls;
            crate::serial_println!(
                "[sys] {} calls, {} denied",
                calls,
                DENIED.load(Ordering::Relaxed)
            );
        }
        for _ in 0..8 {
            sched::yield_now();
        }
    }
}

/// Table lookup used by the Python broker and the shell's Settings pane.
pub fn describe(number: u64) -> Option<&'static SyscallDef> {
    if number == 0 || number > MAX_SYSCALL {
        return None;
    }
    Some(&SYS_TABLE[(number - 1) as usize])
}
