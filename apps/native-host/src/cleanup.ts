import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { resolveSupportDirectory, type SupportDirectoryOptions } from "./support-paths.js";

export interface CleanupOptions extends SupportDirectoryOptions {
  supportDir?: string;
  now?: number;
  maxAgeMs?: number;
}

export interface PurgeResult {
  scope: "temporary" | "all";
  removedFiles: number;
  removedDirectories: number;
}

interface RemovalCount {
  removedFiles: number;
  removedDirectories: number;
}

type CleanupLocationOptions = Pick<
  CleanupOptions,
  "supportDir" | "platform" | "homeDir" | "localAppData" | "xdgDataHome"
>;

function cleanupSupportDirectory(options: CleanupLocationOptions) {
  return path.resolve(options.supportDir ?? resolveSupportDirectory(options));
}

function emptyRemovalCount(): RemovalCount {
  return { removedFiles: 0, removedDirectories: 0 };
}

async function removeEntry(entryPath: string): Promise<RemovalCount> {
  let info;
  try {
    info = await lstat(entryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyRemovalCount();
    throw error;
  }
  if (info.isSymbolicLink() || info.isFile()) {
    await unlink(entryPath);
    return { removedFiles: 1, removedDirectories: 0 };
  }
  if (!info.isDirectory()) return emptyRemovalCount();
  const result = emptyRemovalCount();
  for (const entry of await readdir(entryPath, { withFileTypes: true })) {
    const removed = await removeEntry(path.join(entryPath, entry.name));
    result.removedFiles += removed.removedFiles;
    result.removedDirectories += removed.removedDirectories;
  }
  await rmdir(entryPath);
  result.removedDirectories += 1;
  return result;
}

async function removeExpiredFiles(
  directory: string,
  cutoff: number,
  removeEmptyDirectories: boolean
) {
  let removedFiles = 0;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return removedFiles;
    throw error;
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const info = await lstat(entryPath);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      if (removeEmptyDirectories) {
        removedFiles += await removeExpiredFiles(entryPath, cutoff, true);
        if (info.mtimeMs < cutoff) {
          await rmdir(entryPath).catch((error: NodeJS.ErrnoException) => {
            if (!["ENOENT", "ENOTEMPTY"].includes(error.code ?? "")) throw error;
          });
        }
      }
      continue;
    }
    if (info.isFile() && info.mtimeMs < cutoff) {
      await unlink(entryPath);
      removedFiles += 1;
    }
  }
  return removedFiles;
}

export async function cleanupExpiredHostFiles(options: CleanupOptions = {}) {
  const supportDir = cleanupSupportDirectory(options);
  const cutoff = (options.now ?? Date.now()) - (options.maxAgeMs ?? 24 * 60 * 60 * 1000);
  const tempDir = path.join(supportDir, "temp");
  const tasksDir = path.join(supportDir, "tasks");
  const removedFiles = await removeExpiredFiles(tempDir, cutoff, false)
    + await removeExpiredFiles(tasksDir, cutoff, true);
  return { removedFiles, roots: [tempDir, tasksDir] };
}

export async function purgeTemporaryData(options: CleanupLocationOptions = {}): Promise<PurgeResult> {
  const supportDir = cleanupSupportDirectory(options);
  const result = emptyRemovalCount();
  for (const directory of [path.join(supportDir, "temp"), path.join(supportDir, "tasks")]) {
    const removed = await removeEntry(directory);
    result.removedFiles += removed.removedFiles;
    result.removedDirectories += removed.removedDirectories;
  }
  return { scope: "temporary", ...result };
}

export async function purgeAllUserData(
  options: CleanupLocationOptions & { preserveBin?: boolean } = {}
): Promise<PurgeResult> {
  const supportDir = cleanupSupportDirectory(options);
  const result = emptyRemovalCount();
  let entries;
  try {
    entries = await readdir(supportDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { scope: "all", ...result };
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === "bin" && options.preserveBin !== false) continue;
    const removed = await removeEntry(path.join(supportDir, entry.name));
    result.removedFiles += removed.removedFiles;
    result.removedDirectories += removed.removedDirectories;
  }
  return { scope: "all", ...result };
}
