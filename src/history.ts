import type { AnalysisMode, AnalysisResponse } from "../shared/report";

const DATABASE_NAME = "photo-replica-studio";
const STORE_NAME = "analyses";
const DATABASE_VERSION = 1;

export interface SavedAnalysis {
  id: string;
  savedAt: number;
  mode: AnalysisMode;
  note: string;
  response: AnalysisResponse;
  reference?: Blob;
  current?: Blob;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function createPreview(file: File | null) {
  if (!file) return undefined;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Preview encoding failed")), "image/jpeg", 0.84);
    });
  } catch {
    return file;
  }
}

export async function saveAnalysis(input: {
  response: AnalysisResponse;
  mode: AnalysisMode;
  note: string;
  reference: File | null;
  current: File | null;
}) {
  const [reference, current] = await Promise.all([
    createPreview(input.reference),
    createPreview(input.current),
  ]);
  const record: SavedAnalysis = {
    id: input.response.requestId,
    savedAt: Date.now(),
    mode: input.mode,
    note: input.note,
    response: input.response,
    reference,
    current,
  };
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(record);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

export async function listAnalyses() {
  const database = await openDatabase();
  const records = await requestResult(database.transaction(STORE_NAME).objectStore(STORE_NAME).getAll()) as SavedAnalysis[];
  database.close();
  return records.sort((left, right) => right.savedAt - left.savedAt);
}

export async function deleteAnalysis(id: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).delete(id);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export function blobToFile(blob: Blob | undefined, name: string) {
  return blob ? new File([blob], name, { type: blob.type || "image/jpeg" }) : null;
}
