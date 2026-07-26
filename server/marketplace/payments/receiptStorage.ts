/**
 * Private receipt storage — service-role only, no public/signed URLs.
 * Paths are always server-generated from upload intents.
 */
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";

export type ReceiptStorage = {
  upload(storagePath: string, bytes: Buffer, mimeType: string): Promise<void>;
  remove(storagePath: string): Promise<void>;
  /** Test-only presence check; production uses private backend download. */
  exists?(storagePath: string): Promise<boolean>;
  read?(storagePath: string): Promise<Buffer>;
};

function assertSafeStoragePath(storagePath: string): void {
  const p = String(storagePath || "");
  if (!p || p.length > 200) {
    throw new Error("INVALID_STORAGE_PATH");
  }
  if (!/^mp-receipts\/[a-f0-9]{12}\/mpui_[a-z0-9]+$/i.test(p)) {
    throw new Error("INVALID_STORAGE_PATH");
  }
  if (p.includes("..") || p.includes("//") || p.includes("\\")) {
    throw new Error("INVALID_STORAGE_PATH");
  }
}

/** In-memory private store for disposable tests. */
export function createMemoryReceiptStorage(): ReceiptStorage & {
  objects: Map<string, Buffer>;
  uploadCalls: number;
} {
  const objects = new Map<string, Buffer>();
  const store = {
    objects,
    uploadCalls: 0,
    async upload(storagePath: string, bytes: Buffer, _mimeType: string) {
      assertSafeStoragePath(storagePath);
      store.uploadCalls += 1;
      objects.set(storagePath, Buffer.from(bytes));
    },
    async remove(storagePath: string) {
      assertSafeStoragePath(storagePath);
      objects.delete(storagePath);
    },
    async exists(storagePath: string) {
      return objects.has(storagePath);
    },
    async read(storagePath: string) {
      const buf = objects.get(storagePath);
      if (!buf) throw new Error("NOT_FOUND");
      return Buffer.from(buf);
    },
  };
  return store;
}

/** Local filesystem private store under an isolated temp root (never public). */
export function createLocalReceiptStorage(rootDir: string): ReceiptStorage {
  return {
    async upload(storagePath: string, bytes: Buffer, _mimeType: string) {
      assertSafeStoragePath(storagePath);
      const full = path.join(rootDir, storagePath);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes, { flag: "wx" });
    },
    async remove(storagePath: string) {
      assertSafeStoragePath(storagePath);
      const full = path.join(rootDir, storagePath);
      try {
        await unlink(full);
      } catch {
        /* already gone */
      }
    },
    async exists(storagePath: string) {
      try {
        await readFile(path.join(rootDir, storagePath));
        return true;
      } catch {
        return false;
      }
    },
    async read(storagePath: string) {
      return readFile(path.join(rootDir, storagePath));
    },
  };
}

export { assertSafeStoragePath };
