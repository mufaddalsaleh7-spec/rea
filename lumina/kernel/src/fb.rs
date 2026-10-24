//! Linear framebuffer console.
//!
//! The bootloader hands us a 32 bpp linear framebuffer. This module owns the
//! pixel surface for the boot sequence: banner, subsystem log, agent pipeline
//! progress, live status strip and a fatal-error screen. Once the C++ shell
//! takes over it receives exactly this surface through `surface_present`.

use core::sync::atomic::{AtomicUsize, Ordering};

use crate::font;

static mut FB: *mut u32 = core::ptr::null_mut();
static WIDTH: AtomicUsize = AtomicUsize::new(0);
static HEIGHT: AtomicUsize = AtomicUsize::new(0);
static PITCH: AtomicUsize = AtomicUsize::new(0);
static LOG_LINE: AtomicUsize = AtomicUsize::new(0);

const BG: u32 = 0xFF0B10_20;
const INK: u32 = 0xFFF2F5_FF;
const DIM: u32 = 0xFFA8B2_CC;
const FAINT: u32 = 0xFF6C76_90;
const ACCENT: u32 = 0xFF4C8D_FF;
const OK: u32 = 0xFF38D3_9F;

pub fn init(address: *mut u32, width: usize, height: usize, pitch: usize, bpp: u8) {
    if bpp < 32 {
        crate::serial::line("[warn] framebuffer is not 32bpp; console disabled");
        return;
    }
    unsafe {
        FB = address;
    }
    WIDTH.store(width, Ordering::Relaxed);
    HEIGHT.store(height, Ordering::Relaxed);
    PITCH.store(pitch / 4, Ordering::Relaxed);
    clear(BG);
}

pub fn ready() -> bool {
    !FB.is_null()
}

fn width() -> usize {
    WIDTH.load(Ordering::Relaxed)
}

fn height() -> usize {
    HEIGHT.load(Ordering::Relaxed)
}

fn stride() -> usize {
    PITCH.load(Ordering::Relaxed)
}

pub fn clear(color: u32) {
    if !ready() {
        return;
    }
    unsafe {
        let fb = FB;
        for y in 0..height() {
            let row = fb.add(y * stride());
            for x in 0..width() {
                *row.add(x) = color;
            }
        }
    }
}

pub fn pixel(x: usize, y: usize, color: u32) {
    if !ready() || x >= width() || y >= height() {
        return;
    }
    unsafe {
        *FB.add(y * stride() + x) = color;
    }
}

pub fn fill_rect(x: usize, y: usize, w: usize, h: usize, color: u32) {
    for yy in y..(y + h).min(height()) {
        for xx in x..(x + w).min(width()) {
            pixel(xx, yy, color);
        }
    }
}

pub fn rounded_rect(x: usize, y: usize, w: usize, h: usize, radius: usize, color: u32) {
    for yy in 0..h {
        for xx in 0..w {
            let dx = xx as isize - (w / 2) as isize;
            let dy = yy as isize - (h / 2) as isize;
            let half_w = (w / 2) as isize - radius as isize;
            let half_h = (h / 2) as isize - radius as isize;
            let inside = (dx.abs() <= half_w && dy.abs() as usize <= h / 2)
                || (dy.abs() <= half_h && dx.abs() as usize <= w / 2)
                || {
                    let cx = dx.abs() - half_w;
                    let cy = dy.abs() - half_h;
                    cx * cx + cy * cy <= (radius * radius) as isize
                };
            if inside {
                pixel(x + xx, y + yy, color);
            }
        }
    }
}

pub fn text(x: usize, y: usize, s: &str, color: u32, scale: usize) {
    let mut cx = x;
    for byte in s.bytes() {
        if byte < font::FIRST || byte >= font::FIRST + font::COUNT as u8 {
            cx += 8 * scale;
            continue;
        }
        let glyph = &font::GLYPHS[(byte - font::FIRST) as usize];
        for (row, bits) in glyph.iter().enumerate() {
            for col in 0..8 {
                if bits & (1 << col) == 0 {
                    continue;
                }
                if scale == 1 {
                    pixel(cx + col, y + row, color);
                } else {
                    fill_rect(cx + col * scale, y + row * scale, scale, scale, color);
                }
            }
        }
        cx += 8 * scale;
    }
}

fn text_width(s: &str, scale: usize) -> usize {
    s.len() * 8 * scale
}

fn centered(y: usize, s: &str, color: u32, scale: usize) {
    let w = text_width(s, scale);
    let x = width().saturating_sub(w) / 2;
    text(x, y, s, color, scale);
}

