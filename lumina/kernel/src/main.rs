//! Lumina OS kernel — freestanding x86_64 entry point.
//!
//! Boot order:
//!   1. `boot.rs` switches the machine to long mode and calls `kmain`.
//!   2. Serial logging, GDT/TSS, IDT, PIC and the PIT come up.
//!   3. Physical-frame and heap allocators initialise from the Multiboot2 map.
//!   4. The framebuffer is claimed and the Lumina boot screen is drawn.
//!   5. Kernel threads are spawned and the round-robin scheduler takes over.
//!   6. The `int 0x80` syscall gate is armed and self-tested.
//!
//! Everything here is `no_std`: no libc, no alloc crate, no external crates.

#![no_std]
#![no_main]

mod agent;
mod boot;
mod fb;
mod font;
mod gdt;
mod idt;
mod mem;
mod pic;
mod print;
mod sched;
mod serial;
mod syscall;

use core::panic::PanicInfo;

pub const VERSION: &str = "1.0.0";
pub const CODENAME: &str = "crystal";
pub const MULTIBOOT2_BOOT_MAGIC: u32 = 0x36D7_6289;

/// Multiboot2 information structure, as delivered by the loader in EBX.
#[repr(C)]
pub struct MultibootInfo {
    pub total_size: u32,
    pub reserved: u32,
}

/// A Multiboot2 tag header (type + size, self-describing).
#[repr(C)]
pub struct Tag {
    pub kind: u32,
    pub size: u32,
}

pub const TAG_END: u32 = 0;
pub const TAG_BASIC_MEMINFO: u32 = 4;
pub const TAG_MMAP: u32 = 6;
pub const TAG_FRAMEBUFFER: u32 = 8;

#[repr(C)]
pub struct TagBasicMeminfo {
    pub kind: u32,
    pub size: u32,
    pub mem_lower: u32,
    pub mem_upper: u32,
}

#[repr(C)]
pub struct TagFramebuffer {
    pub kind: u32,
    pub size: u32,
    pub address: u64,
    pub pitch: u32,
    pub width: u32,
    pub height: u32,
    pub bpp: u8,
    pub framebuffer_type: u8,
    pub reserved: u16,
}

#[repr(C)]
pub struct TagMmap {
    pub kind: u32,
    pub size: u32,
    pub entry_size: u32,
    pub entry_version: u32,
}

#[repr(C)]
pub struct MmapEntry {
    pub address: u64,
    pub length: u64,
    pub kind: u32,
    pub zero: u32,
}

/// Safely walks the Multiboot2 tag list.
pub struct TagIter {
    current: *const u8,
    end: *const u8,
}

impl TagIter {
    /// # Safety
    /// `info` must point at a Multiboot2 information block the loader provided
    /// and must stay valid (it does: the loader maps it below the kernel image).
    pub unsafe fn new(info: *const MultibootInfo) -> Self {
        let base = info as *const u8;
        let total = (*info).total_size as usize;
        let start = base.add(8);
        Self { current: start, end: base.add(total) }
    }
}

impl Iterator for TagIter {
    type Item = *const Tag;

    fn next(&mut self) -> Option<Self::Item> {
        if self.current >= self.end {
            return None;
        }
        let tag = self.current as *const Tag;
        let kind = unsafe { (*tag).kind };
        let size = unsafe { (*tag).size } as usize;
        if size < 8 || kind == TAG_END {
            return None;
        }
        self.current = unsafe { self.current.add((size + 7) & !7) };
        Some(tag)
    }
}

