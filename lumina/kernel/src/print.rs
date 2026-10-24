//! Formatted kernel logging shared by serial and the framebuffer.

use crate::{fb, serial, CODENAME, VERSION};

pub fn banner() {
    serial::line("");
    serial::line("        #                             ");
    serial::line("       ###    L U M I N A   O S       ");
    serial::line("      #####                           ");
    serial::line("  ##########  beyond the mac          ");
    serial::line("");
    let mut line = LineBuf::new();
    line.push_str("version ");
    line.push_str(VERSION);
    line.push_str(" · ");
    line.push_str(CODENAME);
    line.push_str(" · rust 1.0 kernel · c++17 surface · python syscall broker");
    serial::line(line.as_str());
    serial::line("------------------------------------------");
}

/// `[key] value` pair, mirrored to serial and the framebuffer.
pub fn kv(key: &str, value: &str) {
    let mut line = LineBuf::new();
    line.push_str("[ok] ");
    line.push_str(key);
    line.push_str(": ");
    line.push_str(value);
    serial::line(line.as_str());
    fb::log_line(key, value);
}

/// `[key] value` pair with a decimal value.
pub fn kv_num(key: &str, value: u64) {
    let mut line = LineBuf::new();
    line.push_str("[ok] ");
    line.push_str(key);
    line.push_str(": ");
    line.push_num(value);
    serial::line(line.as_str());
    fb::log_line(key, line.as_str());
}

/// `[key] value` pair with a hexadecimal value.
pub fn kv_hex(key: &str, value: u64) {
    let mut line = LineBuf::new();
    line.push_str("[ok] ");
    line.push_str(key);
    line.push_str(": ");
    line.push_hex(value);
    serial::line(line.as_str());
    fb::log_line(key, line.as_str());
}

/// Static string builder: no allocation, no `core::fmt` cost on the hot path.
pub struct LineBuf {
    bytes: [u8; 256],
    len: usize,
}

impl LineBuf {
    pub fn new() -> Self {
        Self { bytes: [0; 256], len: 0 }
    }

    pub fn push_str(&mut self, s: &str) {
        for byte in s.bytes() {
            if self.len < self.bytes.len() {
                self.bytes[self.len] = byte;
                self.len += 1;
            }
        }
    }

    /// Appends `n` in decimal without allocating.
    pub fn push_num(&mut self, n: u64) {
        let mut digits = [0u8; 20];
        let mut count = 0;
        let mut value = n;
        if value == 0 {
            self.push_str("0");
            return;
        }
        while value > 0 && count < digits.len() {
            digits[count] = b'0' + (value % 10) as u8;
            value /= 10;
            count += 1;
        }
        while count > 0 {
            count -= 1;
            if self.len < self.bytes.len() {
                self.bytes[self.len] = digits[count];
                self.len += 1;
            }
        }
    }

    /// Appends `n` as `0x` + 16 lowercase hex digits.
    pub fn push_hex(&mut self, n: u64) {
        self.push_str("0x");
        for shift in (0..64).step_by(4).rev() {
            let nibble = ((n >> shift) & 0xF) as u8;
            let c = if nibble < 10 { b'0' + nibble } else { b'a' + nibble - 10 };
            if self.len < self.bytes.len() {
                self.bytes[self.len] = c;
                self.len += 1;
            }
        }
    }

    pub fn as_str(&self) -> &str {
        core::str::from_utf8(&self.bytes[..self.len]).unwrap_or("<invalid>")
    }
}
