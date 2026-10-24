//! The agent pipeline, compiled into the kernel.
//!
//! Lumina is built by named agents, each owning one layer and one build target.
//! The manifest lives in `agents/manifest.json`; this table is the compiled
//! mirror the kernel reports through `SYS_AGENT_QUERY` so the running system can
//! always state *who* built the code it is executing.

use crate::{sched, serial};

pub struct Stage {
    pub role: &'static str,
    pub language: &'static str,
    pub target: &'static str,
    pub owns: &'static str,
}

pub static STAGES: [Stage; 9] = [
    Stage {
        role: "kernel-architect",
        language: "rust + asm",
        target: "kernel",
        owns: "boot, long mode, frames, heap, scheduler",
    },
    Stage {
        role: "graphics-engineer",
        language: "rust",
        target: "kernel",
        owns: "framebuffer claim, boot console, present path",
    },
    Stage {
        role: "compositor-engineer",
        language: "c++17",
        target: "compositor",
        owns: "surface, z-order, focus, glass, motion",
    },
    Stage {
        role: "shell-designer",
        language: "c++17",
        target: "lumina-host",
        owns: "menubar, dock, control centre, spotlight, workspaces",
    },
    Stage {
        role: "syscall-architect",
        language: "python + rust",
        target: "syscalls",
        owns: "24-call surface, broker, policy, audit",
    },
    Stage {
        role: "app-builder",
        language: "c++17",
        target: "compositor",
        owns: "files, terminal, notes, settings, monitor, studio",
    },
    Stage {
        role: "qa-engineer",
        language: "python",
        target: "syscalls",
        owns: "unit tests, goldens, still-frame regression",
    },
    Stage {
        role: "security-reviewer",
        language: "python",
        target: "lumina-host",
        owns: "threat model, syscall policy, capability review",
    },
    Stage {
        role: "release-manager",
        language: "python",
        target: "lumina-host",
        owns: "versioning, artifacts, docs, changelog",
    },
];

/// Kernel thread: walks the pipeline and logs each owned layer, proving the
/// manifest shipped inside the image.
pub extern "C" fn orchestrator_task() -> ! {
    serial::line("");
    serial::line("agent pipeline (compiled into this kernel)");
    for stage in STAGES.iter() {
        crate::print::kv(stage.role, stage.owns);
        sched::yield_now();
    }
    serial::line("pipeline complete: 9 roles");
    loop {
        sched::yield_now();
    }
}

/// `SYS_AGENT_QUERY`: 0 = count, otherwise 1-based stage description packed as
/// a stable hash the broker can expand from the manifest.
pub fn query(index: u64) -> u64 {
    if index == 0 {
        return STAGES.len() as u64;
    }
    match STAGES.get((index - 1) as usize) {
        Some(stage) => hash(stage.role) | (hash(stage.language) << 16),
        None => 0,
    }
}

fn hash(text: &str) -> u64 {
    let mut value: u64 = 5381;
    for byte in text.bytes() {
        value = value.wrapping_mul(33).wrapping_add(byte as u64);
    }
    value & 0xFFFF
}
