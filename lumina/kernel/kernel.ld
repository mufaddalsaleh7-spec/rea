/* Lumina OS — kernel link script.
 * The image is loaded by a Multiboot2 loader (GRUB or `qemu -kernel`) at 1 MiB
 * physical address, enters in 32-bit protected mode and switches itself to
 * 64-bit long mode before calling Rust.
 */
ENTRY(_start)

SECTIONS
{
    . = 1M;

    .multiboot2 : ALIGN(8)
    {
        KEEP(*(.multiboot2))
    }

    .text : ALIGN(4K)
    {
        *(.text.boot32)
        *(.text.entry)
        *(.text .text.*)
    }

    .rodata : ALIGN(4K)
    {
        *(.rodata .rodata.*)
    }

    .data : ALIGN(4K)
    {
        *(.data .data.*)
    }

    .bss : ALIGN(4K)
    {
        __bss_start = .;
        *(COMMON)
        *(.bss .bss.*)
        __bss_end = .;
    }

    . = ALIGN(4K);
    __kernel_end = .;

    /DISCARD/ :
    {
        *(.eh_frame)
        *(.eh_frame_hdr)
        *(.comment)
        *(.note.*)
    }
}
