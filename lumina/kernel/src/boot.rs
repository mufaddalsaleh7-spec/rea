//! Lumina OS — 32-bit Multiboot2 entry, long-mode switch and 64-bit handoff.
//!
//! The loader leaves the CPU in 32-bit protected mode with a flat GDT. This
//! module builds a four-level page table that identity-maps the first gigabyte
//! with 2 MiB pages, enables PAE + long mode, then far-jumps into 64-bit code
//! where Rust takes over.

use core::arch::global_asm;

global_asm!(
    r#"
.section .multiboot2, "a"
.align 8
multiboot2_header_start:
    .long 0xE85250D6                     /* magic */
    .long 0                              /* architecture: i386 */
    .long multiboot2_header_end - multiboot2_header_start
    .long -(0xE85250D6 + 0 + (multiboot2_header_end - multiboot2_header_start))

    /* Framebuffer request: 1280x800x32 at boot so the kernel owns the display
       from the first instruction onward. */
    .short 5
    .short 0
    .long 20
    .long 1280
    .long 800
    .long 32

    /* End tag. */
    .short 0
    .short 0
    .long 8
multiboot2_header_end:

.section .text.boot32, "ax"
.code32
.global _start
_start:
    cli
    mov esp, offset boot_stack_top
    mov [saved_magic], eax
    mov [saved_info], ebx

    /* ---- build page tables: PML4 -> PDPT -> PD (512 x 2 MiB = 1 GiB) ---- */
    mov edi, offset page_table_l4
    xor eax, eax
    mov ecx, (page_table_end - page_table_l4) / 4
    rep stosd

    /* PML4[0] -> PDPT (present | writable) */
    mov eax, offset page_table_l3
    or  eax, 0x3
    mov [page_table_l4], eax

    /* PDPT[0] -> PD (present | writable) */
    mov eax, offset page_table_l2
    or  eax, 0x3
    mov [page_table_l3], eax

    /* Fill the PD: 512 entries, each mapping 2 MiB, present + writable + huge. */
    mov edi, offset page_table_l2
    mov eax, 0x83
    mov ecx, 512
1:
    mov [edi], eax
    add eax, 0x200000
    add edi, 8
    loop 1b

    /* ---- enable PAE ---- */
    mov eax, cr4
    or  eax, (1 << 5)
    mov cr4, eax

    /* ---- point CR3 at the PML4 ---- */
    mov eax, offset page_table_l4
    mov cr3, eax

    /* ---- EFER.LME = 1 ---- */
    mov ecx, 0xC0000080
    rdmsr
    or  eax, (1 << 8)
    wrmsr

    /* ---- enable paging (activates long mode) ---- */
    mov eax, cr0
    or  eax, 0x80000001
    mov cr0, eax

    /* ---- load the 64-bit GDT and far jump ---- */
    lgdt [gdt64_ptr]
    ljmp 0x08, offset long_mode_start

.code64
long_mode_start:
    mov ax, 0x10
    mov ds, ax
    mov es, ax
    mov fs, ax
    mov gs, ax
    mov ss, ax

    mov rsp, offset boot_stack_top
    xor rbp, rbp

    /* kmain(magic, multiboot_info_phys) */
    mov edi, dword ptr [saved_magic]
    mov esi, dword ptr [saved_info]
    call kmain

2:
    cli
    hlt
    jmp 2b

.section .rodata
.align 16
gdt64:
    .quad 0                              /* null */
    .quad 0x00AF9A000000FFFF             /* 64-bit kernel code, DPL 0 */
    .quad 0x00AF92000000FFFF             /* 64-bit kernel data, DPL 0 */
gdt64_ptr:
    .short gdt64_ptr - gdt64 - 1
    .quad gdt64

.section .bss
.align 4096
page_table_l4:
    .skip 4096
page_table_l3:
    .skip 4096
page_table_l2:
    .skip 4096
page_table_end:

.align 16
boot_stack:
    .skip 65536
boot_stack_top:

.align 8
saved_magic:
    .skip 4
saved_info:
    .skip 4
"#
);

extern "C" {
    fn kmain(magic: u32, info: u32) -> !;
}

/// Physical base of the identity-mapped region (kept for the memory module).
pub const IDENTITY_MAP_BYTES: usize = 1024 * 1024 * 1024;
