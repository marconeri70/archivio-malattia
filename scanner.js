'use strict';

const ScannerTools = (() => {
  let cvPromise = null;

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Lettura file non riuscita'));
      reader.readAsDataURL(file);
    });
  }

  function blobToDataUrl(blob) { return readFileAsDataUrl(blob); }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Immagine non leggibile'));
      image.src = dataUrl;
    });
  }

  function canvasToDataUrl(canvas, quality = 0.84) {
    return canvas.toDataURL('image/jpeg', quality);
  }

  function dataUrlBytes(dataUrl) {
    const base64 = String(dataUrl).split(',')[1] || '';
    return Math.floor(base64.length * 0.75);
  }

  async function compressImageFile(file, maxDimension = 2200, quality = 0.84) {
    const original = await readFileAsDataUrl(file);
    const image = await loadImage(original);
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvasToDataUrl(canvas, quality);
    return {
      name: file.name.replace(/\.[^.]+$/, '') + '.jpg',
      type: 'image/jpeg',
      size: dataUrlBytes(dataUrl),
      originalSize: file.size,
      width: canvas.width,
      height: canvas.height,
      dataUrl,
      compressed: file.size > dataUrlBytes(dataUrl)
    };
  }

  async function applyEdits(dataUrl, options = {}) {
    const image = await loadImage(dataUrl);
    const rotation = ((Number(options.rotation || 0) % 360) + 360) % 360;
    const rotated = document.createElement('canvas');
    const swap = rotation === 90 || rotation === 270;
    rotated.width = swap ? image.naturalHeight : image.naturalWidth;
    rotated.height = swap ? image.naturalWidth : image.naturalHeight;
    const rctx = rotated.getContext('2d', { willReadFrequently: true, alpha: false });
    rctx.fillStyle = '#fff';
    rctx.fillRect(0, 0, rotated.width, rotated.height);
    rctx.translate(rotated.width / 2, rotated.height / 2);
    rctx.rotate(rotation * Math.PI / 180);
    rctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

    const crop = options.crop || {};
    const left = Math.max(0, Math.min(45, Number(crop.left || 0))) / 100;
    const right = Math.max(0, Math.min(45, Number(crop.right || 0))) / 100;
    const top = Math.max(0, Math.min(45, Number(crop.top || 0))) / 100;
    const bottom = Math.max(0, Math.min(45, Number(crop.bottom || 0))) / 100;
    const sx = Math.round(rotated.width * left);
    const sy = Math.round(rotated.height * top);
    const sw = Math.max(50, Math.round(rotated.width * (1 - left - right)));
    const sh = Math.max(50, Math.round(rotated.height * (1 - top - bottom)));

    const output = document.createElement('canvas');
    const scale = Math.min(1, 2400 / Math.max(sw, sh));
    output.width = Math.max(1, Math.round(sw * scale));
    output.height = Math.max(1, Math.round(sh * scale));
    const ctx = output.getContext('2d', { willReadFrequently: true, alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.drawImage(rotated, sx, sy, sw, sh, 0, 0, output.width, output.height);

    if (options.grayscale || options.contrast) {
      const imageData = ctx.getImageData(0, 0, output.width, output.height);
      const pixels = imageData.data;
      const factor = options.contrast ? 1.45 : 1;
      for (let i = 0; i < pixels.length; i += 4) {
        let r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (options.grayscale) {
          const gray = Math.round(.299 * r + .587 * g + .114 * b);
          r = g = b = gray;
        }
        if (options.contrast) {
          r = Math.max(0, Math.min(255, factor * (r - 128) + 128));
          g = Math.max(0, Math.min(255, factor * (g - 128) + 128));
          b = Math.max(0, Math.min(255, factor * (b - 128) + 128));
        }
        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b;
      }
      ctx.putImageData(imageData, 0, 0);
    }

    const result = canvasToDataUrl(output, 0.88);
    return { dataUrl: result, size: dataUrlBytes(result), width: output.width, height: output.height };
  }

  async function ensureOpenCv() {
    if (window.cv?.Mat) return window.cv;
    if (window.cv && typeof window.cv.then === 'function') {
      window.cv = await window.cv;
      return window.cv;
    }
    if (cvPromise) return cvPromise;
    cvPromise = new Promise((resolve, reject) => {
      const finish = async () => {
        try {
          if (window.cv && typeof window.cv.then === 'function') window.cv = await window.cv;
          if (window.cv?.Mat) resolve(window.cv);
          else reject(new Error('OpenCV non inizializzato'));
        } catch (error) { reject(error); }
      };
      const existing = document.querySelector('script[data-opencv]');
      if (existing) {
        existing.addEventListener('load', finish, { once: true });
        existing.addEventListener('error', () => reject(new Error('Modulo scansione non disponibile')), { once: true });
        setTimeout(finish, 1500);
        return;
      }
      const script = document.createElement('script');
      script.src = 'vendor/opencv/opencv.js';
      script.async = true;
      script.dataset.opencv = 'true';
      script.onload = finish;
      script.onerror = () => reject(new Error('Modulo scansione non disponibile'));
      document.head.appendChild(script);
    });
    return cvPromise;
  }

  function orderPoints(points) {
    const sums = points.map(p => p.x + p.y);
    const diffs = points.map(p => p.y - p.x);
    return {
      tl: points[sums.indexOf(Math.min(...sums))],
      br: points[sums.indexOf(Math.max(...sums))],
      tr: points[diffs.indexOf(Math.min(...diffs))],
      bl: points[diffs.indexOf(Math.max(...diffs))]
    };
  }

  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  async function autoPerspective(dataUrl) {
    const cv = await ensureOpenCv();
    const image = await loadImage(dataUrl);
    const detectScale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const detectCanvas = document.createElement('canvas');
    detectCanvas.width = Math.round(image.naturalWidth * detectScale);
    detectCanvas.height = Math.round(image.naturalHeight * detectScale);
    detectCanvas.getContext('2d').drawImage(image, 0, 0, detectCanvas.width, detectCanvas.height);

    let src, gray, blur, edges, contours, hierarchy;
    try {
      src = cv.imread(detectCanvas);
      gray = new cv.Mat(); blur = new cv.Mat(); edges = new cv.Mat();
      contours = new cv.MatVector(); hierarchy = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      cv.Canny(blur, edges, 55, 165);
      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      let best = null;
      let bestArea = 0;
      const minArea = detectCanvas.width * detectCanvas.height * 0.18;
      for (let i = 0; i < contours.size(); i += 1) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        if (area <= minArea || area <= bestArea) { contour.delete(); continue; }
        const perimeter = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.025 * perimeter, true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          best?.delete();
          best = approx;
          bestArea = area;
        } else approx.delete();
        contour.delete();
      }
      if (!best) throw new Error('Bordi del documento non riconosciuti. Usa il ritaglio manuale.');
      const raw = best.data32S;
      const scaleBack = 1 / detectScale;
      const points = [];
      for (let i = 0; i < 8; i += 2) points.push({ x: raw[i] * scaleBack, y: raw[i + 1] * scaleBack });
      best.delete();
      const p = orderPoints(points);
      const width = Math.round(Math.max(distance(p.br, p.bl), distance(p.tr, p.tl)));
      const height = Math.round(Math.max(distance(p.tr, p.br), distance(p.tl, p.bl)));
      if (width < 150 || height < 150) throw new Error('Documento rilevato troppo piccolo.');

      const originalCanvas = document.createElement('canvas');
      originalCanvas.width = image.naturalWidth;
      originalCanvas.height = image.naturalHeight;
      originalCanvas.getContext('2d').drawImage(image, 0, 0);
      const originalMat = cv.imread(originalCanvas);
      const outputMat = new cv.Mat();
      const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [p.tl.x,p.tl.y,p.tr.x,p.tr.y,p.br.x,p.br.y,p.bl.x,p.bl.y]);
      const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0,width-1,0,width-1,height-1,0,height-1]);
      const transform = cv.getPerspectiveTransform(srcTri, dstTri);
      cv.warpPerspective(originalMat, outputMat, transform, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
      const outputCanvas = document.createElement('canvas');
      cv.imshow(outputCanvas, outputMat);
      const result = canvasToDataUrl(outputCanvas, 0.9);
      originalMat.delete(); outputMat.delete(); srcTri.delete(); dstTri.delete(); transform.delete();
      return { dataUrl: result, size: dataUrlBytes(result), width, height };
    } finally {
      src?.delete(); gray?.delete(); blur?.delete(); edges?.delete(); contours?.delete(); hierarchy?.delete();
    }
  }

  return { readFileAsDataUrl, blobToDataUrl, loadImage, compressImageFile, applyEdits, autoPerspective, ensureOpenCv, dataUrlBytes };
})();
