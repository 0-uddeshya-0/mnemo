"use client";
/** Minimal IndexedDB wrapper (no deps) for the on-device replica: one snapshot + a write queue. */
import type { Snapshot } from "@/lib/offline/types";

const DB_NAME = "mnemosyne-offline";
const VERSION = 1;
const SNAPSHOT_STORE = "snapshot";
const QUEUE_STORE = "queue";
const SNAPSHOT_KEY = "current";

export interface QueuedCapture {
  id: string;
  createdAt: string;
  payload: { kind: "note"; title?: string; body: string } | { kind: "url"; url: string };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE);
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export function putSnapshot(snapshot: Snapshot): Promise<IDBValidKey> {
  return tx(SNAPSHOT_STORE, "readwrite", (s) => s.put(snapshot, SNAPSHOT_KEY));
}
export function getSnapshot(): Promise<Snapshot | null> {
  return tx<Snapshot | undefined>(SNAPSHOT_STORE, "readonly", (s) => s.get(SNAPSHOT_KEY)).then(
    (v) => v ?? null,
  );
}

export function enqueueCapture(item: QueuedCapture): Promise<IDBValidKey> {
  return tx(QUEUE_STORE, "readwrite", (s) => s.put(item));
}
export function listQueue(): Promise<QueuedCapture[]> {
  return tx<QueuedCapture[]>(QUEUE_STORE, "readonly", (s) => s.getAll());
}
export function removeFromQueue(id: string): Promise<undefined> {
  return tx<undefined>(QUEUE_STORE, "readwrite", (s) => s.delete(id));
}
