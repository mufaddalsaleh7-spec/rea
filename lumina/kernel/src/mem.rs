//! Physical frame allocator (bitmap over the Multiboot2 memory map) and a
//! first-fit heap behind the `GlobalAlloc` interface.
//!
//! Frames are 4 KiB. The bitmap covers the first 4 GiB (1 bit per frame), which
//! is more than the identity map the boot loader installs.

use core::alloc::{GlobalAlloc, Layout};
use core::ptr;
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::{MmapEntry, TagMmap, TAG_MMAP};

pub const FRAME_SIZE: usize = 4096;
pub const MAX_FRAMES: usize = 1024 * 1024; // 4 GiB / 4 KiB

static mut BITMAP: [u64; MAX_FRAMES / 64] = [0; MAX_FRAMES / 64];
static MANAGED_FRAMES: AtomicUsize = AtomicUsize::new(0);
static FREE_FRAMES: AtomicUsize = AtomicUsize::new(0);

pub const HEAP_SIZE: usize = 2 * 1024 * 1024;

#[repr(C, align(4096))]
struct HeapRegion([u8; HEAP_SIZE]);
static mut HEAP: HeapRegion = HeapRegion([0; HEAP_SIZE]);

pub fn init(lower_kb: u32, upper_kb: u32, mmap: *const TagMmap) {
    let total_frames = core::cmp::min(MAX_FRAMES, (lower_kb as usize + upper_kb as usize) / 4);
    MANAGED_FRAMES.store(total_frames.max(FRAME_SIZE * 32 / FRAME_SIZE), Ordering::Relaxed);

    unsafe {
        // Start with everything above the first megabyte available; the identity
        // map and kernel image occupy [0, 1 MiB).
        for word in BITMAP.iter_mut() {
            *word = 0;
        }
        for frame in 0..(1024 * 1024 / FRAME_SIZE).min(total_frames) {
            set_used(frame);
        }

        // Honour the firmware memory map when the loader provides one.
        if !mmap.is_null() {
            let tag = &*mmap;
            if tag.entry_size as usize >= core::mem::size_of::<MmapEntry>() {
                let mut cursor = (mmap as *const u8).add(core::mem::size_of::<TagMmap>());
                let end = (mmap as *const u8).add(tag.size as usize);
                while cursor < end {
                    let entry = &*(cursor as *const MmapEntry);
                    // type 1 = available RAM
                    if entry.kind == 1 {
                        let first = (entry.address as usize / FRAME_SIZE).min(total_frames);
                        let count = (entry.length as usize / FRAME_SIZE).min(total_frames - first);
                        for frame in first..(first + count) {
                            clear_used(frame);
                        }
                    }
                    cursor = cursor.add(tag.entry_size as usize);
                }
            }
        }

        // Never hand out the region the kernel itself occupies.
        let kernel_start = 0x10_0000 / FRAME_SIZE;
        let kernel_end = (kernel_end_address() / FRAME_SIZE) + 1;
        for frame in kernel_start..kernel_end.min(total_frames) {
            set_used(frame);
        }

        let free = (0..total_frames).filter(|f| !is_used(*f)).count();
        FREE_FRAMES.store(free, Ordering::Relaxed);
    }
}

extern "C" {
    static __kernel_end: u8;
}

fn kernel_end_address() -> usize {
    unsafe { &__kernel_end as *const u8 as usize }
}

fn set_used(frame: usize) {
    unsafe {
        if frame < MAX_FRAMES {
            BITMAP[frame / 64] |= 1 << (frame % 64);
        }
    }
}

fn clear_used(frame: usize) {
    unsafe {
        if frame < MAX_FRAMES {
            BITMAP[frame / 64] &= !(1 << (frame % 64));
        }
    }
}

fn is_used(frame: usize) -> bool {
    unsafe {
        if frame < MAX_FRAMES {
            BITMAP[frame / 64] & (1 << (frame % 64)) != 0
        } else {
            true
        }
    }
}

