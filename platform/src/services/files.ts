import type { PlatformError } from "../core/errors.ts";
import { platformError } from "../core/errors.ts";
import type { EventBus } from "../core/events.ts";
import type { Capability, PermissionBroker } from "../core/permissions.ts";
import type { Result } from "../core/result.ts";
import { err, ok } from "../core/result.ts";
import type {
  DirectoryListing,
  FileEntry,
  VirtualFileSystem,
} from "../kernel/vfs.ts";

/**
 * The user-visible file service.
 *
 * This layer owns *policy*: which capability a caller needs, which parts of the
 * namespace are read-only, and what "delete" means. Deletion moves an entry to
 * the trash instead of unlinking it, so an accidental action in the file manager
 * is always recoverable. The virtual filesystem underneath only owns namespace
 * safety.
 */

export const READ_ONLY_PREFIXES = ["/System"] as const;

export type SearchHit = FileEntry & {
  readonly parent: string;
  readonly score: number;
};

export type FilesService = {
  readonly list: (
    path: string,
  ) => Promise<Result<DirectoryListing, PlatformError>>;
  readonly stat: (path: string) => Promise<Result<FileEntry, PlatformError>>;
  readonly readText: (path: string) => Promise<Result<string, PlatformError>>;
  readonly writeText: (
    path: string,
    content: string,
    options?: { readonly overwrite?: boolean },
  ) => Promise<Result<FileEntry, PlatformError>>;
  readonly createDirectory: (
    path: string,
  ) => Promise<Result<FileEntry, PlatformError>>;
  readonly rename: (
    from: string,
    to: string,
  ) => Promise<Result<FileEntry, PlatformError>>;
  /** Moves the entry to "/.Trash"; never unlinks user data directly. */
  readonly remove: (path: string) => Promise<Result<string, PlatformError>>;
  readonly listTrash: () => Promise<Result<DirectoryListing, PlatformError>>;
  /** Permanent deletion. Only entries already inside "/.Trash" are eligible. */
  readonly purge: (path: string) => Promise<Result<void, PlatformError>>;
  readonly emptyTrash: () => Promise<Result<number, PlatformError>>;
  readonly search: (
    query: string,
    limit?: number,
  ) => Promise<Result<readonly SearchHit[], PlatformError>>;
};

export type FilesServiceOptions = {
  readonly vfs: VirtualFileSystem;
  readonly permissions: PermissionBroker;
  readonly bus: EventBus;
  readonly maxSearchNodes?: number;
  readonly maxSearchDepth?: number;
  readonly clock?: () => Date;
};

const isReadOnly = (path: string): boolean =>
  READ_ONLY_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

const normaliseQuery = (value: string): string => value.trim().toLowerCase();

