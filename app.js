'use strict';

const App = (() => {
  const el = id => document.getElementById(id);
  const state = {
    key: null,
    records: [],
    selectedRecordId: null,
    attachment: null,
    installPrompt: null
  };

  const PIN_STORAGE_KEY = 'am_pin_config_v1';
  const INPS_URL = 'https://www.inps.it/';

  function init() {
    bindEvents();
    setupPdfJs();
    initServiceWorker();
    initInstallPrompt();
    showSecurityMode();
  }

  function bindEvents() {
    el('setupPinForm').addEventListener('submit', handleSetupPin);
    el('unlockForm').addEventListener('submit', handleUnlock);
    el('resetAppBtn').addEventListener('click', resetApplication);
    el('lockBtn').addEventListener('click', lockApp);
    el('installBtn').addEventListener('click', installApp);

    el('addCertificateBtn').addEventListener('click', () => openCertificateDialog());
    el('emptyAddBtn').addEventListener('click', () => openCertificateDialog());
    el('closeDialogBtn').addEventListener('click', closeCertificateDialog);
    el('cancelBtn').addEventListener('click', closeCertificateDialog);
    el('certificateForm').addEventListener('submit', saveCertificate);
    el('documentInput').addEventListener('change', handleDocumentSelection);
    el('removeFileBtn').addEventListener('click', removeAttachment);
    el('analyzeBtn').addEventListener('click', analyzeDocument);

    el('searchInput').addEventListener('input', renderRecords);
    el('yearFilter').addEventListener('change', renderRecords);
    el('certificateList').addEventListener('click', handleListClick);

    el('closeDetailsBtn').addEventListener('click', () => el('detailsDialog').close());
    el('editRecordBtn').addEventListener('click', editSelectedRecord);
    el('deleteRecordBtn').addEventListener('click', deleteSelectedRecord);
    el('viewAttachmentBtn').addEventListener('click', openSelectedAttachment);

    el('exportJsonBtn').addEventListener('click', exportEncryptedBackup);
    el('importJsonBtn').addEventListener('click', () => el('importBackupInput').click());
    el('importBackupInput').addEventListener('change', importEncryptedBackup);
    el('exportCsvBtn').addEventListener('click', exportCsv);
    el('openInpsBtn').addEventListener('click', () => window.open(INPS_URL, '_blank', 'noopener'));
  }

  function setupPdfJs() {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }

  function showSecurityMode() {
    const config = getPinConfig();
    el('setupPinForm').classList.toggle('hidden', Boolean(config));
    el('unlockForm').classList.toggle('hidden', !config);
    el('securitySubtitle').textContent = config
      ? 'Inserisci il PIN per accedere ai tuoi certificati.'
      : 'Crea il PIN che proteggerà i documenti su questo dispositivo.';
  }

  function getPinConfig() {
    try { return JSON.parse(localStorage.getItem(PIN_STORAGE_KEY)); }
    catch { return null; }
  }

  async function handleSetupPin(event) {
    event.preventDefault();
    const pin = el('setupPin').value.trim();
    const confirm = el('setupPinConfirm').value.trim();
    if (!/^\d{4,8}$/.test(pin)) return showSecurityMessage('Il PIN deve contenere da 4 a 8 cifre.');
    if (pin !== confirm) return showSecurityMessage('I PIN non coincidono.');

    setSecurityBusy(true);
    try {
      const { key, saltBase64, verifier } = await CryptoVault.createPinVerifier(pin);
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({ saltBase64, verifier }));
      state.key = key;
      await enterApp();
      el('setupPinForm').reset();
    } catch (error) {
      showSecurityMessage(error.message || 'Impossibile attivare l’archivio.');
    } finally {
      setSecurityBusy(false);
    }
  }

  async function handleUnlock(event) {
    event.preventDefault();
    const pin = el('unlockPin').value.trim();
    const config = getPinConfig();
    if (!config) return showSecurityMode();
    setSecurityBusy(true);
    try {
      state.key = await CryptoVault.unlockWithPin(pin, config.saltBase64, config.verifier);
      await enterApp();
      el('unlockForm').reset();
      showSecurityMessage('');
    } catch {
      showSecurityMessage('PIN errato. Riprova.');
    } finally {
      setSecurityBusy(false);
    }
  }

  function setSecurityBusy(isBusy) {
    document.querySelectorAll('#securityScreen button, #securityScreen input').forEach(node => node.disabled = isBusy);
  }

  function showSecurityMessage(message) {
    el('securityMessage').textContent = message;
  }

  async function enterApp() {
    el('securityScreen').classList.add('hidden');
    el('appShell').classList.remove('hidden');
    await loadRecords();
  }

  function lockApp() {
    state.key = null;
    state.records = [];
    state.selectedRecordId = null;
    el('appShell').classList.add('hidden');
    el('securityScreen').classList.remove('hidden');
    showSecurityMode();
    el('unlockPin').focus();
  }

  async function resetApplication() {
    const confirmed = confirm('Questa operazione elimina definitivamente tutti i certificati presenti su questo dispositivo. Continuare?');
    if (!confirmed) return;
    try {
      await SecureDB.destroy();
      localStorage.removeItem(PIN_STORAGE_KEY);
      location.reload();
    } catch (error) {
      showSecurityMessage(error.message || 'Impossibile azzerare l’archivio.');
    }
  }

  async function loadRecords() {
    const encrypted = await SecureDB.getAll();
    const decoded = [];
    for (const item of encrypted) {
      try {
        const record = await CryptoVault.decryptJson(state.key, item.payload);
        decoded.push(record);
      } catch (error) {
        console.warn('Record non leggibile:', item.id, error);
      }
    }
    state.records = decoded.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    rebuildYearFilter();
    renderRecords();
    renderExpiryBanner();
  }

  function rebuildYearFilter() {
    const select = el('yearFilter');
    const current = select.value;
    const years = [...new Set(state.records.map(r => (r.startDate || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    select.innerHTML = '<option value="all">Tutti gli anni</option>' + years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
    if (years.includes(current)) select.value = current;
  }

  function renderRecords() {
    const query = el('searchInput').value.trim().toLowerCase();
    const year = el('yearFilter').value;
    const filtered = state.records.filter(record => {
      const matchesYear = year === 'all' || (record.startDate || '').startsWith(year);
      const haystack = [record.puc, record.doctor, record.startDate, record.endDate, record.certificateType].join(' ').toLowerCase();
      return matchesYear && (!query || haystack.includes(query));
    });

    el('emptyState').classList.toggle('hidden', state.records.length > 0);
    el('certificateList').classList.toggle('hidden', state.records.length === 0);
    el('statCertificates').textContent = filtered.length;
    el('statDays').textContent = filtered.reduce((sum, r) => sum + calculateDays(r.startDate, r.endDate), 0);
    el('statYear').textContent = year === 'all' ? 'Tutti' : year;

    el('certificateList').innerHTML = filtered.map(record => {
      const days = calculateDays(record.startDate, record.endDate);
      const title = record.puc ? `PUC ${escapeHtml(record.puc)}` : 'Certificato senza PUC';
      return `
        <article class="certificate-card" data-id="${escapeHtml(record.id)}" tabindex="0" role="button" aria-label="Apri ${title}">
          <div>
            <span class="badge">${escapeHtml(record.certificateType || 'inizio')}</span>
            <h3>${title}</h3>
            <div class="card-meta">
              <span>📅 ${formatDate(record.startDate)} – ${formatDate(record.endDate)}</span>
              <span>👨‍⚕️ ${escapeHtml(record.doctor || 'Medico non indicato')}</span>
              ${record.attachment ? '<span>📎 Allegato</span>' : ''}
            </div>
          </div>
          <div class="card-side">
            <span class="days-pill">${days}</span>
            <small>${days === 1 ? 'giorno' : 'giorni'}</small>
          </div>
        </article>`;
    }).join('');
  }

  function renderExpiryBanner() {
    const today = startOfDay(new Date());
    const upcoming = state.records
      .map(r => ({ ...r, remaining: dayDiff(today, parseLocalDate(r.endDate)) }))
      .filter(r => r.remaining >= 0 && r.remaining <= 1)
      .sort((a, b) => a.remaining - b.remaining);

    const banner = el('expiryBanner');
    if (!upcoming.length) {
      banner.classList.add('hidden');
      return;
    }
    const item = upcoming[0];
    banner.innerHTML = item.remaining === 0
      ? `<strong>La prognosi termina oggi.</strong> Certificato ${item.puc ? `PUC ${escapeHtml(item.puc)}` : 'senza PUC'}.`
      : `<strong>La prognosi termina domani.</strong> Certificato ${item.puc ? `PUC ${escapeHtml(item.puc)}` : 'senza PUC'}.`;
    banner.classList.remove('hidden');
  }

  function openCertificateDialog(record = null) {
    el('certificateForm').reset();
    el('recordId').value = record?.id || '';
    el('dialogTitle').textContent = record ? 'Modifica certificato' : 'Aggiungi certificato';
    state.attachment = record?.attachment ? structuredClone(record.attachment) : null;
    el('puc').value = record?.puc || '';
    el('visitDate').value = record?.visitDate || '';
    el('startDate').value = record?.startDate || '';
    el('endDate').value = record?.endDate || '';
    el('certificateType').value = record?.certificateType || 'inizio';
    el('visitType').value = record?.visitType || 'ambulatoriale';
    el('doctor').value = record?.doctor || '';
    el('diagnosis').value = record?.diagnosis || '';
    el('notes').value = record?.notes || '';
    el('formMessage').textContent = '';
    updateFileInfo();
    el('certificateDialog').showModal();
  }

  function closeCertificateDialog() {
    if (el('certificateDialog').open) el('certificateDialog').close();
    state.attachment = null;
    setOcrProgress(false, 0, '');
  }

  async function handleDocumentSelection(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const maxSize = 12 * 1024 * 1024;
    if (file.size > maxSize) {
      el('formMessage').textContent = 'Il file supera 12 MB. Riduci la foto o il PDF.';
      event.target.value = '';
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    state.attachment = { name: file.name, type: file.type || 'application/octet-stream', size: file.size, dataUrl };
    updateFileInfo();
  }

  function updateFileInfo() {
    const info = el('fileInfo');
    const hasFile = Boolean(state.attachment);
    info.classList.toggle('hidden', !hasFile);
    el('removeFileBtn').classList.toggle('hidden', !hasFile);
    el('analyzeBtn').disabled = !hasFile;
    if (hasFile) {
      info.textContent = `${state.attachment.name} · ${formatBytes(state.attachment.size)}`;
    } else {
      info.textContent = '';
      el('documentInput').value = '';
    }
  }

  function removeAttachment() {
    state.attachment = null;
    updateFileInfo();
  }

  async function analyzeDocument() {
    if (!state.attachment) return;
    el('formMessage').textContent = '';
    el('analyzeBtn').disabled = true;
    setOcrProgress(true, 4, 'Preparazione documento…');
    try {
      let text = '';
      if (state.attachment.type === 'application/pdf') {
        text = await extractTextFromPdf(state.attachment.dataUrl);
        if (text.replace(/\s/g, '').length < 80) {
          setOcrProgress(true, 18, 'PDF scansionato: avvio riconoscimento immagine…');
          const imageDataUrl = await renderFirstPdfPage(state.attachment.dataUrl);
          text = await runOcr(imageDataUrl);
        }
      } else if (state.attachment.type.startsWith('image/')) {
        text = await runOcr(state.attachment.dataUrl);
      } else {
        throw new Error('Formato non supportato per la lettura automatica.');
      }

      const parsed = parseCertificateText(text);
      applyParsedFields(parsed);
      setOcrProgress(true, 100, 'Analisi completata. Verifica i dati rilevati.');
      setTimeout(() => setOcrProgress(false, 0, ''), 1800);
    } catch (error) {
      console.error(error);
      setOcrProgress(false, 0, '');
      el('formMessage').textContent = error.message || 'Lettura automatica non riuscita. Inserisci i dati manualmente.';
    } finally {
      el('analyzeBtn').disabled = !state.attachment;
    }
  }

  async function runOcr(source) {
    if (!window.Tesseract) throw new Error('Modulo OCR non disponibile. Controlla la connessione e riprova.');
    const result = await window.Tesseract.recognize(source, 'ita', {
      logger: progress => {
        if (progress.status === 'recognizing text') {
          const value = Math.round(20 + progress.progress * 75);
          setOcrProgress(true, value, `Lettura testo… ${Math.round(progress.progress * 100)}%`);
        }
      }
    });
    return result.data.text || '';
  }

  async function extractTextFromPdf(dataUrl) {
    if (!window.pdfjsLib) throw new Error('Modulo PDF non disponibile. Controlla la connessione e riprova.');
    const bytes = dataUrlToUint8Array(dataUrl);
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    let text = '';
    const pages = Math.min(pdf.numPages, 3);
    for (let i = 1; i <= pages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += '\n' + content.items.map(item => item.str).join(' ');
      setOcrProgress(true, 8 + Math.round((i / pages) * 30), `Lettura PDF: pagina ${i} di ${pages}`);
    }
    return text;
  }

  async function renderFirstPdfPage(dataUrl) {
    const bytes = dataUrlToUint8Array(dataUrl);
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas.toDataURL('image/jpeg', .92);
  }

  function parseCertificateText(rawText) {
    const text = rawText.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n');
    const compact = text.replace(/\n/g, ' ');
    const dates = [...compact.matchAll(/\b(\d{2}[\/.-]\d{2}[\/.-]\d{4})\b/g)].map(m => normalizeDate(m[1]));

    const pucMatch = compact.match(/(?:PUC|protocollo unico[^\d]{0,40})(\d{7,20})/i)
      || compact.match(/\b(\d{9,20})\b/);
    const doctorMatch = text.match(/DATI DEL MEDICO[\s\S]{0,220}?(?:Cognome\s*e\s*nome)?\s*([A-ZÀ-Ü][A-ZÀ-Ü' ]{5,60})/i);
    const diagnosisMatch = text.match(/(?:Note di diagnosi|DATI DIAGNOSI)[\s\S]{0,120}?\n?([^\n]{5,180})/i);

    let startDate = '';
    let endDate = '';
    const prognosisMatch = compact.match(/ammalato\s+dal\s+(\d{2}[\/.-]\d{2}[\/.-]\d{4})[\s\S]{0,100}?(?:fino\s+al|tutto\s+il)\s+(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i);
    if (prognosisMatch) {
      startDate = normalizeDate(prognosisMatch[1]);
      endDate = normalizeDate(prognosisMatch[2]);
    } else if (dates.length >= 3) {
      startDate = dates[1];
      endDate = dates[2];
    }

    const visitDateMatch = compact.match(/Data\s*Visita\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i);
    const certificateType = /continuazione\s*[xX☒■]/i.test(compact) ? 'continuazione'
      : /ricaduta\s*[xX☒■]/i.test(compact) ? 'ricaduta' : 'inizio';
    const visitType = /domiciliare\s*[xX☒■]/i.test(compact) ? 'domiciliare'
      : /pronto\s*soccorso\s*[xX☒■]/i.test(compact) ? 'pronto-soccorso'
      : 'ambulatoriale';

    return {
      puc: pucMatch?.[1] || '',
      visitDate: visitDateMatch ? normalizeDate(visitDateMatch[1]) : (dates[0] || ''),
      startDate,
      endDate,
      certificateType,
      visitType,
      doctor: cleanExtractedName(doctorMatch?.[1] || ''),
      diagnosis: cleanDiagnosis(diagnosisMatch?.[1] || '')
    };
  }

  function applyParsedFields(parsed) {
    for (const [key, value] of Object.entries(parsed)) {
      const field = el(key);
      if (field && value) field.value = value;
    }
  }

  async function saveCertificate(event) {
    event.preventDefault();
    const recordId = el('recordId').value;
    const record = {
      id: recordId || crypto.randomUUID(),
      puc: el('puc').value.trim(),
      visitDate: el('visitDate').value,
      startDate: el('startDate').value,
      endDate: el('endDate').value,
      certificateType: el('certificateType').value,
      visitType: el('visitType').value,
      doctor: el('doctor').value.trim(),
      diagnosis: el('diagnosis').value.trim(),
      notes: el('notes').value.trim(),
      attachment: state.attachment,
      createdAt: recordId ? state.records.find(r => r.id === recordId)?.createdAt || new Date().toISOString() : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!record.startDate || !record.endDate) return showFormMessage('Inserisci le date di inizio e fine prognosi.');
    if (record.endDate < record.startDate) return showFormMessage('La data finale non può precedere quella iniziale.');
    if (record.puc) {
      const duplicate = state.records.find(r => r.puc === record.puc && r.id !== record.id);
      if (duplicate) return showFormMessage('Esiste già un certificato con questo numero PUC.');
    }

    try {
      const payload = await CryptoVault.encryptJson(state.key, record);
      await SecureDB.put({ id: record.id, payload, updatedAt: record.updatedAt });
      closeCertificateDialog();
      await loadRecords();
    } catch (error) {
      showFormMessage(error.message || 'Salvataggio non riuscito.');
    }
  }

  function showFormMessage(message) {
    el('formMessage').textContent = message;
  }

  function handleListClick(event) {
    const card = event.target.closest('.certificate-card');
    if (!card) return;
    showDetails(card.dataset.id);
  }

  function showDetails(id) {
    const record = state.records.find(r => r.id === id);
    if (!record) return;
    state.selectedRecordId = id;
    el('detailsTitle').textContent = record.puc ? `PUC ${record.puc}` : 'Certificato';
    el('detailsContent').innerHTML = `
      <div class="details-grid">
        ${detailBox('Data visita', formatDate(record.visitDate))}
        ${detailBox('Periodo', `${formatDate(record.startDate)} – ${formatDate(record.endDate)}`)}
        ${detailBox('Durata', `${calculateDays(record.startDate, record.endDate)} giorni`)}
        ${detailBox('Tipo', capitalize(record.certificateType))}
        ${detailBox('Visita', capitalize((record.visitType || '').replace('-', ' ')))}
        ${detailBox('Medico', record.doctor || 'Non indicato')}
        <div class="detail-box sensitive-box">
          <span>Diagnosi / note cliniche — tocca per mostrare</span>
          <strong id="sensitiveDiagnosis" class="sensitive-content">${escapeHtml(record.diagnosis || 'Non inserita')}</strong>
        </div>
        <div class="detail-box sensitive-box">
          <span>Note personali</span>
          <strong>${escapeHtml(record.notes || 'Nessuna nota')}</strong>
        </div>
      </div>`;
    el('sensitiveDiagnosis').addEventListener('click', event => event.currentTarget.classList.toggle('revealed'));
    el('viewAttachmentBtn').classList.toggle('hidden', !record.attachment);
    el('detailsDialog').showModal();
  }

  function detailBox(label, value) {
    return `<div class="detail-box"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'Non indicato')}</strong></div>`;
  }

  function editSelectedRecord() {
    const record = state.records.find(r => r.id === state.selectedRecordId);
    if (!record) return;
    el('detailsDialog').close();
    openCertificateDialog(record);
  }

  async function deleteSelectedRecord() {
    const record = state.records.find(r => r.id === state.selectedRecordId);
    if (!record) return;
    const confirmed = confirm(`Eliminare definitivamente il certificato ${record.puc ? `PUC ${record.puc}` : ''}?`);
    if (!confirmed) return;
    await SecureDB.remove(record.id);
    el('detailsDialog').close();
    await loadRecords();
  }

  function openSelectedAttachment() {
    const record = state.records.find(r => r.id === state.selectedRecordId);
    if (!record?.attachment?.dataUrl) return;
    const blob = dataUrlToBlob(record.attachment.dataUrl);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function exportEncryptedBackup() {
    const records = await SecureDB.getAll();
    const config = getPinConfig();
    const backup = {
      app: 'Archivio Malattia',
      version: 1,
      exportedAt: new Date().toISOString(),
      pinConfig: config,
      records
    };
    downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `archivio-malattia-backup-${todayFile()}.json`);
  }

  async function importEncryptedBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const confirmed = confirm('Il ripristino sostituirà l’archivio presente su questo dispositivo. Continuare?');
    if (!confirmed) return;
    try {
      const backup = JSON.parse(await file.text());
      if (backup?.app !== 'Archivio Malattia' || !Array.isArray(backup.records) || !backup.pinConfig) throw new Error('Backup non valido.');
      await SecureDB.clear();
      for (const record of backup.records) await SecureDB.put(record);
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(backup.pinConfig));
      alert('Backup ripristinato. L’app verrà bloccata: usa il PIN del backup.');
      location.reload();
    } catch (error) {
      alert(error.message || 'Ripristino non riuscito.');
    }
  }

  function exportCsv() {
    const headers = ['PUC', 'Data visita', 'Dal', 'Al', 'Giorni', 'Tipo', 'Visita', 'Medico', 'Note'];
    const rows = state.records.map(r => [r.puc, r.visitDate, r.startDate, r.endDate, calculateDays(r.startDate, r.endDate), r.certificateType, r.visitType, r.doctor, r.notes]);
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(';')).join('\n');
    downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `riepilogo-malattia-${todayFile()}.csv`);
  }

  function initInstallPrompt() {
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      state.installPrompt = event;
      el('installBtn').classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
      state.installPrompt = null;
      el('installBtn').classList.add('hidden');
    });
  }

  async function installApp() {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    el('installBtn').classList.add('hidden');
  }

  function initServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
    }
  }

  function setOcrProgress(visible, value, text) {
    el('ocrProgress').classList.toggle('hidden', !visible);
    el('ocrProgressBar').value = value;
    el('ocrProgressText').textContent = text;
  }

  function calculateDays(start, end) {
    if (!start || !end) return 0;
    return Math.max(0, dayDiff(parseLocalDate(start), parseLocalDate(end)) + 1);
  }

  function parseLocalDate(value) {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function dayDiff(a, b) {
    if (!a || !b) return 0;
    return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  }

  function formatDate(value) {
    const date = parseLocalDate(value);
    return date ? new Intl.DateTimeFormat('it-IT').format(date) : 'Non indicata';
  }

  function normalizeDate(value) {
    const [d, m, y] = value.replace(/[.-]/g, '/').split('/');
    return `${y}-${m}-${d}`;
  }

  function cleanExtractedName(value) {
    return value.replace(/CODICE|REGIONE|ASL|AO|DATI/gi, '').replace(/\s{2,}/g, ' ').trim().slice(0, 80);
  }

  function cleanDiagnosis(value) {
    return value.replace(/Patologia grave.*$/i, '').replace(/\s{2,}/g, ' ').trim().slice(0, 300);
  }

  function capitalize(value) {
    if (!value) return 'Non indicato';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function dataUrlToUint8Array(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function dataUrlToBlob(dataUrl) {
    const [meta, base64] = dataUrl.split(',');
    const mime = meta.match(/data:(.*?);base64/)?.[1] || 'application/octet-stream';
    const bytes = dataUrlToUint8Array(dataUrl);
    return new Blob([bytes], { type: mime });
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    const text = String(value ?? '').replace(/"/g, '""');
    return `"${text}"`;
  }

  function todayFile() {
    return new Date().toISOString().slice(0, 10);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
