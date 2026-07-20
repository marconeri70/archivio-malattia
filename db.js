'use strict';

const SecureDB = (() => {
  const DB_NAME = 'archivio-malattia-db';
  const DB_VERSION = 2;
  const RECORDS = 'records';
  const SHARED = 'sharedFiles';
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(SHARED)) db.createObjectStore(SHARED, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function transact(storeName, mode, callback) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = callback(store, tx); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Operazione annullata'));
    });
  }

  async function put(record) { return transact(RECORDS, 'readwrite', store => store.put(record)); }
  async function remove(id) { return transact(RECORDS, 'readwrite', store => store.delete(id)); }
  async function clear() { return transact(RECORDS, 'readwrite', store => store.clear()); }

  async function getAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORDS, 'readonly');
      const req = tx.objectStore(RECORDS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function replaceAll(records) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORDS, 'readwrite');
      const store = tx.objectStore(RECORDS);
      store.clear();
      for (const item of records) store.put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Sostituzione annullata'));
    });
  }

  async function getSharedFiles() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHARED, 'readonly');
      const req = tx.objectStore(SHARED).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearSharedFiles() { return transact(SHARED, 'readwrite', store => store.clear()); }

  async function destroy() {
    if (dbPromise) {
      const db = await dbPromise;
      db.close();
      dbPromise = null;
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Chiudi le altre schede dell’app e riprova.'));
    });
  }

  return { put, remove, clear, getAll, replaceAll, getSharedFiles, clearSharedFiles, destroy };
})();