export const createFilesService = (
  options: FilesServiceOptions,
): FilesService => {
  const { vfs, permissions, bus } = options;
  const clock = options.clock ?? (() => new Date());
  const maxSearchNodes = options.maxSearchNodes ?? 1200;
  const maxSearchDepth = options.maxSearchDepth ?? 4;

  const requireCapability = (
    capability: Capability,
  ): Result<void, PlatformError> => permissions.check(capability);

  const announce = (action: string, path: string): void => {
    bus.emit("files.changed", { action, path });
  };

  const guardWrite = (path: string): Result<void, PlatformError> =>
    isReadOnly(path)
      ? err(
          platformError(
            "PERMISSION_DENIED",
            `"${path}" is a read-only system location.`,
            { path },
          ),
        )
      : ok(undefined);

  const list: FilesService["list"] = async (path) => {
    const allowed = requireCapability("fs:read");
    if (!allowed.ok) return allowed;
    return vfs.list(path);
  };

  const uniqueTrashName = async (name: string): Promise<string> => {
    const stamp = clock().toISOString().replaceAll(":", "-").replace(".", "-");
    const base = `${stamp}-${name}`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt}`;
      const existing = await vfs.stat(`/.Trash/${candidate}`);
      if (!existing.ok) return candidate;
    }
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
  };

  const collectTrash = async (): Promise<
    Result<readonly FileEntry[], PlatformError>
  > => {
    const listing = await vfs.list("/.Trash");
    return listing.ok ? ok(listing.value.entries) : listing;
  };

  return {
    list,

    stat: async (path) => {
      const allowed = requireCapability("fs:read");
      if (!allowed.ok) return allowed;
      return vfs.stat(path);
    },

    readText: async (path) => {
      const allowed = requireCapability("fs:read");
      if (!allowed.ok) return allowed;
      return vfs.readText(path);
    },

    writeText: async (path, content, writeOptions) => {
      const allowed = requireCapability("fs:write");
      if (!allowed.ok) return allowed;
      const writable = guardWrite(path);
      if (!writable.ok) return writable;
      const written = await vfs.writeText(path, content, writeOptions);
      if (written.ok) announce("write", written.value.path);
      return written;
    },

    createDirectory: async (path) => {
      const allowed = requireCapability("fs:write");
      if (!allowed.ok) return allowed;
      const writable = guardWrite(path);
      if (!writable.ok) return writable;
      const created = await vfs.mkdir(path, { recursive: false });
      if (created.ok) announce("create-directory", created.value.path);
      return created;
    },

    rename: async (from, to) => {
      const allowed = requireCapability("fs:write");
      if (!allowed.ok) return allowed;
      const fromWritable = guardWrite(from);
      if (!fromWritable.ok) return fromWritable;
      const toWritable = guardWrite(to);
      if (!toWritable.ok) return toWritable;
      const moved = await vfs.move(from, to);
      if (moved.ok) announce("rename", moved.value.path);
      return moved;
    },

    remove: async (path) => {
      const allowed = requireCapability("fs:write");
      if (!allowed.ok) return allowed;
      const writable = guardWrite(path);
      if (!writable.ok) return writable;
      if (path === "/" || path === "/.Trash")
        return err(
          platformError(
            "INVALID_ARGUMENT",
            `"${path}" cannot be moved to the trash.`,
          ),
        );
      const entry = await vfs.stat(path);
      if (!entry.ok) return entry;
      const trashName = await uniqueTrashName(
        entry.value.name === "/" ? "root" : entry.value.name,
      );
      const moved = await vfs.move(path, `/.Trash/${trashName}`);
      if (!moved.ok) return moved;
      announce("trash", moved.value.path);
      return ok(moved.value.path);
    },

    listTrash: async () => {
      const allowed = requireCapability("fs:read");
      if (!allowed.ok) return allowed;
      return vfs.list("/.Trash");
    },

    purge: async (path) => {
      const allowed = requireCapability("fs:write");
      if (!allowed.ok) return allowed;
      if (!path.startsWith("/.Trash/"))
        return err(
          platformError(
            "PERMISSION_DENIED",
            "Only items already in the trash can be deleted permanently.",
            { path },
          ),
        );
      const removed = await vfs.remove(path, { recursive: true });
      if (removed.ok) announce("purge", path);
      return removed;
    },

    emptyTrash: async () => {
      const allowed = requireCapability("fs:write");
      if (!allowed.ok) return allowed;
      const contents = await collectTrash();
      if (!contents.ok) return contents;
      let removed = 0;
      for (const entry of contents.value) {
        const cleared = await vfs.remove(entry.path, { recursive: true });
        if (!cleared.ok) return cleared;
        removed += 1;
      }
      if (removed > 0) announce("empty-trash", "/.Trash");
      return ok(removed);
    },

    search: async (query, limit = 40) => {
      const allowed = requireCapability("fs:read");
      if (!allowed.ok) return allowed;
      const needle = normaliseQuery(query);
      if (needle.length === 0) return ok([]);
      const hits: SearchHit[] = [];
      const queue: { path: string; depth: number }[] = [
        { path: "/", depth: 0 },
      ];
      let visited = 0;
      while (queue.length > 0 && visited < maxSearchNodes) {
        const next = queue.shift();
        if (next === undefined) break;
        if (next.path === "/.Trash" || next.path === "/System") continue;
        const listing = await vfs.list(next.path);
        if (!listing.ok) continue;
        for (const entry of listing.value.entries) {
          visited += 1;
          const name = entry.name.toLowerCase();
          if (name.includes(needle))
            hits.push({
              ...entry,
              parent: next.path,
              score: score(name, needle),
            });
          if (entry.kind === "directory" && next.depth + 1 <= maxSearchDepth)
            queue.push({ path: entry.path, depth: next.depth + 1 });
        }
      }
      // Codepoint ordering, not locale ordering: results must not depend on the
      // host's ICU data (same rule the REA domain layer follows).
      hits.sort(
        (a, b) => b.score - a.score || compareCodePoints(a.path, b.path),
      );
      return ok(hits.slice(0, limit));
    },
  };
};

const compareCodePoints = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * Ranking favours exact names, then prefix matches, then shorter names, so a
 * search for "no" surfaces "notes" before "annual-report-notes".
 */
const score = (name: string, needle: string): number => {
  if (name === needle) return 100;
  if (name.startsWith(needle)) return 70 - Math.min(20, name.length);
  const index = name.indexOf(needle);
  return Math.max(10, 40 - index - Math.min(10, name.length - needle.length));
};
