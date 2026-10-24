//! Interrupt descriptor table and the common exception/IRQ trampoline.
//!
//! One assembly stub pushes a uniform frame for every vector, calls into Rust
//! and resumes whichever stack the dispatcher hands back — that is what makes
//! preemptive scheduling possible from an interrupt.

use core::arch::{asm, global_asm};
use core::sync::atomic::{AtomicU64, Ordering};

use crate::gdt;

pub const TIMER_VECTOR: u8 = 32;
pub const SYSCALL_VECTOR: u8 = 0x80;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct InterruptFrame {
    pub r15: u64,
    pub r14: u64,
    pub r13: u64,
    pub r12: u64,
    pub r11: u64,
    pub r10: u64,
    pub r9: u64,
    pub r8: u64,
    pub rbp: u64,
    pub rsi: u64,
    pub rdi: u64,
    pub rdx: u64,
    pub rcx: u64,
    pub rbx: u64,
    pub rax: u64,
    pub vector: u64,
    pub error: u64,
    pub rip: u64,
    pub cs: u64,
    pub rflags: u64,
    pub rsp: u64,
    pub ss: u64,
}

#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct Entry {
    offset_low: u16,
    selector: u16,
    ist: u8,
    attributes: u8,
    offset_middle: u16,
    offset_high: u32,
    reserved: u32,
}

impl Entry {
    const MISSING: Self = Self {
        offset_low: 0,
        selector: 0,
        ist: 0,
        attributes: 0,
        offset_middle: 0,
        offset_high: 0,
        reserved: 0,
    };

    const fn new(handler: u64, selector: u16, attributes: u8, ist: u8) -> Self {
        Self {
            offset_low: (handler & 0xFFFF) as u16,
            selector,
            ist: ist & 0x07,
            attributes,
            offset_middle: ((handler >> 16) & 0xFFFF) as u16,
            offset_high: ((handler >> 32) & 0xFFFF_FFFF) as u32,
            reserved: 0,
        }
    }
}

#[repr(C, align(16))]
pub struct Table {
    entries: [Entry; 256],
    pointer: [u8; 10],
}

static mut IDT: Table = Table { entries: [Entry::MISSING; 256], pointer: [0; 10] };

/// Ticks delivered by the PIT; the scheduler's notion of time.
pub static TICKS: AtomicU64 = AtomicU64::new(0);

global_asm!(
    r#"
.macro ISR_NOERR n
.global isr_\n
isr_\n:
    push 0
    push \n
    jmp isr_common
.endm

.macro ISR_ERR n
.global isr_\n
isr_\n:
    push \n
    jmp isr_common
.endm

.section .text
.code64

ISR_NOERR 0
ISR_NOERR 1
ISR_NOERR 2
ISR_NOERR 3
ISR_NOERR 4
ISR_NOERR 5
ISR_NOERR 6
ISR_NOERR 7
ISR_ERR   8
ISR_NOERR 9
ISR_ERR   10
ISR_ERR   11
ISR_ERR   12
ISR_ERR   13
ISR_ERR   14
ISR_NOERR 15
ISR_NOERR 16
ISR_ERR   17
ISR_NOERR 18
ISR_NOERR 19
ISR_NOERR 20
ISR_NOERR 21
ISR_NOERR 22
ISR_NOERR 23
ISR_NOERR 24
ISR_NOERR 25
ISR_NOERR 26
ISR_NOERR 27
ISR_NOERR 28
ISR_NOERR 29
ISR_ERR   30
ISR_NOERR 31
ISR_NOERR 32
ISR_NOERR 33
ISR_NOERR 34
ISR_NOERR 35
ISR_NOERR 36
ISR_NOERR 37
ISR_NOERR 38
ISR_NOERR 39
ISR_NOERR 40
ISR_NOERR 41
ISR_NOERR 42
ISR_NOERR 43
ISR_NOERR 44
ISR_NOERR 45
ISR_NOERR 46
ISR_NOERR 47
ISR_NOERR 128

.global isr_common
isr_common:
    push rax
    push rbx
    push rcx
    push rdx
    push rdi
    push rsi
    push rbp
    push r8
    push r9
    push r10
    push r11
    push r12
    push r13
    push r14
    push r15

    cld
    mov rdi, rsp
    call isr_dispatch          /* returns the frame to resume in rax */
    mov rsp, rax

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
    add rsp, 16                /* vector + error code */
    iretq
"#
);

extern "C" {
    fn isr_0();
    fn isr_8();
    fn isr_13();
    fn isr_14();
    fn isr_17();
    fn isr_30();
    fn isr_32();
    fn isr_33();
    fn isr_34();
    fn isr_35();
    fn isr_36();
    fn isr_37();
    fn isr_38();
    fn isr_39();
    fn isr_40();
    fn isr_41();
    fn isr_42();
    fn isr_43();
    fn isr_44();
    fn isr_45();
    fn isr_46();
    fn isr_47();
    fn isr_128();
    fn isr_2();
    fn isr_3();
    fn isr_6();
    fn isr_10();
    fn isr_11();
    fn isr_12();
    fn isr_18();
    fn isr_19();
}