/// Boot splash: mark, wordmark, pipeline, then the subsystem log.
pub fn boot_screen(stage_count: usize) {
    if !ready() {
        return;
    }
    clear(BG);
    let w = width();
    let h = height();

    // Mark: concentric rings around a solid core.
    let cx = w / 2;
    let cy = h / 5;
    for ring in (1..=4).rev() {
        let radius = 24 + ring * 8;
        for y in cy.saturating_sub(radius)..(cy + radius).min(h) {
            for x in cx.saturating_sub(radius)..(cx + radius).min(w) {
                let dx = x as isize - cx as isize;
                let dy = y as isize - cy as isize;
                let d2 = (dx * dx + dy * dy) as usize;
                if d2 <= radius * radius && d2 >= (radius - 2) * (radius - 2) {
                    pixel(x, y, blend(ACCENT, 70 + ring as u32 * 40));
                }
            }
        }
    }
    fill_rect(cx - 22, cy - 22, 44, 44, ACCENT);
    fill_rect(cx - 14, cy - 14, 28, 28, BG);
    fill_rect(cx - 7, cy - 7, 14, 14, ACCENT);

    centered(cy + 62, "L U M I N A", INK, 4);
    centered(cy + 106, "beyond the mac  ·  kernel 1.0 (crystal)", DIM, 1);

    // Progress rail.
    let rail_w = (w * 7 / 12).max(320).min(w - 80);
    let rail_x = (w - rail_w) / 2;
    let rail_y = cy + 150;
    fill_rect(rail_x, rail_y, rail_w, 4, blend(INK, 40));
    fill_rect(rail_x, rail_y, rail_w * 9 / 10, 4, ACCENT);

    // Agent pipeline summary box.
    let box_w = rail_w;
    let box_y = rail_y + 34;
    fill_rect(rail_x, box_y, box_w, (stage_count + 1) * 26 + 16, blend(INK, 16));
    text(rail_x + 16, box_y + 12, "agent pipeline", ACCENT, 1);
    text(rail_x + 16, box_y + 30, "kernel-architect · graphics-engineer · compositor-engineer", FAINT, 1);
    text(rail_x + 16, box_y + 46, "shell-designer · syscall-architect · app-builder", FAINT, 1);
    text(rail_x + 16, box_y + 62, "qa-engineer · security-reviewer · release-manager", FAINT, 1);
    text(
        rail_x + 16,
        box_y + (stage_count + 1) * 26,
        "9 roles · 1 manifest · reproducible",
        OK,
        1,
    );

    LOG_LINE.store(0, Ordering::Relaxed);
    centered(h.saturating_sub(28), "serial console: ttyS0 · 38400 8N1", FAINT, 1);
}

/// One subsystem line in the boot log (mirrors the serial output).
pub fn log_line(key: &str, value: &str) {
    if !ready() {
        return;
    }
    let index = LOG_LINE.fetch_add(1, Ordering::Relaxed);
    let y = height().saturating_sub(220) + index * 14;
    if y + 12 > height() {
        return;
    }
    let x = (width() / 2).saturating_sub((width() * 7 / 12).max(320).min(width() - 80) / 2);
    text(x, y, "[ok]", OK, 1);
    text(x + 42, y, key, INK, 1);
    text(x + 190, y, value, FAINT, 1);
}

/// Live strip repainted by the idle thread.
pub fn status_strip(ticks: u64, free_frames: usize, tasks: usize) {
    if !ready() {
        return;
    }
    let y = height().saturating_sub(22);
    fill_rect(0, y - 2, width(), 24, BG);
    let hz = crate::pic::frequency().max(1) as u64;
    let seconds = ticks / hz;
    text(16, y, "lumina", ACCENT, 1);
    let mut buf = crate::print::LineBuf::new();
    buf.push_num(seconds);
    text(80, y, "uptime ", FAINT, 1);
    text(128, y, buf.as_str(), DIM, 1);

    text(width() / 2 - 60, y, "frames free ", FAINT, 1);
    let mut frames = crate::print::LineBuf::new();
    frames.push_num(free_frames as u64);
    text(width() / 2 + 20, y, frames.as_str(), DIM, 1);

    text(width() - 160, y, "threads ", FAINT, 1);
    let mut tbuf = crate::print::LineBuf::new();
    tbuf.push_num(tasks as u64);
    text(width() - 100, y, tbuf.as_str(), OK, 1);
}

pub fn panic_screen(title: &str, detail: &str) {
    if !ready() {
        return;
    }
    clear(0xFF1A0A0E);
    let cy = height() / 2 - 40;
    centered(cy, "kernel fault", 0xFFFF6B6B, 3);
    centered(cy + 44, title, INK, 2);
    centered(cy + 80, detail, DIM, 1);
    centered(cy + 110, "the machine is halted; capture the serial log", FAINT, 1);
}

fn blend(color: u32, alpha: u32) -> u32 {
    let a = alpha.min(255);
    let r = ((color >> 16) & 0xFF) * a / 255;
    let g = ((color >> 8) & 0xFF) * a / 255;
    let b = (color & 0xFF) * a / 255;
    0xFF00_0000 | (r << 16) | (g << 8) | b
}
