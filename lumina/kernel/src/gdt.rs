//! Global descriptor table, task state segment and stack switching for
//! privilege transitions (`int 0x80` from ring 3).

use core::arch::asm;
use core::mem::size_of;

pub const KERNEL_CODE: u16 = 0x08;
pub const KERNEL_DATA: u16 = 0x10;
pub const USER_DATA: u16 = 0x18 | 3;
pub const USER_CODE: u16 = 0x20 | 3;
pub const TSS_SELECTOR: u16 = 0x28;

#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct Descriptor {
    limit_low: u16,
    base_low: u16,
    base_middle: u8,
    access: u8,
    granularity: u8,
    base_high: u8,
}

impl Descriptor {
    const NULL: Self = Self {
        limit_low: 0,
        base_low: 0,
        base_middle: 0,
        access: 0,
        granularity: 0,
        base_high: 0,
    };

    const fn new(base: u32, limit: u32, access: u8, granularity: u8) -> Self {
        Self {
            limit_low: (limit & 0xFFFF) as u16,
            base_low: (base & 0xFFFF) as u16,
            base_middle: ((base >> 16) & 0xFF) as u8,
            access,
            granularity: ((limit >> 16) & 0x0F) as u8 | (granularity & 0xF0),
            base_high: ((base >> 24) & 0xFF) as u8,
        }
    }
}

#[repr(C, packed)]
struct Pointer {
    limit: u16,
    base: u64,
}

#[repr(C, packed)]
struct Tss {
    reserved0: u32,
    rsp0: u64,
    rsp1: u64,
    rsp2: u64,
    reserved1: u64,
    ist: [u64; 7],
    reserved2: u64,
    reserved3: u16,
    iomap_base: u16,
}

#[repr(C, align(16))]
struct Gdt {
    entries: [Descriptor; 6],
    tss: Tss,
    pointer: Pointer,
}

static mut GDT: Gdt = Gdt {
    entries: [
        Descriptor::NULL,
        // kernel code: 64-bit, present, DPL 0, executable/readable
        Descriptor::new(0, 0, 0x9A, 0xAF),
        // kernel data: present, DPL 0, writable
        Descriptor::new(0, 0, 0x92, 0xCF),
        // user data: DPL 3
        Descriptor::new(0, 0, 0xF2, 0xCF),
        // user code: DPL 3, 64-bit
        Descriptor::new(0, 0, 0xFA, 0xAF),
        // TSS (filled in below)
        Descriptor::NULL,
    ],
    tss: Tss {
        reserved0: 0,
        rsp0: 0,
        rsp1: 0,
        rsp2: 0,
        reserved1: 0,
        ist: [0; 7],
        reserved2: 0,
        reserved3: 0,
        iomap_base: size_of::<Tss>() as u16,
    },
    pointer: Pointer { limit: 0, base: 0 },
};

/// 16 KiB ring-0 stack used when an interrupt arrives from user mode.
#[repr(C, align(16))]
struct PrivilegedStack([u8; 16 * 1024]);
static mut RING0_STACK: PrivilegedStack = PrivilegedStack([0; 16 * 1024]);

/// 8 KiB stack for double faults so a scheduler bug cannot triple-fault.
#[repr(C, align(16))]
struct DoubleFaultStack([u8; 8 * 1024]);
static mut IST_STACK: DoubleFaultStack = DoubleFaultStack([0; 8 * 1024]);

pub fn init() {
    unsafe {
        let stack_top = RING0_STACK.0.as_ptr() as u64 + RING0_STACK.0.len() as u64;
        GDT.tss.rsp0 = stack_top;
        GDT.tss.ist[0] = IST_STACK.0.as_ptr() as u64 + IST_STACK.0.len() as u64;

        let tss_base = &GDT.tss as *const Tss as u32;
        let tss_limit = (size_of::<Tss>() - 1) as u32;
        GDT.entries[5] = Descriptor::new(tss_base, tss_limit, 0x89, 0x00);

        GDT.pointer.limit = (size_of::<[Descriptor; 6]>() + size_of::<Tss>() - 1) as u16;
        GDT.pointer.base = GDT.entries.as_ptr() as u64;

        let pointer = &GDT.pointer as *const Pointer;
        asm!("lgdt [{}]", in(reg) pointer, options(nostack, preserves_flags));
        asm!(
            "push {code}",
            "lea {tmp}, [rip + 1f]",
            "push {tmp}",
            "retfq",
            "1:",
            code = in(reg) KERNEL_CODE as u64,
            tmp = lateout(reg) _,
            options(preserves_flags)
        );
        asm!("mov ax, {0:x}", "mov ds, ax", "mov es, ax", "mov ss, ax", "mov fs, ax", "mov gs, ax",
             in(reg) KERNEL_DATA, options(nostack));
        asm!("ltr {0:x}", in(reg) TSS_SELECTOR, options(nostack));
    }
}

/// Kernel code selector value, exported for the IDT and syscall modules.
pub const fn kernel_code() -> u16 {
    KERNEL_CODE
}
