import { constants } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import type { PlatformError } from "../core/errors.ts";
import { fromUnknownError, platformError } from "../core/errors.ts";
import type { Result } from "../core/result.ts";
import { err, fromPromise, ok } from "../core/result.ts";

/**
 * The ReaOS virtual filesystem.
 *
 * The platform exposes one filesystem namespace rooted at a single directory on
 * the host. Every path crosses this module before touching the host disk:
 *
 *  - paths are *virtual* and absolute ("/Documents/notes.txt");
 *  - escapes ("..", absolute host paths, symlinks pointing outside the root)
 *    are rejected, so no service can reach host files it was not given;
 *  - the namespace is mechanism only: *policy* (which application may write
 *    where, and the read-only "/System" area) belongs to the Files service;
 *  - reads and listings are bounded so one huge file cannot exhaust memory.
 *
 * This is the "kernel" of ReaOS in the sense that it owns the namespace and the
 * access rules; the host OS still owns the actual storage device.
 */

export type FileKind = "file" | "directory" | "symlink" | "other";

export type FileEntry = {
  /** Virtual absolute path, always "/"-prefixed. */
  readonly path: string;
  readonly name: string;
  readonly kind: FileKind;
  readonly size: number;
  readonly modifiedAt: string;
};

export type DirectoryListing = {
  readonly path: string;
  readonly entries: readonly FileEntry[];
  /** True when the directory held more entries than `maxListEntries`. */
  readonly truncated: boolean;
};

export type VirtualFileSystem = {
  readonly root: string;
  readonly virtualRoot: string;
  readonly ensureLayout: () => Promise<Result<void, PlatformError>>;
  readonly resolve: (
    virtualPath: string,
  ) => Promise<Result<string, PlatformError>>;
  readonly stat: (
    virtualPath: string,
  ) => Promise<Result<FileEntry, PlatformError>>;
  readonly list: (
    virtualPath: string,
  ) => Promise<Result<DirectoryListing, PlatformError>>;
  readonly readText: (
    virtualPath: string,
  ) => Promise<Result<string, PlatformError>>;
  readonly writeText: (
    virtualPath: string,
    content: string,
    options?: { readonly overwrite?: boolean },
  ) => Promise<Result<FileEntry, PlatformError>>;
  readonly mkdir: (
    virtualPath: string,
    options?: { readonly recursive?: boolean },
  ) => Promise<Result<FileEntry, PlatformError>>;
  readonly move: (
    from: string,
    to: string,
  ) => Promise<Result<FileEntry, PlatformError>>;
  readonly remove: (
    virtualPath: string,
    options?: { readonly recursive?: boolean },
  ) => Promise<Result<void, PlatformError>>;
};

export type VirtualFileSystemOptions = {
  /** Host directory that backs the platform namespace. */
  readonly root: string;
  readonly maxReadBytes?: number;
  readonly maxListEntries?: number;
  readonly maxPathLength?: number;
  readonly layout?: readonly string[];
};

const DEFAULT_LAYOUT = [
  "Desktop",
  "Documents",
  "Downloads",
  "Pictures",
  "System",
  ".Trash",
] as const;
const DEFAULT_MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_MAX_LIST_ENTRIES = 2000;
const DEFAULT_MAX_PATH_LENGTH = 1024;

const normalizeSegments = (input: string): readonly string[] =>
  input.split("/").filter((segment) => segment.length > 0 && segment !== ".");

const toVirtualPath = (segments: readonly string[]): string =>
  segments.length === 0 ? "/" : `/${segments.join("/")}`;

const kindOf = (entry: {
  isFile: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
}): FileKind =>
  entry.isFile()
    ? "file"
    : entry.isDirectory()
      ? "directory"
      : entry.isSymbolicLink()
        ? "symlink"
        : "other";

