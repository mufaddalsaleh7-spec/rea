//! 8259 PIC remap + PIT programming.
//!
//! The PIC is remapped to vectors 32..47 so hardware IRQs never collide with
//! CPU exceptions (0..31), then IRQ0 is programmed as the scheduler heartbeat.

use core::arch::asm;
use core::sync::atomic::{AtomicU32, Ordering};

const PIC1_COMMAND: u16 = 0x20;
const PIC1_DATA: u16 = 0x21;
const PIC2_COMMAND: u16 = 0xA0;
const PIC2_DATA: u16 = 0xA1;

const ICW1_INIT: u8 = 0x11;
const ICW4_8086: u8 = 0x01;

pub const PIT_INPUT_HZ: u32 = 1_193_182;
static FREQUENCY: AtomicU32 = AtomicU32::new(100);

unsafe fn outb(port: u16, value: u8) {
    asm!("out dx, al", in("dx") port, in("al") value, options(nomem, nostack, preserves_flags));
}

unsafe fn inb(port: u16) -> u8 {
    let value: u8;
    asm!("in al, dx", out("al") value, in("dx") port, options(nomem, nostack, preserves_flags));
    value
}

unsafe fn io_wait() {
    outb(0x80, 0);
}

/// Remaps the PIC and starts the PIT at `hz` (clamped to 18..1000).
pub fn init(hz: u32) {
    let hz = hz.clamp(18, 1000);
    FREQUENCY.store(hz, Ordering::Relaxed);
    unsafe {
        // ICW1: start the initialisation sequence.
        outb(PIC1_COMMAND, ICW1_INIT);
        io_wait();
        outb(PIC2_COMMAND, ICW1_INIT);
        io_wait();

        // ICW2: vector offsets.
        outb(PIC1_DATA, 32);
        io_wait();
        outb(PIC2_DATA, 40);
        io_wait();

        // ICW3: cascade wiring (slave on IRQ2).
        outb(PIC1_DATA, 4);
        io_wait();
        outb(PIC2_DATA, 2);
        io_wait();

        // ICW4: 8086 mode.
        outb(PIC1_DATA, ICW4_8086);
        io_wait();
        outb(PIC2_DATA, ICW4_8086);
        io_wait();

        // Unmask IRQ0 (timer) and IRQ2 (cascade) only.
        outb(PIC1_DATA, 0b1111_1100);
        outb(PIC2_DATA, 0xFF);

        // Program the PIT: channel 0, lobyte/hibyte, rate generator.
        let divisor = (PIT_INPUT_HZ / hz) as u16;
        outb(0x43, 0x36);
        outb(0x40, (divisor & 0xFF) as u8);
        outb(0x40, (divisor >> 8) as u8);
    }
    enable_irq0();
}

pub fn frequency() -> u32 {
    FREQUENCY.load(Ordering::Relaxed)
}

pub fn enable_irq0() {
    unsafe {
        asm!("sti", options(nomem, nostack));
    }
}

/// End-of-interrupt for the appropriate PIC.
pub fn eoi(vector: u8) {
    unsafe {
        if vector >= 40 {
            outb(PIC2_COMMAND, 0x20);
        }
        outb(PIC1_COMMAND, 0x20);
    }
}

pub fn irq_mask() -> (u8, u8) {
    unsafe { (inb(PIC1_DATA), inb(PIC2_DATA)) }
}