/// Allocates one physical frame, returning its physical address.
pub fn alloc_frame() -> Option<usize> {
    let total = MANAGED_FRAMES.load(Ordering::Relaxed);
    for frame in 0..total {
        if !is_used(frame) {
            set_used(frame);
            FREE_FRAMES.fetch_sub(1, Ordering::Relaxed);
            return Some(frame * FRAME_SIZE);
        }
    }
    None
}

pub fn free_frame(address: usize) {
    let frame = address / FRAME_SIZE;
    if is_used(frame) {
        clear_used(frame);
        FREE_FRAMES.fetch_add(1, Ordering::Relaxed);
    }
}

pub fn free_frames() -> usize {
    FREE_FRAMES.load(Ordering::Relaxed)
}

pub fn managed_frames() -> usize {
    MANAGED_FRAMES.load(Ordering::Relaxed)
}

// ---------------------------------------------------------------------------
// Heap
// ---------------------------------------------------------------------------
struct Block {
    size: usize,
    free: bool,
    next: *mut Block,
}

const BLOCK_HEADER: usize = core::mem::size_of::<Block>();
static mut HEAP_START: *mut Block = ptr::null_mut();

pub fn heap_init() {
    unsafe {
        HEAP_START = HEAP.0.as_mut_ptr() as *mut Block;
        (*HEAP_START).size = HEAP_SIZE - BLOCK_HEADER;
        (*HEAP_START).free = true;
        (*HEAP_START).next = ptr::null_mut();
    }
}

pub struct LuminaAllocator;

fn align_up(value: usize, align: usize) -> usize {
    (value + align - 1) & !(align - 1)
}

unsafe impl GlobalAlloc for LuminaAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let align = layout.align().max(core::mem::align_of::<Block>());
        let mut block = HEAP_START;
        while !block.is_null() {
            let start = (block as *mut u8).add(BLOCK_HEADER) as usize;
            let aligned = align_up(start, align);
            let padding = aligned - start;
            if (*block).free && (*block).size >= layout.size() + padding {
                // Split the remainder into a new free block.
                let remaining = (*block).size - layout.size() - padding;
                if remaining > BLOCK_HEADER + 16 {
                    let new_block = (block as *mut u8).add(BLOCK_HEADER + padding + layout.size())
                        as *mut Block;
                    (*new_block).size = remaining - BLOCK_HEADER;
                    (*new_block).free = true;
                    (*new_block).next = (*block).next;
                    (*block).next = new_block;
                    (*block).size = layout.size() + padding;
                }
                (*block).free = false;
                return aligned as *mut u8;
            }
            block = (*block).next;
        }
        ptr::null_mut()
    }

    unsafe fn dealloc(&self, pointer: *mut u8, _layout: Layout) {
        // Recover the header by scanning: blocks are 16-byte aligned and the
        // header of the owning block is the last one starting before `pointer`.
        let mut block = HEAP_START;
        while !block.is_null() {
            let start = (block as *mut u8).add(BLOCK_HEADER) as usize;
            if start <= pointer as usize && pointer as usize < start + (*block).size {
                (*block).free = true;
                coalesce(block);
                return;
            }
            block = (*block).next;
        }
    }
}

unsafe fn coalesce(mut block: *mut Block) {
    while !block.is_null() {
        let next = (*block).next;
        if next.is_null() {
            return;
        }
        if (*block).free && (*next).free {
            (*block).size += (*next).size + BLOCK_HEADER;
            (*block).next = (*next).next;
        } else {
            block = next;
        }
    }
}

pub fn heap_stats() -> (usize, usize) {
    let mut used = 0;
    let mut free = 0;
    unsafe {
        let mut block = HEAP_START;
        while !block.is_null() {
            if (*block).free {
                free += (*block).size;
            } else {
                used += (*block).size;
            }
            block = (*block).next;
        }
    }
    (used, free)
}

#[global_allocator]
static ALLOCATOR: LuminaAllocator = LuminaAllocator;

/// Convenience re-export so `TAG_MMAP` stays referenced by the docs above.
pub const MMAP_TAG: u32 = TAG_MMAP;