export const createVirtualFileSystem = (
  options: VirtualFileSystemOptions,
): VirtualFileSystem => {
  const root = resolve(options.root);
  const maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;
  const maxListEntries = options.maxListEntries ?? DEFAULT_MAX_LIST_ENTRIES;
  const maxPathLength = options.maxPathLength ?? DEFAULT_MAX_PATH_LENGTH;
  const layout = options.layout ?? DEFAULT_LAYOUT;

  const insideRoot = (absolute: string): boolean =>
    absolute === root ||
    absolute.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

  /**
   * Validates a virtual path and returns both its canonical virtual form and
   * the host path. Symlink escapes are checked against the nearest existing
   * ancestor so a link created inside the root cannot point outside it.
   */
  const resolveVirtual = async (
    virtualPath: string,
  ): Promise<Result<{ virtual: string; absolute: string }, PlatformError>> => {
    if (typeof virtualPath !== "string" || virtualPath.includes("\0"))
      return err(
        platformError("INVALID_ARGUMENT", "The path is not a valid string."),
      );
    if (virtualPath.length > maxPathLength)
      return err(platformError("LIMIT_EXCEEDED", "The path is too long."));

    const segments = normalizeSegments(virtualPath);
    if (segments.includes(".."))
      return err(
        platformError(
          "INVALID_ARGUMENT",
          "Relative parent segments are not allowed in platform paths.",
        ),
      );
    const virtual = toVirtualPath(segments);
    const absolute = join(root, ...segments);
    if (!insideRoot(absolute))
      return err(
        platformError(
          "PERMISSION_DENIED",
          "The path leaves the platform root.",
        ),
      );

    // Resolve the deepest existing ancestor to catch symlink escapes.
    let probe = absolute;
    for (;;) {
      try {
        const real = await realpath(probe);
        if (!insideRoot(real))
          return err(
            platformError(
              "PERMISSION_DENIED",
              "The path escapes through a symbolic link.",
            ),
          );
        break;
      } catch {
        const parent = dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
    }
    return ok({ virtual, absolute });
  };

  const entryOf = async (
    virtual: string,
    absolute: string,
  ): Promise<Result<FileEntry, PlatformError>> => {
    try {
      const info = await stat(absolute);
      return ok({
        path: virtual,
        name: virtual === "/" ? "/" : (virtual.split("/").at(-1) ?? virtual),
        kind: kindOf(info),
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    } catch (cause) {
      return err(
        fromUnknownError(cause, `"${virtual}" could not be inspected.`),
      );
    }
  };

  const vfs: VirtualFileSystem = {
    root,
    virtualRoot: "/",

    ensureLayout: async () => {
      try {
        await mkdir(root, { recursive: true });
        for (const name of layout)
          await mkdir(join(root, name), { recursive: true });
        return ok(undefined);
      } catch (cause) {
        return err(
          fromUnknownError(
            cause,
            "The platform home directory could not be prepared.",
          ),
        );
      }
    },

    resolve: async (virtualPath) => {
      const resolved = await resolveVirtual(virtualPath);
      return resolved.ok ? ok(resolved.value.absolute) : resolved;
    },

    stat: async (virtualPath) => {
      const resolved = await resolveVirtual(virtualPath);
      if (!resolved.ok) return resolved;
      return entryOf(resolved.value.virtual, resolved.value.absolute);
    },

    list: async (virtualPath) => {
      const resolved = await resolveVirtual(virtualPath);
      if (!resolved.ok) return resolved;
      try {
        const dirents = await readdir(resolved.value.absolute, {
          withFileTypes: true,
        });
        const truncated = dirents.length > maxListEntries;
        const selected = dirents.slice(0, maxListEntries);
        const entries: FileEntry[] = [];
        for (const dirent of selected) {
          const childVirtual = toVirtualPath([
            ...normalizeSegments(resolved.value.virtual),
            dirent.name,
          ]);
          const info = await stat(join(resolved.value.absolute, dirent.name));
          entries.push({
            path: childVirtual,
            name: dirent.name,
            kind: kindOf(dirent),
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
          });
        }
        entries.sort(compareEntries);
        return ok({ path: resolved.value.virtual, entries, truncated });
      } catch (cause) {
        return err(
          fromUnknownError(
            cause,
            `"${resolved.value.virtual}" could not be listed.`,
          ),
        );
      }
    },

    readText: async (virtualPath) => {
      const resolved = await resolveVirtual(virtualPath);
      if (!resolved.ok) return resolved;
      try {
        const info = await stat(resolved.value.absolute);
        if (!info.isFile())
          return err(
            platformError(
              "INVALID_ARGUMENT",
              `"${resolved.value.virtual}" is not a file.`,
            ),
          );
        if (info.size > maxReadBytes)
          return err(
            platformError(
              "LIMIT_EXCEEDED",
              `"${resolved.value.virtual}" is larger than the ${maxReadBytes} byte editor limit.`,
              { size: info.size },
            ),
          );
        const bytes = await readFile(resolved.value.absolute);
        return ok(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
      } catch (cause) {
        return err(
          fromUnknownError(
            cause,
            `"${resolved.value.virtual}" could not be read.`,
          ),
        );
      }
    },

    writeText: async (virtualPath, content, writeOptions) => {
      const resolved = await resolveVirtual(virtualPath);
      if (!resolved.ok) return resolved;
      if (typeof content !== "string")
        return err(
          platformError("INVALID_ARGUMENT", "File content must be a string."),
        );
      const overwrite = writeOptions?.overwrite ?? true;
      try {
        if (!overwrite) {
          const exists = await pathExists(resolved.value.absolute);
          if (exists)
            return err(
              platformError(
                "ALREADY_EXISTS",
                `"${resolved.value.virtual}" already exists.`,
              ),
            );
        }
        // Atomic replace: write a sibling temp file, then rename over the target
        // so a crash cannot leave a truncated document.
        const temporary = `${resolved.value.absolute}.reaos-${process.pid}.tmp`;
        await writeFile(temporary, content, "utf8");
        await rename(temporary, resolved.value.absolute);
        return entryOf(resolved.value.virtual, resolved.value.absolute);
      } catch (cause) {
        return err(
          fromUnknownError(
            cause,
            `"${resolved.value.virtual}" could not be written.`,
          ),
        );
      }
    },

    mkdir: async (virtualPath, mkdirOptions) => {
      const resolved = await resolveVirtual(virtualPath);
      if (!resolved.ok) return resolved;
      const recursive = mkdirOptions?.recursive ?? true;
      try {
        await mkdir(resolved.value.absolute, { recursive });
        return entryOf(resolved.value.virtual, resolved.value.absolute);
      } catch (cause) {
        return err(
          fromUnknownError(
            cause,
            `"${resolved.value.virtual}" could not be created.`,
          ),
        );
      }
    },

    move: async (from, to) => {
      const resolvedFrom = await resolveVirtual(from);
      if (!resolvedFrom.ok) return resolvedFrom;
      const resolvedTo = await resolveVirtual(to);
      if (!resolvedTo.ok) return resolvedTo;
      if (resolvedFrom.value.virtual === resolvedTo.value.virtual)
        return err(
          platformError(
            "INVALID_ARGUMENT",
            "Source and destination are the same entry.",
          ),
        );
      // Never clobber an existing entry: a rename that silently replaced a file
      // would be an unrecoverable data loss path in the file manager.
      if (await pathExists(resolvedTo.value.absolute))
        return err(
          platformError(
            "ALREADY_EXISTS",
            `"${resolvedTo.value.virtual}" already exists.`,
            {
              path: resolvedTo.value.virtual,
            },
          ),
        );
      try {
        await rename(resolvedFrom.value.absolute, resolvedTo.value.absolute);
        return entryOf(resolvedTo.value.virtual, resolvedTo.value.absolute);
      } catch (cause) {
        return err(
          fromUnknownError(
            cause,
            `"${resolvedFrom.value.virtual}" could not be moved to "${resolvedTo.value.virtual}".`,
          ),
        );
      }
    },

    remove: async (virtualPath, removeOptions) => {
      const resolved = await resolveVirtual(virtualPath);
      if (!resolved.ok) return resolved;
      if (resolved.value.virtual === "/")
        return err(
          platformError(
            "INVALID_ARGUMENT",
            "The platform root cannot be removed.",
          ),
        );
      try {
        await rm(resolved.value.absolute, {
          recursive: removeOptions?.recursive ?? false,
          force: false,
        });
        return ok(undefined);
      } catch (cause) {
        return err(
          fromUnknownError(
            cause,
            `"${resolved.value.virtual}" could not be removed.`,
          ),
        );
      }
    },
  };

  return vfs;
};

const compareEntries = (a: FileEntry, b: FileEntry): number => {
  const rank = (entry: FileEntry): number =>
    entry.kind === "directory" ? 0 : 1;
  const byRank = rank(a) - rank(b);
  // Locale-independent ordering keeps listings identical across hosts.
  if (byRank !== 0) return byRank;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};

const pathExists = async (absolute: string): Promise<boolean> => {
  try {
    await access(absolute, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};