/// Kernel entry point, called from `boot.rs` in 64-bit mode.
///
/// # Safety
/// Called exactly once by the boot trampoline with the Multiboot2 handoff.
#[no_mangle]
pub unsafe extern "C" fn kmain(magic: u32, info: u32) -> ! {
    serial::init();
    print::banner();

    if magic != MULTIBOOT2_BOOT_MAGIC {
        serial::line("[fail] not loaded by a Multiboot2 loader");
        halt();
    }
    let boot_info = info as *const MultibootInfo;
    serial::line("[ ok ] multiboot2 handoff accepted");

    gdt::init();
    serial::line("[ ok ] gdt + tss loaded");
    idt::init();
    serial::line("[ ok ] idt installed (exceptions, irqs, int 0x80)");
    pic::init(100);
    serial::line("[ ok ] pic remapped, pit armed at 100 Hz");

    // Memory: parse the map, seed the frame allocator, bring up the heap.
    let (mut lower_kb, mut upper_kb) = (0u32, 0u32);
    let mut mmap: *const TagMmap = core::ptr::null();
    let mut framebuffer: *const TagFramebuffer = core::ptr::null();

    for tag in TagIter::new(boot_info) {
        match (*tag).kind {
            TAG_BASIC_MEMINFO => {
                let t = tag as *const TagBasicMeminfo;
                lower_kb = (*t).mem_lower;
                upper_kb = (*t).mem_upper;
            }
            TAG_MMAP => mmap = tag as *const TagMmap,
            TAG_FRAMEBUFFER => framebuffer = tag as *const TagFramebuffer,
            _ => {}
        }
    }

    mem::init(lower_kb, upper_kb, mmap);
    print::kv("memory", "physical frames ready");
    mem::heap_init();
    print::kv("heap", "first-fit free list ready");

    if framebuffer.is_null() {
        serial::line("[warn] no framebuffer tag; staying on serial");
    } else {
        let fb_tag = &*framebuffer;
        fb::init(
            fb_tag.address as *mut u32,
            fb_tag.width as usize,
            fb_tag.height as usize,
            fb_tag.pitch as usize,
            fb_tag.bpp,
        );
        fb::boot_screen(agent::STAGES.len());
        print::kv("framebuffer", "linear 32bpp surface claimed");
    }

    syscall::init();
    serial::line("[ ok ] syscall gate armed (int 0x80, DPL 3)");
    syscall::self_test();

    sched::init();
    serial::line("[ ok ] scheduler online (round robin, 100 Hz quantum)");

    sched::spawn("agent-orchestrator", agent::orchestrator_task);
    sched::spawn("syscall-heartbeat", syscall::heartbeat_task);
    sched::spawn("compose-idle", idle_task);
    serial::line("[ ok ] 3 kernel threads spawned");
    print::kv("boot", "handing off to the scheduler");

    sched::start()
}

/// The always-runnable kernel thread. Paints the live clock strip.
extern "C" fn idle_task() -> ! {
    let mut ticks: u64 = 0;
    loop {
        fb::status_strip(ticks, mem::free_frames(), sched::task_count());
        ticks = ticks.wrapping_add(1);
        sched::yield_now();
        for _ in 0..40 {
            core::hint::spin_loop();
        }
    }
}

pub fn halt() -> ! {
    loop {
        unsafe { core::arch::asm!("cli; hlt", options(nomem, nostack, preserves_flags)) };
    }
}

#[panic_handler]
fn panic(info: &PanicInfo) -> ! {
    serial::line("");
    serial::line("!! kernel panic !!");
    if let Some(location) = info.location() {
        print::kv("at", location.file());
        print::kv("line", &itoa(location.line() as u64));
    }
    print::kv("message", "see serial console for the formatted panic");
    fb::panic_screen("kernel panic", info.location().map(|l| l.file()).unwrap_or("unknown"));
    halt()
}

/// Integer to decimal string, no allocation.
pub fn itoa(mut value: u64) -> NumBuf {
    let mut buf = NumBuf { bytes: [0u8; 20], len: 0 };
    if value == 0 {
        buf.bytes[0] = b'0';
        buf.len = 1;
        return buf;
    }
    let mut tmp = [0u8; 20];
    let mut n = 0;
    while value > 0 {
        tmp[n] = b'0' + (value % 10) as u8;
        value /= 10;
        n += 1;
    }
    for i in 0..n {
        buf.bytes[i] = tmp[n - 1 - i];
    }
    buf.len = n;
    buf
}

pub struct NumBuf {
    bytes: [u8; 20],
    len: usize,
}

impl core::fmt::Display for NumBuf {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // ASCII digits only, so this is always valid UTF-8.
        let s = unsafe { core::str::from_utf8_unchecked(&self.bytes[..self.len]) };
        f.write_str(s)
    }
}
