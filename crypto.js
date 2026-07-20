'use strict';

const CryptoVault = (() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const ITERATIONS = 200000;

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(pin, saltBase64) {
    const salt = saltBase64 ? base64ToBytes(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
    const baseKey = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    return { key, saltBase64: bytesToBase64(salt) };
  }

  async function encryptJson(key, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = encoder.encode(JSON.stringify(value));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return {
      iv: bytesToBase64(iv),
      cipher: bytesToBase64(new Uint8Array(cipher))
    };
  }

  async function decryptJson(key, payload) {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
      key,
      base64ToBytes(payload.cipher)
    );
    return JSON.parse(decoder.decode(plain));
  }

  async function createPinVerifier(pin) {
    const { key, saltBase64 } = await deriveKey(pin);
    const verifier = await encryptJson(key, { ok: true, marker: 'ARCHIVIO_MALATTIA_V1' });
    return { key, saltBase64, verifier };
  }

  async function unlockWithPin(pin, saltBase64, verifier) {
    const { key } = await deriveKey(pin, saltBase64);
    const result = await decryptJson(key, verifier);
    if (!result?.ok || result.marker !== 'ARCHIVIO_MALATTIA_V1') throw new Error('PIN non valido');
    return key;
  }

  return { encryptJson, decryptJson, createPinVerifier, unlockWithPin };
})();
