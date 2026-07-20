'use strict';

const CACHE = 'archivio-malattia-v2.0.1';
const CORE_ASSETS = [
  './','./index.html','./styles.css','./app.js','./db.js','./crypto.js','./scanner.js','./manifest.webmanifest',
  './icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png',
  './vendor/tesseract/tesseract.min.js','./vendor/pdfjs/pdf.min.js','./vendor/pdfjs/pdf.worker.min.js','./vendor/jspdf/jspdf.umd.min.js'
];
const OCR_ASSETS = [
  './vendor/tesseract/worker.min.js','./vendor/tesseract/lang-data/ita.traineddata.gz',
  './vendor/tesseract/core/tesseract-core.wasm.js','./vendor/tesseract/core/tesseract-core.wasm',
  './vendor/tesseract/core/tesseract-core-simd.wasm.js','./vendor/tesseract/core/tesseract-core-simd.wasm',
  './vendor/tesseract/core/tesseract-core-lstm.wasm.js','./vendor/tesseract/core/tesseract-core-lstm.wasm',
  './vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js','./vendor/tesseract/core/tesseract-core-simd-lstm.wasm',
  './vendor/opencv/opencv.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE_ASSETS);
    await Promise.allSettled(OCR_ASSETS.map(asset => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target/')) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(CACHE);
        cache.put(event.request, response.clone()).catch(() => {});
        return response;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && url.origin === self.location.origin) {
        const cache = await caches.open(CACHE);
        cache.put(event.request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      return Response.error();
    }
  })());
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('documents').filter(value => value instanceof File && value.size > 0);
    if (files.length) {
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('sharedFiles', 'readwrite');
        const store = tx.objectStore('sharedFiles');
        files.forEach(file => store.put({
          id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          name: file.name || 'documento',
          type: file.type || 'application/octet-stream',
          size: file.size,
          blob: file,
          receivedAt: new Date().toISOString()
        }));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }
  } catch (error) {
    console.error('Condivisione non acquisita', error);
  }
  return Response.redirect(new URL('../?shared=1', request.url), 303);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('archivio-malattia-db', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath:'id' });
      if (!db.objectStoreNames.contains('sharedFiles')) db.createObjectStore('sharedFiles', { keyPath:'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
