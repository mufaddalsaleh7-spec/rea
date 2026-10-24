//! Preemptive round-robin scheduler.
//!
//! Every thread is represented by a saved `InterruptFrame`. New threads start
//! from a synthetic frame whose `rip` is the entry function, so entering a
//! thread and resuming a preempted one use exactly the same `iretq` path. That
//! single representation is what keeps the scheduler honest: there is no second
//! "bootstrap" context format to get subtly wrong.

use core::arch::{asm, global_asm};
use core::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

use crate::idt::InterruptFrame;

pub const MAX_TASKS: usize = 16;
pub const STACK_SIZE: usize = 32 * 1024;
pub const QUANTUM_TICKS: u64 = 1;

const RFLAGS_IF: u64 = 0x202; // interrupts enabled, reserved bit 1 set

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TaskState {
    Free,
    Runnable,
    Running,
}

#[repr(C, align(16))]
pub struct Task {
    pub name: [u8; 32],
    pub name_len: usize,
    pub state: TaskState,
    /// Saved frame pointer while the thread is not running.
    pub frame: *mut InterruptFrame,
    pub stack: [u8; STACK_SIZE],
    pub ticks: u64,
    pub switches: u64,
}

impl Task {
    pub const fn empty() -> Self {
        Self {
            name: [0; 32],
            name_len: 0,
            state: TaskState::Free,
            frame: core::ptr::null_mut(),
            stack: [0; STACK_SIZE],
            ticks: 0,
            switches: 0,
        }
    }

    pub fn name(&self) -> &str {
        core::str::from_utf8(&self.name[..self.name_len]).unwrap_or("?")
    }
}

static mut TASKS: [Task; MAX_TASKS] = [const { Task::empty() }; MAX_TASKS];
static TASK_COUNT: AtomicUsize = AtomicUsize::new(0);
static CURRENT: AtomicUsize = AtomicUsize::new(0);
static TICKS: AtomicU64 = AtomicU64::new(0);
static SWITCHES: AtomicU64 = AtomicU64::new(0);

global_asm!(
    r#"
.section .text
.code64
.global resume_frame
/* resume_frame(frame: *mut InterruptFrame) -> !
   Mirrors the tail of isr_common: restore registers, drop vector/error,
   then iretq into the thread. */
resume_frame:
    mov rsp, rdi
    pop r15
    pop r14
    pop r13
    pop r12
    pop r11
    pop r10
    pop r9
    pop r8
    pop rbp
    pop rsi
    pop rdi
    pop rdx
    pop rcx
    pop rbx
    pop rax
    add rsp, 16
    iretq
"#
);

extern "C" {
    fn resume_frame(frame: *mut InterruptFrame) -> !;
}

pub fn init() {
    TASK_COUNT.store(0, Ordering::Relaxed);
    CURRENT.store(0, Ordering::Relaxed);
    TICKS.store(0, Ordering::Relaxed);
    SWITCHES.store(0, Ordering::Relaxed);
}

/// Builds the synthetic frame a fresh thread starts from.
unsafe fn build_frame(task: &mut Task, entry: extern "C" fn() -> !) -> *mut InterruptFrame {
    let stack_top = task.stack.as_mut_ptr().add(STACK_SIZE) as u64 & !0xF;
    let frame_ptr = (stack_top - core::mem::size_of::<InterruptFrame>() as u64) as *mut InterruptFrame;
    core::ptr::write_bytes(frame_ptr as *mut u8, 0, core::mem::size_of::<InterruptFrame>());
    let frame = &mut *frame_ptr;
    frame.vector = 0xFF; // not a real vector: a bootstrap marker
    frame.rip = entry as u64;
    frame.cs = crate::gdt::KERNEL_CODE as u64;
    frame.rflags = RFLAGS_IF;
    frame.rsp = stack_top;
    frame.ss = crate::gdt::KERNEL_DATA as u64;
    frame_ptr
}

pub fn spawn(name: &str, entry: extern "C" fn() -> !) -> Option<usize> {
    let index = TASK_COUNT.load(Ordering::Relaxed);
    if index >= MAX_TASKS {
        return None;
    }
    unsafe {
        let task = &mut TASKS[index];
        let bytes = name.as_bytes();
        let len = bytes.len().min(32);
        task.name[..len].copy_from_slice(&bytes[..len]);
        task.name_len = len;
        task.state = TaskState::Runnable;
        task.ticks = 0;
        task.switches = 0;
        task.frame = build_frame(task, entry);
    }
    TASK_COUNT.store(index + 1, Ordering::Relaxed);
    crate::print::kv("thread", name);
    Some(index)
}

pub fn task_count() -> usize {
    TASK_COUNT.load(Ordering::Relaxed).min(MAX_TASKS)
}

pub fn switches() -> u64 {
    SWITCHES.load(Ordering::Relaxed)
}

pub fn ticks() -> u64 {
    TICKS.load(Ordering::Relaxed)
}

pub fn current_name() -> &'static str {
    let index = CURRENT.load(Ordering::Relaxed);
    unsafe { TASKS[index.min(MAX_TASKS - 1)].name() }
}

fn next_runnable(from: usize) -> usize {
    let count = task_count();
    for offset in 1..=count {
        let candidate = (from + offset) % count;
        if unsafe { TASKS[candidate].state } != TaskState::Free {
            return candidate;
        }
    }
    from
}

/// Timer-interrupt hook: account the tick and, when the quantum expires, hand
/// the interrupt a different thread's frame.
#[no_mangle]
pub extern "C" fn on_timer(frame: *mut InterruptFrame) -> *mut InterruptFrame {
    TICKS.fetch_add(1, Ordering::Relaxed);
    let count = task_count();
    if count <= 1 {
        return frame;
    }
    let current = CURRENT.load(Ordering::Relaxed);
    unsafe {
        TASKS[current].frame = frame;
        TASKS[current].ticks += 1;
    }
    if TICKS.load(Ordering::Relaxed) % QUANTUM_TICKS != 0 {
        return frame;
    }
    let next = next_runnable(current);
    if next == current {
        return frame;
    }
    unsafe {
        TASKS[current].state = TaskState::Runnable;
        TASKS[next].state = TaskState::Running;
        TASKS[next].switches += 1;
        CURRENT.store(next, Ordering::Relaxed);
        SWITCHES.fetch_add(1, Ordering::Relaxed);
        TASKS[next].frame
    }
}

/// Starts the first thread. Never returns to the boot context.
pub fn start() -> ! {
    let count = task_count();
    if count == 0 {
        crate::halt();
    }
    unsafe {
        TASKS[0].state = TaskState::Running;
        CURRENT.store(0, Ordering::Relaxed);
        crate::pic::enable_irq0();
        resume_frame(TASKS[0].frame)
    }
}

/// Voluntary yield: re-enters the scheduler through the timer vector.
pub fn yield_now() {
    unsafe {
        asm!("int 0x20", options(nomem, nostack));
    }
}

/// Runs `count` voluntary yields, useful for cooperative waits.
pub fn yield_times(count: usize) {
    for _ in 0..count {
        yield_now();
    }
}