pub fn init() {
    unsafe {
        let table = &mut IDT;
        // Exceptions we handle explicitly; the rest fall through to the
        // default handler installed below.
        table.entries[0] = Entry::new(isr_0 as u64, gdt::KERNEL_CODE, 0x8E, 0);
        table.entries[2] = Entry::new(isr_2 as u64, gdt::KERNEL_CODE, 0x8E, 0);
        table.entries[3] = Entry::new(isr_3 as u64, gdt::KERNEL_CODE, 0xEE, 0);
        table.entries[6] = Entry::new(isr_6 as u64, gdt::KERNEL_CODE, 0x8E, 0);
        table.entries[8] = Entry::new(isr_8 as u64, gdt::KERNEL_CODE, 0x8E, 1);
        table.entries[10] = Entry::new(isr_10 as u64, gdt::KERNEL_CODE, 0x8E, 0);
        table.entries[11] = Entry::new(isr_11 as u64, gdt::KERNEL_CODE, 0x8E, 0);
        table.entries[12] = Entry::new(isr_12 as u64, gdt::KERNEL_CODE, 0x8E, 0);
        table.entries[13] = Entry::new(isr_13 as u64, gdt::KERNEL_CODE, 0x8E, 0);
        table.entries[14] = Entry::new(isr_14 as u64, gdt::KERNEL_CODE, 0x8E, 0);
        table.entries[17] = Entry::new(isr_17 as u64, gdt::KERNEL_CODE, 0x8E, 0);
        table.entries[18] = Entry::new(isr_18 as u64, gdt::KERNEL_CODE, 0x8E, 0);
        table.entries[19] = Entry::new(isr_19 as u64, gdt::KERNEL_CODE, 0x8E, 0);
        table.entries[30] = Entry::new(isr_30 as u64, gdt::KERNEL_CODE, 0x8E, 1);

        // PIC IRQ0..IRQ15 -> vectors 32..47.
        let irq_handlers = [
            isr_32 as u64, isr_33 as u64, isr_34 as u64, isr_35 as u64, isr_36 as u64,
            isr_37 as u64, isr_38 as u64, isr_39 as u64, isr_40 as u64, isr_41 as u64,
            isr_42 as u64, isr_43 as u64, isr_44 as u64, isr_45 as u64, isr_46 as u64,
            isr_47 as u64,
        ];
        for (i, handler) in irq_handlers.iter().enumerate() {
            table.entries[32 + i] = Entry::new(*handler, gdt::KERNEL_CODE, 0x8E, 0);
        }

        // Syscall gate: callable from ring 3 (DPL 3).
        table.entries[SYSCALL_VECTOR as usize] =
            Entry::new(isr_128 as u64, gdt::KERNEL_CODE, 0xEE, 0);

        let base = table.entries.as_ptr() as u64;
        let limit = (core::mem::size_of::<[Entry; 256]>() - 1) as u16;
        table.pointer[0] = limit as u8;
        table.pointer[1] = (limit >> 8) as u8;
        table.pointer[2..10].copy_from_slice(&base.to_le_bytes());
        let pointer = table.pointer.as_ptr();
        asm!("lidt [{}]", in(reg) pointer, options(nostack, preserves_flags));
    }
}

fn vector_name(vector: u64) -> &'static str {
    match vector {
        0 => "divide error",
        1 => "debug",
        2 => "non-maskable interrupt",
        3 => "breakpoint",
        4 => "overflow",
        5 => "bound range",
        6 => "invalid opcode",
        7 => "device not available",
        8 => "double fault",
        10 => "invalid TSS",
        11 => "segment not present",
        12 => "stack fault",
        13 => "general protection fault",
        14 => "page fault",
        17 => "alignment check",
        18 => "machine check",
        19 => "SIMD floating point",
        32 => "timer",
        _ => "reserved",
    }
}

/// Called from the assembly trampoline with a pointer to the saved frame.
/// Returns the frame to resume: the same one, or another thread's after a
/// context switch.
#[no_mangle]
pub extern "C" fn isr_dispatch(frame: *mut InterruptFrame) -> *mut InterruptFrame {
    let saved = unsafe { *frame };
    let vector = saved.vector;

    if vector == TIMER_VECTOR as u64 {
        TICKS.fetch_add(1, Ordering::Relaxed);
        crate::pic::eoi(vector as u8);
        return crate::sched::on_timer(frame);
    }

    if vector >= 32 && vector <= 47 {
        crate::pic::eoi(vector as u8);
        return frame;
    }

    if vector == SYSCALL_VECTOR as u64 {
        unsafe {
            (*frame).rax = crate::syscall::dispatch(
                (*frame).rax,
                (*frame).rdi,
                (*frame).rsi,
                (*frame).rdx,
                (*frame).r10,
            );
        }
        return frame;
    }

    // Anything else is fatal: report and halt with a clean diagnosable state.
    crate::serial::line("");
    crate::serial::line("!! cpu exception !!");
    crate::serial::line(vector_name(vector));
    crate::print::kv_num("vector", vector);
    crate::print::kv_hex("rip", saved.rip);
    crate::print::kv_hex("cr2", read_cr2());
    crate::fb::panic_screen(vector_name(vector), "see serial log");
    crate::halt()
}

unsafe fn read_cr2() -> u64 {
    let value: u64;
    asm!("mov {}, cr2", out(reg) value, options(nomem, nostack, preserves_flags));
    value
}

pub fn hex(value: u64) -> HexBuf {
    HexBuf(value)
}

pub struct HexBuf(pub u64);

impl core::fmt::Display for HexBuf {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "0x{:016x}", self.0)
    }
}
