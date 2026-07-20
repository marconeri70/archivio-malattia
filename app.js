'use strict';

const App = (() => {
  const el = id => document.getElementById(id);
  const PIN_STORAGE_KEY = 'am_pin_config_v1';
  const SETTINGS_KEY = 'am_settings_v2';
  const FAILURE_KEY = 'am_unlock_failures_v2';
  const INPS_URL = 'https://www.inps.it/it/it/dettaglio-scheda.schede-servizio-strumento.schede-servizi.consultazione-degli-attestati-di-malattia-telematici.html';
  const FIELD_LABELS = {
    puc: 'numero PUC', visitDate: 'data visita', startDate: 'data iniziale', endDate: 'data finale',
    doctor: 'medico', diagnosis: 'diagnosi', certificateType: 'tipo certificato', visitType: 'tipo visita'
  };

  const defaultSettings = {
    autoLockMinutes: 5,
    lockOnHidden: true,
    backupReminderDays: 30,
    lastBackupAt: null
  };

  const state = {
    key: null,
    records: [],
    filteredRecords: [],
    selectedRecordId: null,
    attachments: [],
    primaryAttachmentId: null,
    installPrompt: null,
    ocrWorker: null,
    settings: { ...defaultSettings },
    inactivityTimer: null,
    lockoutTimer: null,
    fileSelectionActive: false,
    editor: null
  };

  function init() {
    state.settings = loadSettings();
    bindEvents();
    setupPdfJs();
    initServiceWorker();
    initInstallPrompt();
    applySettingsToUi();
    showSecurityMode();
  }

  function bindEvents() {
    el('setupPinForm').addEventListener('submit', handleSetupPin);
    el('unlockForm').addEventListener('submit', handleUnlock);
    el('resetAppBtn').addEventListener('click', resetApplication);
    el('lockBtn').addEventListener('click', () => lockApp('Archivio bloccato.'));
    el('installBtn').addEventListener('click', installApp);

    document.querySelectorAll('.nav-btn').forEach(button => button.addEventListener('click', () => switchPanel(button.dataset.panel)));
    el('addCertificateBtn').addEventListener('click', () => openCertificateDialog());
    el('emptyAddBtn').addEventListener('click', () => openCertificateDialog());
    el('closeDialogBtn').addEventListener('click', closeCertificateDialog);
    el('cancelBtn').addEventListener('click', closeCertificateDialog);
    el('certificateForm').addEventListener('submit', saveCertificate);
    el('documentInput').addEventListener('click', () => { state.fileSelectionActive = true; });
    el('documentInput').addEventListener('change', handleDocumentSelection);
    el('attachmentsList').addEventListener('click', handleAttachmentAction);
    el('analyzeBtn').addEventListener('click', analyzeDocument);
    el('editImageBtn').addEventListener('click', () => openImageEditor(state.primaryAttachmentId));
    ['startDate', 'endDate', 'visitDate', 'certificateType', 'episodeSelect'].forEach(id => el(id).addEventListener('change', updateFormWarnings));
    el('certificateType').addEventListener('change', handleCertificateTypeChange);

    el('searchInput').addEventListener('input', renderRecords);
    el('yearFilter').addEventListener('change', renderRecords);
    el('statusFilter').addEventListener('change', renderRecords);
    el('statsYearFilter').addEventListener('change', renderStatistics);
    el('certificateList').addEventListener('click', handleListClick);

    el('closeDetailsBtn').addEventListener('click', () => el('detailsDialog').close());
    el('detailsContent').addEventListener('click', event => {
      const sensitive = event.target.closest('.sensitive-content');
      if (sensitive) sensitive.classList.toggle('revealed');
    });
    el('detailAttachments').addEventListener('click', event => {
      const button = event.target.closest('[data-attachment-id]');
      if (button) openAttachment(state.selectedRecordId, button.dataset.attachmentId);
    });
    el('editRecordBtn').addEventListener('click', editSelectedRecord);
    el('deleteRecordBtn').addEventListener('click', deleteSelectedRecord);
    el('exportRecordPdfBtn').addEventListener('click', exportSelectedRecordPdf);
    el('printRecordBtn').addEventListener('click', printSelectedRecord);
    el('shareRecordBtn').addEventListener('click', shareSelectedRecord);
    el('calendarRecordBtn').addEventListener('click', exportSelectedCalendarReminder);

    el('exportJsonBtn').addEventListener('click', exportEncryptedBackup);
    el('importJsonBtn').addEventListener('click', () => el('importBackupInput').click());
    el('importBackupInput').addEventListener('change', importEncryptedBackup);
    el('exportCsvBtn').addEventListener('click', exportCsv);
    el('exportPdfBtn').addEventListener('click', () => el('exportPdfDialog').showModal());
    el('exportPdfForm').addEventListener('submit', handlePdfExport);
    el('closeExportPdfBtn').addEventListener('click', () => el('exportPdfDialog').close());
    el('openInpsGuideBtn').addEventListener('click', () => el('inpsDialog').showModal());
    el('closeInpsBtn').addEventListener('click', () => el('inpsDialog').close());
    el('openInpsBtn').addEventListener('click', () => window.open(INPS_URL, '_blank', 'noopener'));
    el('inpsImportBtn').addEventListener('click', () => {
      el('inpsDialog').close();
      switchPanel('archivePanel');
      openCertificateDialog();
      setTimeout(() => el('documentInput').click(), 250);
    });

    el('settingsForm').addEventListener('submit', saveSettingsFromUi);
    el('persistStorageBtn').addEventListener('click', requestPersistentStorage);
    el('openChangePinBtn').addEventListener('click', () => el('changePinDialog').showModal());
    el('closeChangePinBtn').addEventListener('click', () => el('changePinDialog').close());
    el('changePinForm').addEventListener('submit', changePin);

    el('closeImageEditorBtn').addEventListener('click', closeImageEditor);
    el('cancelImageEditBtn').addEventListener('click', closeImageEditor);
    el('rotateLeftBtn').addEventListener('click', () => rotateEditor(-90));
    el('rotateRightBtn').addEventListener('click', () => rotateEditor(90));
    el('autoPerspectiveBtn').addEventListener('click', autoCorrectPerspective);
    el('applyImageEditBtn').addEventListener('click', applyImageEdits);
    ['cropTop', 'cropBottom', 'cropLeft', 'cropRight'].forEach(id => el(id).addEventListener('input', updateCropOverlay));

    ['pointerdown', 'keydown', 'touchstart'].forEach(type => document.addEventListener(type, resetInactivityTimer, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', () => setTimeout(() => { state.fileSelectionActive = false; }, 1200));
  }

  function setupPdfJs() {
    if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
  }

  function loadSettings() {
    try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { ...defaultSettings }; }
  }

  function persistSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function applySettingsToUi() {
    el('autoLockMinutes').value = String(state.settings.autoLockMinutes);
    el('lockOnHidden').checked = Boolean(state.settings.lockOnHidden);
    el('backupReminderDays').value = String(state.settings.backupReminderDays);
  }

  function saveSettingsFromUi(event) {
    event.preventDefault();
    state.settings.autoLockMinutes = Number(el('autoLockMinutes').value);
    state.settings.lockOnHidden = el('lockOnHidden').checked;
    state.settings.backupReminderDays = Number(el('backupReminderDays').value);
    persistSettings();
    resetInactivityTimer();
    renderGlobalBanner();
    alert('Impostazioni salvate.');
  }

  function getPinConfig() {
    try { return JSON.parse(localStorage.getItem(PIN_STORAGE_KEY)); }
    catch { return null; }
  }

  function showSecurityMode() {
    const config = getPinConfig();
    el('setupPinForm').classList.toggle('hidden', Boolean(config));
    el('unlockForm').classList.toggle('hidden', !config);
    el('securitySubtitle').textContent = config
      ? 'Inserisci il PIN per accedere ai certificati cifrati.'
      : 'Crea un PIN che proteggerà i documenti su questo dispositivo.';
    updateLockoutUi();
  }

  async function handleSetupPin(event) {
    event.preventDefault();
    const pin = el('setupPin').value.trim();
    const confirmPin = el('setupPinConfirm').value.trim();
    if (!/^\d{6,10}$/.test(pin)) return showSecurityMessage('Il PIN deve contenere da 6 a 10 cifre.');
    if (pin !== confirmPin) return showSecurityMessage('I PIN non coincidono.');
    setSecurityBusy(true);
    try {
      const { key, saltBase64, iterations, verifier } = await CryptoVault.createPinVerifier(pin);
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({ saltBase64, iterations, verifier }));
      state.key = key;
      clearUnlockFailures();
      await enterApp();
      el('setupPinForm').reset();
    } catch (error) {
      showSecurityMessage(error.message || 'Impossibile attivare l’archivio.');
    } finally { setSecurityBusy(false); }
  }

  function readUnlockFailures() {
    try { return { attempts: 0, lockedUntil: 0, ...JSON.parse(localStorage.getItem(FAILURE_KEY) || '{}') }; }
    catch { return { attempts: 0, lockedUntil: 0 }; }
  }

  function clearUnlockFailures() {
    localStorage.removeItem(FAILURE_KEY);
    updateLockoutUi();
  }

  function registerUnlockFailure() {
    const data = readUnlockFailures();
    data.attempts += 1;
    if (data.attempts >= 5) {
      const stage = Math.min(4, Math.floor((data.attempts - 5) / 2));
      const seconds = [30, 60, 180, 300, 600][stage];
      data.lockedUntil = Date.now() + seconds * 1000;
    }
    localStorage.setItem(FAILURE_KEY, JSON.stringify(data));
    updateLockoutUi();
  }

  function updateLockoutUi() {
    clearInterval(state.lockoutTimer);
    const tick = () => {
      const data = readUnlockFailures();
      const remaining = Math.ceil((data.lockedUntil - Date.now()) / 1000);
      const locked = remaining > 0;
      el('unlockBtn').disabled = locked;
      el('unlockPin').disabled = locked;
      el('lockoutCountdown').classList.toggle('hidden', !locked);
      el('lockoutCountdown').textContent = locked ? `Troppi tentativi. Riprova tra ${remaining} secondi.` : '';
      if (!locked) clearInterval(state.lockoutTimer);
    };
    tick();
    state.lockoutTimer = setInterval(tick, 1000);
  }

  async function handleUnlock(event) {
    event.preventDefault();
    const failure = readUnlockFailures();
    if (failure.lockedUntil > Date.now()) return updateLockoutUi();
    const pin = el('unlockPin').value.trim();
    const config = getPinConfig();
    if (!config) return showSecurityMode();
    setSecurityBusy(true);
    try {
      state.key = await CryptoVault.unlockWithPin(pin, config.saltBase64, config.verifier, config.iterations);
      clearUnlockFailures();
      await enterApp();
      el('unlockForm').reset();
      showSecurityMessage('');
    } catch {
      state.key = null;
      registerUnlockFailure();
      showSecurityMessage('PIN errato. Riprova.');
    } finally { setSecurityBusy(false); }
  }

  function setSecurityBusy(isBusy) {
    document.querySelectorAll('#securityScreen button, #securityScreen input').forEach(node => {
      if (!readUnlockFailures().lockedUntil || readUnlockFailures().lockedUntil <= Date.now()) node.disabled = isBusy;
    });
  }

  function showSecurityMessage(message) { el('securityMessage').textContent = message; }

  async function enterApp() {
    el('securityScreen').classList.add('hidden');
    el('appShell').classList.remove('hidden');
    await loadRecords();
    resetInactivityTimer();
    await updateStorageEstimate();
    await importSharedFilesIfPresent();
    const params = new URLSearchParams(location.search);
    if (params.get('new') === '1' && !el('certificateDialog').open) {
      switchPanel('archivePanel');
      openCertificateDialog();
      history.replaceState({}, '', location.pathname);
    }
  }

  async function lockApp(message = '') {
    state.key = null;
    state.records = [];
    state.filteredRecords = [];
    state.selectedRecordId = null;
    state.attachments = [];
    clearTimeout(state.inactivityTimer);
    closeAllDialogs();
    if (state.ocrWorker) {
      try { await state.ocrWorker.terminate(); } catch {}
      state.ocrWorker = null;
    }
    el('appShell').classList.add('hidden');
    el('securityScreen').classList.remove('hidden');
    showSecurityMode();
    showSecurityMessage(message);
    setTimeout(() => el('unlockPin')?.focus(), 80);
  }

  function closeAllDialogs() {
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  }

  function resetInactivityTimer() {
    if (!state.key) return;
    clearTimeout(state.inactivityTimer);
    const minutes = Number(state.settings.autoLockMinutes || 0);
    if (minutes > 0) state.inactivityTimer = setTimeout(() => lockApp('Archivio bloccato per inattività.'), minutes * 60000);
  }

  function handleVisibilityChange() {
    if (!document.hidden || !state.key || !state.settings.lockOnHidden || state.fileSelectionActive) return;
    lockApp('Archivio bloccato perché l’app è passata in secondo piano.');
  }

  async function resetApplication() {
    const confirmed = confirm('Questa operazione elimina definitivamente certificati, allegati e impostazioni presenti su questo dispositivo. Continuare?');
    if (!confirmed) return;
    try {
      await SecureDB.destroy();
      [PIN_STORAGE_KEY, SETTINGS_KEY, FAILURE_KEY].forEach(key => localStorage.removeItem(key));
      location.reload();
    } catch (error) { showSecurityMessage(error.message || 'Impossibile azzerare l’archivio.'); }
  }

  function normalizeRecord(record) {
    const attachments = Array.isArray(record.attachments)
      ? record.attachments
      : record.attachment ? [{ ...record.attachment, id: uid(), primary: true }] : [];
    attachments.forEach((attachment, index) => {
      attachment.id ||= uid();
      if (attachment.primary == null) attachment.primary = index === 0;
    });
    return {
      category: '', companyNotifiedAt: '', companyMethod: '', companyContact: '',
      fiscalVisitStatus: 'nessuna', fiscalVisitDate: '', manualWorkDays: null,
      ...record,
      episodeId: record.episodeId || record.id,
      attachments
    };
  }

  async function loadRecords() {
    const encrypted = await SecureDB.getAll();
    const decoded = [];
    for (const item of encrypted) {
      try {
        const record = await CryptoVault.decryptJson(state.key, item.payload);
        decoded.push(normalizeRecord(record));
      } catch (error) { console.warn('Record non leggibile:', item.id, error); }
    }
    state.records = decoded.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    rebuildFilters();
    renderRecords();
    renderExpiryBanner();
    renderGlobalBanner();
    renderStatistics();
  }

  function rebuildFilters() {
    const years = [...new Set(state.records.map(r => (r.startDate || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    for (const selectId of ['yearFilter', 'statsYearFilter']) {
      const select = el(selectId);
      const current = select.value;
      const allLabel = selectId === 'statsYearFilter' ? 'Tutti gli anni' : 'Tutti gli anni';
      select.innerHTML = `<option value="all">${allLabel}</option>` + years.map(year => `<option value="${year}">${year}</option>`).join('');
      if (years.includes(current)) select.value = current;
      else if (selectId === 'statsYearFilter' && years.length) select.value = years[0];
    }
  }

  function switchPanel(panelId) {
    document.querySelectorAll('.app-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== panelId));
    document.querySelectorAll('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.panel === panelId));
    if (panelId === 'statisticsPanel') renderStatistics();
    if (panelId === 'toolsPanel') updateStorageEstimate();
  }

  function getFilteredRecords() {
    const query = el('searchInput').value.trim().toLowerCase();
    const year = el('yearFilter').value;
    const status = el('statusFilter').value;
    return state.records.filter(record => {
      const matchesYear = year === 'all' || (record.startDate || '').startsWith(year);
      const matchesStatus = status === 'all' || getRecordStatus(record) === status;
      const haystack = [record.puc, record.doctor, record.startDate, record.endDate, record.certificateType, record.category].join(' ').toLowerCase();
      return matchesYear && matchesStatus && (!query || haystack.includes(query));
    });
  }

  function renderRecords() {
    const filtered = getFilteredRecords();
    state.filteredRecords = filtered;
    const hasAny = state.records.length > 0;
    el('emptyState').classList.toggle('hidden', hasAny);
    el('certificateList').classList.toggle('hidden', !hasAny);
    renderSummaryStats(filtered);

    if (hasAny && !filtered.length) {
      el('certificateList').innerHTML = '<section class="empty-state"><h2>Nessun risultato</h2><p>Modifica la ricerca o i filtri selezionati.</p></section>';
      return;
    }

    const groups = getEpisodeGroups(filtered);
    el('certificateList').innerHTML = groups.map(group => {
      const warnings = getEpisodeWarnings(group.records);
      const category = group.categories.join(', ') || 'Categoria non indicata';
      return `<article class="episode-card">
        <header class="episode-header">
          <div>
            <span class="badge">Episodio · ${group.records.length} ${group.records.length === 1 ? 'certificato' : 'certificati'}</span>
            <h3>${formatDate(group.startDate)} – ${formatDate(group.endDate)}</h3>
            <div class="episode-summary"><span>🏷️ ${escapeHtml(category)}</span><span>📅 ${group.days} giorni</span><span>💼 ${group.workDays} lavorativi</span>${warnings.length ? `<span class="warning-chip">⚠ ${warnings.length} controllo</span>` : ''}</div>
          </div>
          <div class="episode-totals"><strong>${group.days}</strong><small>giorni complessivi</small></div>
        </header>
        <div>${group.records.map(record => renderRecordRow(record)).join('')}</div>
      </article>`;
    }).join('');
  }

  function renderRecordRow(record) {
    const days = calculateDays(record.startDate, record.endDate);
    const title = record.puc ? `PUC ${escapeHtml(record.puc)}` : 'Certificato senza PUC';
    const status = getRecordStatus(record);
    const attachments = record.attachments?.length || 0;
    return `<button class="certificate-row" data-record-id="${escapeHtml(record.id)}" type="button">
      <div><div class="button-row" style="margin:0 0 6px"><span class="badge">${escapeHtml(record.certificateType || 'inizio')}</span><span class="status-pill ${status}">${status.replace('-', ' ')}</span></div>
        <h4>${title}</h4>
        <div class="row-meta"><span>📅 ${formatDate(record.startDate)} – ${formatDate(record.endDate)}</span><span>👨‍⚕️ ${escapeHtml(record.doctor || 'Medico non indicato')}</span>${record.category ? `<span>🏷️ ${escapeHtml(record.category)}</span>` : ''}${attachments ? `<span>📎 ${attachments}</span>` : ''}</div>
      </div>
      <div class="row-side"><strong>${days}</strong><small>${days === 1 ? ' giorno' : ' giorni'}</small></div>
    </button>`;
  }

  function renderSummaryStats(records) {
    el('statCertificates').textContent = records.length;
    el('statEpisodes').textContent = new Set(records.map(r => r.episodeId)).size;
    el('statDays').textContent = getUniqueDateSet(records).size;
    el('statWorkDays').textContent = records.reduce((sum, r) => sum + (Number.isFinite(Number(r.manualWorkDays)) && r.manualWorkDays !== '' && r.manualWorkDays != null ? Number(r.manualWorkDays) : countWeekdays(r.startDate, r.endDate)), 0);
  }

  function getEpisodeGroups(records) {
    const map = new Map();
    for (const record of records) {
      const key = record.episodeId || record.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(record);
    }
    return [...map.entries()].map(([id, episodeRecords]) => {
      episodeRecords.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
      const dates = getUniqueDateSet(episodeRecords);
      return {
        id,
        records: episodeRecords,
        startDate: episodeRecords.map(r => r.startDate).filter(Boolean).sort()[0] || '',
        endDate: episodeRecords.map(r => r.endDate).filter(Boolean).sort().at(-1) || '',
        days: dates.size,
        workDays: episodeRecords.reduce((sum, r) => sum + (r.manualWorkDays != null && r.manualWorkDays !== '' ? Number(r.manualWorkDays) : countWeekdays(r.startDate, r.endDate)), 0),
        categories: [...new Set(episodeRecords.map(r => r.category).filter(Boolean))]
      };
    }).sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  function getEpisodeWarnings(records) {
    const warnings = [];
    const sorted = [...records].sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (!sorted.some(r => r.certificateType === 'inizio')) warnings.push('Episodio senza certificato iniziale');
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      const gap = dayDiff(parseLocalDate(previous.endDate), parseLocalDate(current.startDate)) - 1;
      if (gap > 0) warnings.push(`Interruzione di ${gap} ${gap === 1 ? 'giorno' : 'giorni'}`);
      if (gap < -1) warnings.push('Date sovrapposte');
    }
    return warnings;
  }

  function renderExpiryBanner() {
    const today = startOfDay(new Date());
    const upcoming = state.records.map(record => ({ ...record, remaining: dayDiff(today, parseLocalDate(record.endDate)) }))
      .filter(record => record.remaining >= 0 && record.remaining <= 1)
      .sort((a, b) => a.remaining - b.remaining);
    const banner = el('expiryBanner');
    if (!upcoming.length) return banner.classList.add('hidden');
    const item = upcoming[0];
    banner.innerHTML = item.remaining === 0
      ? `<strong>La prognosi termina oggi.</strong> ${item.puc ? `PUC ${escapeHtml(item.puc)}.` : ''}`
      : `<strong>La prognosi termina domani.</strong> ${item.puc ? `PUC ${escapeHtml(item.puc)}.` : ''}`;
    banner.classList.remove('hidden');
  }

  function renderGlobalBanner() {
    const messages = [];
    const groups = getEpisodeGroups(state.records);
    const warningCount = groups.reduce((sum, group) => sum + getEpisodeWarnings(group.records).length, 0);
    if (warningCount) messages.push(`Sono presenti ${warningCount} possibili anomalie tra continuazioni, interruzioni o sovrapposizioni.`);
    const days = Number(state.settings.backupReminderDays || 0);
    if (state.records.length && days > 0) {
      const last = state.settings.lastBackupAt ? new Date(state.settings.lastBackupAt) : null;
      const elapsed = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : Infinity;
      if (elapsed >= days) messages.push('È consigliato creare un nuovo backup cifrato dell’archivio.');
    }
    const banner = el('globalBanner');
    if (!messages.length) return banner.classList.add('hidden');
    banner.innerHTML = `<strong>Controllo archivio</strong><br>${messages.map(escapeHtml).join('<br>')}`;
    banner.classList.remove('hidden');
  }

  function rebuildEpisodeSelect(record = null) {
    const select = el('episodeSelect');
    const groups = getEpisodeGroups(state.records.filter(r => r.id !== record?.id));
    select.innerHTML = '<option value="new">Nuovo episodio</option>' + groups.map(group => {
      const label = `${formatDate(group.startDate)} – ${formatDate(group.endDate)}${group.categories.length ? ` · ${group.categories.join(', ')}` : ''}`;
      return `<option value="${escapeHtml(group.id)}">${escapeHtml(label)}</option>`;
    }).join('');
    if (record?.episodeId && [...select.options].some(option => option.value === record.episodeId)) select.value = record.episodeId;
    else if (!record && el('certificateType').value !== 'inizio' && groups.length) select.value = groups[0].id;
  }

  function openCertificateDialog(record = null) {
    el('certificateForm').reset();
    clearConfidenceMarks();
    el('recordId').value = record?.id || '';
    el('dialogTitle').textContent = record ? 'Modifica certificato' : 'Aggiungi certificato';
    state.attachments = clone(record?.attachments || []);
    state.primaryAttachmentId = state.attachments.find(a => a.primary)?.id || state.attachments[0]?.id || null;
    setFieldValues(record || {});
    rebuildEpisodeSelect(record);
    el('formMessage').textContent = '';
    el('ocrReview').classList.add('hidden');
    renderAttachments();
    updateFormWarnings();
    el('certificateDialog').showModal();
  }

  function setFieldValues(record) {
    const values = {
      puc: '', visitDate: '', startDate: '', endDate: '', certificateType: 'inizio', visitType: 'ambulatoriale',
      doctor: '', category: '', manualWorkDays: '', fiscalVisitStatus: 'nessuna', fiscalVisitDate: '',
      companyNotifiedAt: '', companyMethod: '', companyContact: '', diagnosis: '', notes: '', ...record
    };
    Object.entries(values).forEach(([key, value]) => { if (el(key)) el(key).value = value ?? ''; });
  }

  function closeCertificateDialog() {
    if (el('certificateDialog').open) el('certificateDialog').close();
    state.attachments = [];
    state.primaryAttachmentId = null;
    state.fileSelectionActive = false;
    setOcrProgress(false, 0, '');
  }

  async function handleDocumentSelection(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) { state.fileSelectionActive = false; return; }
    el('formMessage').textContent = '';
    try {
      await addFiles(files);
      renderAttachments();
    } catch (error) { showFormMessage(error.message || 'Importazione non riuscita.'); }
    finally { state.fileSelectionActive = false; }
  }

  async function addFiles(files) {
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} supera il limite di 25 MB.`);
      let attachment;
      if ((file.type || '').startsWith('image/')) {
        const compressed = await ScannerTools.compressImageFile(file);
        attachment = { ...compressed, id: uid(), addedAt: new Date().toISOString() };
      } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const dataUrl = await ScannerTools.readFileAsDataUrl(file);
        attachment = { id: uid(), name: file.name, type: 'application/pdf', size: file.size, originalSize: file.size, dataUrl, addedAt: new Date().toISOString() };
      } else throw new Error(`Formato non supportato: ${file.name}`);
      state.attachments.push(attachment);
      if (!state.primaryAttachmentId) state.primaryAttachmentId = attachment.id;
    }
  }

  function renderAttachments() {
    state.attachments.forEach(attachment => { attachment.primary = attachment.id === state.primaryAttachmentId; });
    el('attachmentsList').innerHTML = state.attachments.map(attachment => `<div class="attachment-item ${attachment.primary ? 'primary-attachment' : ''}">
      <span>${attachment.type === 'application/pdf' ? '📕' : '🖼️'}</span>
      <div><strong>${escapeHtml(attachment.name)}</strong><small>${formatBytes(attachment.size)}${attachment.originalSize && attachment.originalSize !== attachment.size ? ` · originale ${formatBytes(attachment.originalSize)}` : ''}${attachment.primary ? ' · documento principale' : ''}</small></div>
      <div class="attachment-actions"><button class="mini-btn" data-action="primary" data-id="${attachment.id}" type="button" title="Imposta principale">★</button>${attachment.type.startsWith('image/') ? `<button class="mini-btn" data-action="edit" data-id="${attachment.id}" type="button" title="Modifica foto">✎</button>` : ''}<button class="mini-btn" data-action="remove" data-id="${attachment.id}" type="button" title="Rimuovi">✕</button></div>
    </div>`).join('');
    const main = getPrimaryAttachment();
    el('analyzeBtn').disabled = !main;
    el('editImageBtn').classList.toggle('hidden', !main?.type?.startsWith('image/'));
  }

  function handleAttachmentAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'primary') state.primaryAttachmentId = id;
    if (action === 'edit') openImageEditor(id);
    if (action === 'remove') {
      state.attachments = state.attachments.filter(a => a.id !== id);
      if (state.primaryAttachmentId === id) state.primaryAttachmentId = state.attachments[0]?.id || null;
    }
    renderAttachments();
  }

  function getPrimaryAttachment() { return state.attachments.find(a => a.id === state.primaryAttachmentId) || state.attachments[0] || null; }

  async function analyzeDocument() {
    const attachment = getPrimaryAttachment();
    if (!attachment) return;
    el('formMessage').textContent = '';
    el('analyzeBtn').disabled = true;
    setOcrProgress(true, 3, 'Preparazione documento…');
    try {
      let result;
      if (attachment.type === 'application/pdf') result = await analyzePdf(attachment.dataUrl);
      else if (attachment.type.startsWith('image/')) result = await analyzeInpsCertificateImage(attachment.dataUrl);
      else throw new Error('Formato non supportato per la lettura automatica.');
      const parsed = parseCertificateText(result.text, result.confidence);
      applyParsedFields(parsed);
      setOcrProgress(true, 100, 'Analisi completata. Controlla i campi evidenziati.');
      setTimeout(() => setOcrProgress(false, 0, ''), 1800);
      updateFormWarnings();
    } catch (error) {
      console.error(error);
      setOcrProgress(false, 0, '');
      showFormMessage(error.message || 'Lettura automatica non riuscita. Inserisci i dati manualmente.');
    } finally { el('analyzeBtn').disabled = !getPrimaryAttachment(); }
  }

  async function getOcrWorker() {
    if (state.ocrWorker) return state.ocrWorker;
    if (!window.Tesseract) throw new Error('Modulo OCR locale non disponibile.');
    state.ocrWorker = await window.Tesseract.createWorker('ita', 1, {
      workerPath: 'vendor/tesseract/worker.min.js',
      langPath: 'vendor/tesseract/lang-data',
      corePath: 'vendor/tesseract/core',
      logger: progress => {
        if (progress.status === 'recognizing text') {
          const current = Number(el('ocrProgressBar').dataset.base || 15);
          const span = Number(el('ocrProgressBar').dataset.span || 80);
          setOcrProgress(true, Math.round(current + progress.progress * span), `Lettura testo… ${Math.round(progress.progress * 100)}%`);
        }
      }
    });
    return state.ocrWorker;
  }

  async function runOcr(source, base = 15, span = 80) {
    el('ocrProgressBar').dataset.base = String(base);
    el('ocrProgressBar').dataset.span = String(span);
    const worker = await getOcrWorker();
    const result = await worker.recognize(source);
    return { text: result.data.text || '', confidence: Number(result.data.confidence || 0) };
  }

  async function cropForTargetOcr(dataUrl, region) {
    const image = await ScannerTools.loadImage(dataUrl);
    const sx = Math.max(0, Math.round(image.naturalWidth * region.x));
    const sy = Math.max(0, Math.round(image.naturalHeight * region.y));
    const sw = Math.max(20, Math.round(image.naturalWidth * region.w));
    const sh = Math.max(20, Math.round(image.naturalHeight * region.h));
    const scale = Math.min(4.5, Math.max(2.4, 1000 / Math.max(sw, 1)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = Math.round(.299 * pixels[i] + .587 * pixels[i + 1] + .114 * pixels[i + 2]);
      const contrasted = Math.max(0, Math.min(255, 1.75 * (gray - 150) + 150));
      pixels[i] = pixels[i + 1] = pixels[i + 2] = contrasted;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/jpeg', .92);
  }

  async function recognizeTargetRegion(dataUrl, region, options = {}) {
    const worker = await getOcrWorker();
    const source = await cropForTargetOcr(dataUrl, region);
    const psm = String(options.psm || 6);
    const whitelist = options.whitelist || '';
    try {
      if (worker.setParameters) {
        await worker.setParameters({
          tessedit_pageseg_mode: psm,
          tessedit_char_whitelist: whitelist,
          preserve_interword_spaces: '1'
        });
      }
      const result = await worker.recognize(source);
      return String(result?.data?.text || '').trim();
    } finally {
      if (worker.setParameters) {
        await worker.setParameters({
          tessedit_pageseg_mode: '3',
          tessedit_char_whitelist: '',
          preserve_interword_spaces: '1'
        });
      }
    }
  }

  function firstDateFromTarget(value) {
    const match = String(value || '').match(/(\d{1,2}\s*[\/.-]\s*\d{1,2}\s*[\/.-]\s*\d{4})/);
    return match ? match[1].replace(/\s/g, '') : '';
  }

  function firstPucFromTarget(value) {
    const normalized = String(value || '')
      .replace(/[OoQ]/g, '0')
      .replace(/[Il|]/g, '1')
      .replace(/[Ss]/g, '5')
      .replace(/[Bb]/g, '8')
      .replace(/[^0-9]/g, '');
    const exactNine = normalized.match(/\d{9}/)?.[0] || '';
    return exactNine || (normalized.length >= 7 && normalized.length <= 20 ? normalized : '');
  }

  function doctorFromTarget(value) {
    const cleaned = String(value || '')
      .replace(/DATI\s+DEL\s+MEDICO/gi, ' ')
      .replace(/\b(?:COGNOME|CORROME|E NOME|CODICE|REGIONE|ASL|AO|RICOVERO|STRUTTURA)\b/gi, ' ')
      .replace(/[|_\[\]{}0-9]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const candidates = [...cleaned.matchAll(/\b([A-ZÀ-Ü]{2,}(?:\s+[A-ZÀ-Ü]{2,}){1,5})\b/g)]
      .map(match => match[1].trim())
      .filter(item => !/(DATI|MEDICO|CODICE|REGIONE|STRUTTURA)/i.test(item));
    return candidates.sort((a, b) => b.length - a.length)[0] || '';
  }

  function diagnosisFromTarget(value) {
    const lines = String(value || '').split(/\n+/)
      .map(line => line
        .replace(/DATI\s+DIAGNOSI/gi, ' ')
        .replace(/Cod\.?\s*Nosologico/gi, ' ')
        .replace(/La malattia è dovuta ad evento traumatico/gi, ' ')
        .replace(/Note di diagnosi/gi, ' ')
        .replace(/[|_\[\]{}]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim())
      .filter(line => line.length >= 5)
      .filter(line => /[a-zà-ù]{4}/.test(line));
    return (lines.sort((a, b) => b.length - a.length)[0] || '')
      .replace(/lombosci\s*[:\-]?\s*gia/ig, 'lombosciatalgia')
      .replace(/lombosci\s*atalgia/ig, 'lombosciatalgia');
  }

  async function detectTemplateChecks(dataUrl) {
    const image = await ScannerTools.loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    ctx.drawImage(image, 0, 0);

    const score = box => {
      const x = Math.max(0, Math.round(canvas.width * box.x));
      const y = Math.max(0, Math.round(canvas.height * box.y));
      const w = Math.max(8, Math.round(canvas.width * box.w));
      const h = Math.max(8, Math.round(canvas.height * box.h));
      const padX = Math.max(2, Math.round(w * .18));
      const padY = Math.max(2, Math.round(h * .18));
      const data = ctx.getImageData(x + padX, y + padY, Math.max(1, w - 2 * padX), Math.max(1, h - 2 * padY)).data;
      let dark = 0;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        const gray = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
        if (gray < 145) dark += 1;
        total += 1;
      }
      return total ? dark / total : 0;
    };

    const boxes = {
      inizio: { x: .284, y: .312, w: .018, h: .014 },
      continuazione: { x: .466, y: .312, w: .018, h: .014 },
      ricaduta: { x: .584, y: .311, w: .018, h: .014 },
      ambulatoriale: { x: .339, y: .331, w: .019, h: .014 },
      domiciliare: { x: .604, y: .329, w: .018, h: .014 },
      prontoSoccorso: { x: .839, y: .329, w: .018, h: .014 }
    };
    const values = Object.fromEntries(Object.entries(boxes).map(([key, box]) => [key, score(box)]));
    const choose = keys => {
      const ranked = keys.map(key => ({ key, value: values[key] })).sort((a, b) => b.value - a.value);
      return ranked[0]?.value >= .14 && ranked[0].value >= (ranked[1]?.value || 0) + .06 ? ranked[0].key : '';
    };
    return {
      certificateType: choose(['inizio', 'continuazione', 'ricaduta']),
      visitType: choose(['ambulatoriale', 'domiciliare', 'prontoSoccorso'])
    };
  }

  async function analyzeInpsCertificateImage(dataUrl) {
    const full = await runOcr(dataUrl, 8, 48);
    if (!/(certificato\s+di\s+malattia|DATI\s+PROGNOSI|protocollo\s+univoc)/i.test(full.text)) return full;

    setOcrProgress(true, 58, 'Rilevo numero PUC e date…');
    const pucText = await recognizeTargetRegion(dataUrl, { x: .37, y: .085, w: .25, h: .040 }, { psm: 6, whitelist: '0123456789' });
    setOcrProgress(true, 65, 'Rilevo la data della visita…');
    const visitText = await recognizeTargetRegion(dataUrl, { x: .60, y: .084, w: .28, h: .043 }, { psm: 11, whitelist: '0123456789/.-' });
    setOcrProgress(true, 72, 'Rilevo il periodo di prognosi…');
    const startText = await recognizeTargetRegion(dataUrl, { x: .33, y: .242, w: .25, h: .048 }, { psm: 11, whitelist: '0123456789/.-' });
    const endText = await recognizeTargetRegion(dataUrl, { x: .68, y: .242, w: .27, h: .048 }, { psm: 11, whitelist: '0123456789/.-' });
    setOcrProgress(true, 82, 'Rilevo medico e diagnosi…');
    const doctorText = await recognizeTargetRegion(dataUrl, { x: .08, y: .148, w: .46, h: .060 }, { psm: 6 });
    const diagnosisText = await recognizeTargetRegion(dataUrl, { x: .20, y: .358, w: .73, h: .070 }, { psm: 6 });
    const checks = await detectTemplateChecks(dataUrl);

    const puc = firstPucFromTarget(pucText);
    const visitDate = firstDateFromTarget(visitText);
    const startDate = firstDateFromTarget(startText);
    const endDate = firstDateFromTarget(endText);
    const doctor = doctorFromTarget(doctorText);
    const diagnosis = diagnosisFromTarget(diagnosisText);
    const hints = [
      puc && `__PUC__: ${puc}`,
      visitDate && `__VISIT_DATE__: ${visitDate}`,
      startDate && `__START_DATE__: ${startDate}`,
      endDate && `__END_DATE__: ${endDate}`,
      doctor && `__DOCTOR__: ${doctor}`,
      diagnosis && `__DIAGNOSIS__: ${diagnosis}`,
      checks.certificateType && `__CERT_TYPE__: ${checks.certificateType}`,
      checks.visitType && `__VISIT_TYPE__: ${checks.visitType === 'prontoSoccorso' ? 'pronto-soccorso' : checks.visitType}`
    ].filter(Boolean).join('\n');

    return {
      text: `${hints}\n${full.text}`,
      confidence: full.confidence
    };
  }

  async function analyzePdf(dataUrl) {
    if (!window.pdfjsLib) throw new Error('Modulo PDF locale non disponibile.');
    const bytes = dataUrlToUint8Array(dataUrl);
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const pageLimit = Math.min(pdf.numPages, 12);
    let directText = '';
    for (let i = 1; i <= pageLimit; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      directText += '\n' + content.items.map(item => item.str).join(' ');
      setOcrProgress(true, 5 + Math.round((i / pageLimit) * 25), `Lettura PDF: pagina ${i} di ${pageLimit}`);
    }
    if (directText.replace(/\s/g, '').length >= 100) return { text: directText, confidence: 98 };

    let ocrText = '';
    const confidences = [];
    for (let i = 1; i <= pageLimit; i += 1) {
      setOcrProgress(true, 25, `PDF scansionato: preparo pagina ${i} di ${pageLimit}`);
      const imageDataUrl = await renderPdfPage(pdf, i);
      const base = 25 + ((i - 1) / pageLimit) * 70;
      const span = 70 / pageLimit;
      const result = await runOcr(imageDataUrl, base, span);
      ocrText += '\n' + result.text;
      confidences.push(result.confidence);
    }
    return { text: ocrText, confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0 };
  }

  async function renderPdfPage(pdf, pageNumber) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
    return canvas.toDataURL('image/jpeg', .9);
  }

  function parseCertificateText(rawText, documentConfidence = 70) {
    const original = String(rawText || '').replace(/\r/g, '\n');
    const text = original
      .replace(/[¦]/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '\n');
    const compact = text.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');
    const confidence = {};
    const hint = name => text.match(new RegExp(`__${name}__\\s*:\\s*([^\\n]+)`, 'i'))?.[1]?.trim() || '';

    const normalizeOcrDigits = value => String(value || '')
      .replace(/[OoQ]/g, '0')
      .replace(/[Il|]/g, '1')
      .replace(/[Ss]/g, '5')
      .replace(/[Bb]/g, '8')
      .replace(/[^0-9]/g, '');

    const dateMatches = [...compact.matchAll(/\b(\d{1,2}\s*[\/.-]\s*\d{1,2}\s*[\/.-]\s*\d{4})\b/g)]
      .map(match => ({ value: normalizeDate(match[1].replace(/\s/g, '')), index: match.index || 0 }))
      .filter(item => item.value);

    const dateAfter = (regexp, maxDistance = 240) => {
      const match = compact.match(regexp);
      if (!match) return '';
      const from = (match.index || 0) + match[0].length;
      return dateMatches.find(item => item.index >= from && item.index - from <= maxDistance)?.value || '';
    };

    let puc = normalizeOcrDigits(hint('PUC'));
    if (puc.length < 7) {
      const headerEnd = compact.search(/DATI\s+DEL\s+MEDICO/i);
      const header = headerEnd > 0 ? compact.slice(0, headerEnd) : compact.slice(0, 1200);
      const labelled = header.match(/(?:\bPU[CG]\b|protocollo\s+univoc[o0](?:\s+del\s+certificat[o0])?)[^0-9OoQIl|SsBb]{0,100}((?:[0-9OoQIl|SsBb][\s.,:;_\-]*){7,20})/i)?.[1] || '';
      puc = normalizeOcrDigits(labelled);
      if (puc.length < 7) {
        const candidates = [...header.matchAll(/(?:[0-9OoQIl|SsBb][^A-Za-zÀ-ÿ0-9]{0,3}){9,20}/g)]
          .map(item => normalizeOcrDigits(item[0]))
          .filter(value => value.length >= 9 && value.length <= 20);
        puc = candidates.find(value => value.length === 9) || candidates[0] || '';
      }
    }

    const visitDateHint = normalizeDate(hint('VISIT_DATE'));
    const startDateHint = normalizeDate(hint('START_DATE'));
    const endDateHint = normalizeDate(hint('END_DATE'));
    const visitDate = visitDateHint || dateAfter(/Data\s*Visita/i, 180) || dateMatches[0]?.value || '';

    const prognosisBlock = text.match(/DATI\s+PROGNOSI([\s\S]{0,1200}?)(?:DATI\s+DIAGNOSI|DIAGNOSI)/i)?.[1]
      || text.match(/(?:lavoratore\s+dichiara|ammalat[oa]\s+dal)([\s\S]{0,900}?)(?:DATI\s+DIAGNOSI|Trattasi\s+di|Visita\s*:)/i)?.[0]
      || '';
    const prognosisDates = [...prognosisBlock.matchAll(/\b(\d{1,2}\s*[\/.-]\s*\d{1,2}\s*[\/.-]\s*\d{4})\b/g)]
      .map(match => normalizeDate(match[1].replace(/\s/g, '')))
      .filter(Boolean);
    const uniquePrognosisDates = [...new Set(prognosisDates)];

    let startDate = startDateHint
      || dateAfter(/(?:ammalat[oa]|malattia)\s+dal/i, 300)
      || uniquePrognosisDates[0]
      || '';
    let endDate = endDateHint
      || dateAfter(/(?:tutto\s+il|fino\s+al|prognosi\s+clinica[\s\S]{0,70}?(?:il|al))/i, 320)
      || uniquePrognosisDates.at(-1)
      || '';

    if (startDate) {
      const startTime = parseLocalDate(startDate)?.getTime?.() || NaN;
      const plausibleLater = [...new Set([...uniquePrognosisDates, ...dateMatches.map(item => item.value)])]
        .filter(Boolean)
        .map(value => ({ value, time: parseLocalDate(value)?.getTime?.() || NaN }))
        .filter(item => Number.isFinite(item.time) && Number.isFinite(startTime) && item.time > startTime && item.time - startTime <= 370 * 86400000)
        .sort((a, b) => a.time - b.time)[0]?.value || '';
      if ((!endDate || endDate <= startDate) && plausibleLater) endDate = plausibleLater;
    }

    const doctorHint = hint('DOCTOR');
    const doctorBlock = text.match(/DATI\s+DEL\s+MEDICO([\s\S]{0,750}?)(?:DATI\s+PROGNOSI|PROGNOSI)/i)?.[1] || '';
    const doctorLines = doctorBlock.split('\n')
      .map(line => line.replace(/[^A-Za-zÀ-ÿ' ]/g, ' ').replace(/\s{2,}/g, ' ').trim())
      .filter(line => line.length >= 7)
      .filter(line => !/(COGNOME|NOME|CODICE|REGIONE|ASL|AO|MEDICO|SSN|LIBERO|PROFESSIONISTA|OPERA|RUOLO|STRUTTURA)/i.test(line));
    let doctor = doctorHint || doctorLines.find(line => {
      const letters = line.match(/[A-Za-zÀ-ÿ]/g) || [];
      const upper = line.match(/[A-ZÀ-Ü]/g) || [];
      return line.split(/\s+/).length >= 2 && letters.length > 5 && upper.length / letters.length > 0.58;
    }) || '';
    if (!doctor) {
      doctor = doctorBlock.match(/(?:Cognome\s*e\s*nome)?\s*([A-ZÀ-Ü][A-ZÀ-Ü' ]{5,70})/)?.[1] || '';
    }

    const diagnosisHint = hint('DIAGNOSIS');
    const diagnosisBlock = text.match(/DATI\s+DIAGNOSI([\s\S]{0,900}?)(?:Patologia\s+grave|DATI\s+DEL\s+LAVORATORE)/i)?.[1] || '';
    const diagnosisLines = diagnosisBlock.split('\n')
      .map(line => line.replace(/[|_\[\]{}]/g, ' ').replace(/\s{2,}/g, ' ').trim())
      .filter(line => line.length >= 5)
      .filter(line => !/(Cod\.?\s*Nosologico|malattia\s+è\s+dovuta|evento\s+traumatico|Note\s+di\s+diagnosi|DATI\s+DIAGNOSI)/i.test(line))
      .filter(line => /[a-zà-ù]{4}/.test(line));
    let diagnosis = diagnosisHint || diagnosisLines.sort((a, b) => b.length - a.length)[0] || '';

    const certificateTypeHint = hint('CERT_TYPE');
    const visitTypeHint = hint('VISIT_TYPE');
    const marked = label => new RegExp(`(?:${label})[^\\n]{0,35}(?:[xX☒■✓]|\\[x\\]|\\bM[I1]?\\b)`, 'i').test(text)
      || new RegExp(`(?:[xX☒■✓]|\\[x\\]|\\bM[I1]?\\b)[^\\n]{0,16}(?:${label})`, 'i').test(text);
    const certificateType = ['inizio', 'continuazione', 'ricaduta'].includes(certificateTypeHint)
      ? certificateTypeHint
      : marked('continuazione') ? 'continuazione' : marked('ricaduta') ? 'ricaduta' : 'inizio';
    const visitType = ['ambulatoriale', 'domiciliare', 'pronto-soccorso'].includes(visitTypeHint)
      ? visitTypeHint
      : marked('domiciliare') ? 'domiciliare' : marked('pronto\\s*soccorso') ? 'pronto-soccorso' : marked('ambulatoriale') ? 'ambulatoriale' : 'non-indicato';

    confidence.puc = puc ? Math.min(96, documentConfidence) : 0;
    confidence.visitDate = visitDate ? Math.min(96, documentConfidence) : 0;
    confidence.startDate = startDate ? Math.min(94, documentConfidence) : 0;
    confidence.endDate = endDate ? Math.min(94, documentConfidence) : 0;
    confidence.doctor = doctor ? Math.min(88, documentConfidence) : 0;
    confidence.diagnosis = diagnosis ? Math.min(82, documentConfidence) : 0;
    confidence.certificateType = certificateTypeHint ? 92 : (marked('inizio|continuazione|ricaduta') ? Math.min(85, documentConfidence) : 55);
    confidence.visitType = visitTypeHint ? 92 : (visitType !== 'non-indicato' ? Math.min(82, documentConfidence) : 45);

    return {
      fields: {
        puc,
        visitDate,
        startDate,
        endDate,
        certificateType,
        visitType,
        doctor: cleanExtractedName(doctor),
        diagnosis: cleanDiagnosis(diagnosis)
      },
      confidence,
      documentConfidence
    };
  }

  function applyParsedFields(parsed) {
    clearConfidenceMarks();
    for (const [key, value] of Object.entries(parsed.fields)) {
      const field = el(key);
      if (field && value) field.value = value;
      if (field && Number(parsed.confidence[key] || 0) < 75) field.classList.add('low-confidence');
    }
    const uncertain = Object.entries(parsed.confidence).filter(([, value]) => Number(value) < 75).map(([key]) => FIELD_LABELS[key]).filter(Boolean);
    const review = el('ocrReview');
    review.innerHTML = `<strong>Affidabilità OCR: ${Math.round(parsed.documentConfidence)}%</strong>${uncertain.length ? `Controlla con attenzione: ${escapeHtml(uncertain.join(', '))}.` : 'I campi principali sembrano leggibili; verifica comunque il documento.'}`;
    review.classList.remove('hidden');
    rebuildEpisodeSelect(el('recordId').value ? state.records.find(r => r.id === el('recordId').value) : null);
  }

  function clearConfidenceMarks() { document.querySelectorAll('.low-confidence').forEach(node => node.classList.remove('low-confidence')); }

  function handleCertificateTypeChange() {
    const editing = state.records.find(r => r.id === el('recordId').value);
    rebuildEpisodeSelect(editing);
    if (!editing && el('certificateType').value === 'inizio') el('episodeSelect').value = 'new';
    updateFormWarnings();
  }

  function getFormDraft() {
    return {
      id: el('recordId').value || null,
      puc: el('puc').value.trim(),
      visitDate: el('visitDate').value,
      startDate: el('startDate').value,
      endDate: el('endDate').value,
      certificateType: el('certificateType').value,
      episodeId: el('episodeSelect').value,
      visitType: el('visitType').value,
      category: el('category').value.trim(),
      doctor: el('doctor').value.trim(),
      manualWorkDays: el('manualWorkDays').value === '' ? null : Number(el('manualWorkDays').value),
      fiscalVisitStatus: el('fiscalVisitStatus').value,
      fiscalVisitDate: el('fiscalVisitDate').value,
      companyNotifiedAt: el('companyNotifiedAt').value,
      companyMethod: el('companyMethod').value,
      companyContact: el('companyContact').value.trim(),
      diagnosis: el('diagnosis').value.trim(),
      notes: el('notes').value.trim()
    };
  }

  function getDraftWarnings(draft) {
    const warnings = [];
    if (draft.visitDate && draft.startDate && draft.endDate && (draft.visitDate < draft.startDate || draft.visitDate > draft.endDate)) warnings.push('La data della visita è esterna al periodo di prognosi.');
    if (draft.certificateType !== 'inizio' && draft.episodeId === 'new') warnings.push('Continuazione o ricaduta non collegata a un episodio iniziale.');
    if (draft.episodeId !== 'new' && draft.startDate && draft.endDate) {
      const linked = state.records.filter(r => r.episodeId === draft.episodeId && r.id !== draft.id).sort((a, b) => a.startDate.localeCompare(b.startDate));
      if (linked.length && !linked.some(r => r.certificateType === 'inizio') && draft.certificateType !== 'inizio') warnings.push('L’episodio selezionato non contiene un certificato iniziale.');
      for (const record of linked) {
        if (rangesOverlap(draft.startDate, draft.endDate, record.startDate, record.endDate)) warnings.push(`Il periodo si sovrappone al certificato ${record.puc || 'senza PUC'}.`);
      }
      const previous = linked.filter(r => r.endDate < draft.startDate).sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
      if (previous) {
        const gap = dayDiff(parseLocalDate(previous.endDate), parseLocalDate(draft.startDate)) - 1;
        if (gap > 0) warnings.push(`Ci sono ${gap} ${gap === 1 ? 'giorno' : 'giorni'} scoperti rispetto al certificato precedente.`);
      }
    }
    return [...new Set(warnings)];
  }

  function updateFormWarnings() {
    const warnings = getDraftWarnings(getFormDraft());
    const box = el('validationWarnings');
    box.classList.toggle('hidden', !warnings.length);
    box.innerHTML = warnings.length ? `<strong>Controlli consigliati</strong>${warnings.map(w => `• ${escapeHtml(w)}`).join('<br>')}` : '';
  }

  async function saveCertificate(event) {
    event.preventDefault();
    const draft = getFormDraft();
    if (!draft.startDate || !draft.endDate) return showFormMessage('Inserisci le date di inizio e fine prognosi.');
    if (draft.endDate < draft.startDate) return showFormMessage('La data finale non può precedere quella iniziale.');
    if (draft.puc && state.records.some(r => r.puc === draft.puc && r.id !== draft.id)) return showFormMessage('Esiste già un certificato con questo numero PUC.');
    if (draft.manualWorkDays != null && draft.manualWorkDays < 0) return showFormMessage('Le giornate lavorative non possono essere negative.');
    const warnings = getDraftWarnings(draft);
    if (warnings.length && !confirm(`Sono presenti ${warnings.length} avvisi:\n\n${warnings.join('\n')}\n\nSalvare comunque?`)) return;

    const oldRecord = state.records.find(r => r.id === draft.id);
    const recordId = draft.id || uid();
    const episodeId = draft.episodeId === 'new' ? uid() : draft.episodeId;
    const attachments = clone(state.attachments).map(attachment => ({ ...attachment, primary: attachment.id === state.primaryAttachmentId }));
    const record = {
      ...draft,
      id: recordId,
      episodeId,
      attachments,
      attachment: undefined,
      createdAt: oldRecord?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    delete record.attachment;

    try {
      const payload = await CryptoVault.encryptJson(state.key, record);
      await SecureDB.put({ id: record.id, payload, updatedAt: record.updatedAt });
      closeCertificateDialog();
      await loadRecords();
    } catch (error) { showFormMessage(error.message || 'Salvataggio non riuscito.'); }
  }

  function showFormMessage(message) { el('formMessage').textContent = message; }

  function handleListClick(event) {
    const row = event.target.closest('[data-record-id]');
    if (row) showDetails(row.dataset.recordId);
  }

  function showDetails(id) {
    const record = state.records.find(r => r.id === id);
    if (!record) return;
    state.selectedRecordId = id;
    const group = getEpisodeGroups(state.records.filter(r => r.episodeId === record.episodeId))[0];
    el('detailsTitle').textContent = record.puc ? `PUC ${record.puc}` : 'Certificato';
    el('detailsContent').innerHTML = `<div class="details-grid">
      ${detailBox('Stato', capitalize(getRecordStatus(record).replace('-', ' ')))}
      ${detailBox('Data visita', formatDate(record.visitDate))}
      ${detailBox('Periodo', `${formatDate(record.startDate)} – ${formatDate(record.endDate)}`)}
      ${detailBox('Durata', `${calculateDays(record.startDate, record.endDate)} giorni`)}
      ${detailBox('Tipo', capitalize(record.certificateType))}
      ${detailBox('Episodio complessivo', group ? `${formatDate(group.startDate)} – ${formatDate(group.endDate)} (${group.days} giorni)` : 'Non collegato')}
      ${detailBox('Visita', capitalize((record.visitType || '').replace('-', ' ')))}
      ${detailBox('Medico', record.doctor || 'Non indicato')}
      ${detailBox('Categoria', record.category || 'Non indicata')}
      ${detailBox('Giornate lavorative', String(record.manualWorkDays ?? countWeekdays(record.startDate, record.endDate)))}
      ${detailBox('Comunicazione azienda', record.companyNotifiedAt ? `${formatDateTime(record.companyNotifiedAt)} · ${record.companyMethod || 'modalità non indicata'} · ${record.companyContact || 'destinatario non indicato'}` : 'Non registrata')}
      ${detailBox('Visita fiscale', `${capitalize(record.fiscalVisitStatus || 'nessuna')}${record.fiscalVisitDate ? ` · ${formatDateTime(record.fiscalVisitDate)}` : ''}`)}
      <div class="detail-box sensitive-box"><span>Diagnosi / note cliniche — tocca per mostrare</span><strong class="sensitive-content">${escapeHtml(record.diagnosis || 'Non inserita')}</strong></div>
      <div class="detail-box sensitive-box"><span>Note personali</span><strong>${escapeHtml(record.notes || 'Nessuna nota')}</strong></div>
    </div>`;
    el('detailAttachments').innerHTML = record.attachments?.length
      ? `<h3>Allegati</h3>${record.attachments.map(a => `<div class="detail-attachment"><div><strong>${escapeHtml(a.name)}</strong><br><small>${formatBytes(a.size)}${a.primary ? ' · principale' : ''}</small></div><button class="btn secondary" data-attachment-id="${a.id}" type="button">Apri</button></div>`).join('')}`
      : '';
    el('detailsDialog').showModal();
  }

  function detailBox(label, value) { return `<div class="detail-box"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'Non indicato')}</strong></div>`; }

  function editSelectedRecord() {
    const record = state.records.find(r => r.id === state.selectedRecordId);
    if (!record) return;
    el('detailsDialog').close();
    openCertificateDialog(record);
  }

  async function deleteSelectedRecord() {
    const record = state.records.find(r => r.id === state.selectedRecordId);
    if (!record) return;
    const linkedCount = state.records.filter(r => r.episodeId === record.episodeId).length;
    const text = linkedCount > 1 && record.certificateType === 'inizio'
      ? 'Questo è il certificato iniziale di un episodio con continuazioni. Eliminandolo, le continuazioni resteranno senza iniziale. Continuare?'
      : `Eliminare definitivamente il certificato ${record.puc ? `PUC ${record.puc}` : ''}?`;
    if (!confirm(text)) return;
    await SecureDB.remove(record.id);
    el('detailsDialog').close();
    await loadRecords();
  }

  function openAttachment(recordId, attachmentId) {
    const record = state.records.find(r => r.id === recordId);
    const attachment = record?.attachments?.find(a => a.id === attachmentId);
    if (!attachment?.dataUrl) return;
    const blob = dataUrlToBlob(attachment.dataUrl);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function renderStatistics() {
    const value = el('statsYearFilter').value;
    const records = value === 'all' ? state.records : state.records.filter(r => r.startDate?.startsWith(value));
    renderMonthlyChart(records);
    renderYearlyChart();
    renderCategoryStats(records);
    const year = value === 'all' ? [...new Set(state.records.map(r => r.startDate?.slice(0,4)).filter(Boolean))].sort().reverse()[0] : value;
    renderYearCalendar(year, year ? state.records.filter(r => rangeTouchesYear(r, Number(year))) : []);
  }

  function renderMonthlyChart(records) {
    const monthSets = Array.from({ length: 12 }, () => new Set());
    for (const record of records) forEachDate(record.startDate, record.endDate, date => monthSets[date.getMonth()].add(toIsoDate(date)));
    const values = monthSets.map(set => set.size);
    const max = Math.max(1, ...values);
    const labels = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    el('monthlyChart').innerHTML = values.map((value, index) => `<div class="month-bar"><div class="bar" style="height:${Math.max(2, (value/max)*190)}px"><strong>${value}</strong></div><small>${labels[index]}</small></div>`).join('');
  }

  function renderYearlyChart() {
    const byYear = new Map();
    for (const record of state.records) {
      forEachDate(record.startDate, record.endDate, date => {
        const year = date.getFullYear();
        if (!byYear.has(year)) byYear.set(year, new Set());
        byYear.get(year).add(toIsoDate(date));
      });
    }
    const rows = [...byYear.entries()].sort((a,b) => b[0]-a[0]).map(([year,set]) => [year,set.size]);
    const max = Math.max(1, ...rows.map(([,value]) => value));
    el('yearlyChart').innerHTML = rows.length ? rows.map(([year,value]) => `<div class="mini-bar-row"><strong>${year}</strong><div class="mini-bar-track"><span style="width:${(value/max)*100}%"></span></div><span>${value}</span></div>`).join('') : '<p class="muted">Nessun dato.</p>';
  }

  function renderCategoryStats(records) {
    const counts = new Map();
    records.forEach(record => counts.set(record.category || 'Non indicata', (counts.get(record.category || 'Non indicata') || 0) + 1));
    const rows = [...counts.entries()].sort((a,b) => b[1]-a[1]);
    el('categoryStats').innerHTML = rows.length ? rows.map(([category,count]) => `<div class="category-item"><span>${escapeHtml(category)}</span><strong>${count}</strong></div>`).join('') : '<p class="muted">Nessun dato.</p>';
  }

  function renderYearCalendar(year, records) {
    if (!year) { el('yearCalendar').innerHTML = '<p class="muted">Nessun anno disponibile.</p>'; return; }
    const sickDates = getUniqueDateSet(records);
    const formatter = new Intl.DateTimeFormat('it-IT', { month: 'long' });
    const weekdays = ['L','M','M','G','V','S','D'];
    el('yearCalendar').innerHTML = Array.from({ length: 12 }, (_, month) => {
      const first = new Date(Number(year), month, 1);
      const offset = (first.getDay() + 6) % 7;
      const total = new Date(Number(year), month + 1, 0).getDate();
      const blanks = '<span></span>'.repeat(offset);
      const days = Array.from({ length: total }, (_, i) => {
        const date = new Date(Number(year), month, i + 1);
        const iso = toIsoDate(date);
        const sick = sickDates.has(iso);
        const work = date.getDay() >= 1 && date.getDay() <= 5;
        return `<span class="calendar-day ${sick ? 'sick' : ''} ${sick && work ? 'workday' : ''}">${i+1}</span>`;
      }).join('');
      return `<article class="month-calendar"><h4>${formatter.format(first)}</h4><div class="calendar-grid">${weekdays.map(d => `<span class="weekday">${d}</span>`).join('')}${blanks}${days}</div></article>`;
    }).join('');
  }

  async function exportEncryptedBackup() {
    try {
      const records = await SecureDB.getAll();
      const core = { app: 'Archivio Malattia', version: 2, exportedAt: new Date().toISOString(), pinConfig: getPinConfig(), settings: state.settings, records };
      const checksum = await CryptoVault.backupChecksum(core);
      const backup = { ...core, checksum };
      downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `archivio-malattia-backup-${todayFile()}.json`);
      state.settings.lastBackupAt = new Date().toISOString();
      persistSettings();
      renderGlobalBanner();
    } catch (error) { alert(error.message || 'Backup non riuscito.'); }
  }

  async function importEncryptedBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (backup?.app !== 'Archivio Malattia' || !Array.isArray(backup.records) || !backup.pinConfig) throw new Error('Backup non valido.');
      if (backup.checksum) {
        const { checksum, ...core } = backup;
        const calculated = await CryptoVault.backupChecksum(core);
        if (calculated !== checksum) throw new Error('Il backup risulta incompleto o modificato.');
      }
      const backupPin = prompt('Inserisci il PIN con cui è stato creato questo backup:');
      if (!backupPin) return;
      const backupKey = await CryptoVault.unlockWithPin(backupPin, backup.pinConfig.saltBase64, backup.pinConfig.verifier, backup.pinConfig.iterations);
      for (const item of backup.records) await CryptoVault.decryptJson(backupKey, item.payload);
      if (!confirm('Il ripristino sostituirà l’archivio presente su questo dispositivo. Continuare?')) return;
      await SecureDB.replaceAll(backup.records);
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(backup.pinConfig));
      if (backup.settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, ...backup.settings }));
      alert('Backup verificato e ripristinato. Usa il PIN del backup.');
      location.reload();
    } catch (error) { alert(error.message || 'Ripristino non riuscito.'); }
  }

  function exportCsv() {
    const records = state.filteredRecords;
    const headers = ['PUC','Data visita','Dal','Al','Giorni','Giorni lavorativi','Tipo','Episodio','Visita','Medico','Categoria','Comunicazione azienda','Metodo','Destinatario','Visita fiscale','Note'];
    const rows = records.map(r => [r.puc,r.visitDate,r.startDate,r.endDate,calculateDays(r.startDate,r.endDate),r.manualWorkDays ?? countWeekdays(r.startDate,r.endDate),r.certificateType,r.episodeId,r.visitType,r.doctor,r.category,r.companyNotifiedAt,r.companyMethod,r.companyContact,r.fiscalVisitStatus,r.notes]);
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(';')).join('\n');
    downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `riepilogo-malattia-${todayFile()}.csv`);
  }

  async function handlePdfExport(event) {
    event.preventDefault();
    const records = el('pdfScope').value === 'all' ? state.records : state.filteredRecords;
    if (!records.length) return alert('Non ci sono certificati da esportare.');
    const blob = generatePdf(records, {
      includeDiagnosis: el('pdfIncludeDiagnosis').checked,
      includePersonalNotes: el('pdfIncludePersonalNotes').checked,
      title: 'Riepilogo certificati di malattia'
    });
    downloadBlob(blob, `riepilogo-malattia-${todayFile()}.pdf`);
    el('exportPdfDialog').close();
  }

  function generatePdf(records, options = {}) {
    if (!window.jspdf?.jsPDF) throw new Error('Modulo PDF non disponibile.');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const margin = 14;
    const width = 182;
    let y = 17;
    const addLine = (text, size = 10, bold = false, gap = 5) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(String(text || ''), width);
      if (y + lines.length * gap > 282) { doc.addPage(); y = 17; }
      doc.text(lines, margin, y);
      y += lines.length * gap;
    };
    addLine(options.title || 'Archivio Malattia', 17, true, 7);
    addLine(`Generato il ${new Intl.DateTimeFormat('it-IT', { dateStyle:'long', timeStyle:'short' }).format(new Date())}`, 8, false, 5);
    y += 2;
    records.sort((a,b) => a.startDate.localeCompare(b.startDate)).forEach((record, index) => {
      if (y > 250) { doc.addPage(); y = 17; }
      doc.setDrawColor(200); doc.line(margin, y, margin + width, y); y += 6;
      addLine(`${index + 1}. ${record.puc ? `PUC ${record.puc}` : 'Certificato senza PUC'}`, 12, true, 6);
      addLine(`Periodo: ${formatDate(record.startDate)} - ${formatDate(record.endDate)} (${calculateDays(record.startDate, record.endDate)} giorni)`, 9);
      addLine(`Tipo: ${capitalize(record.certificateType)} | Visita: ${capitalize((record.visitType || '').replace('-', ' '))}`, 9);
      addLine(`Medico: ${record.doctor || 'Non indicato'} | Categoria: ${record.category || 'Non indicata'}`, 9);
      addLine(`Comunicazione azienda: ${record.companyNotifiedAt ? formatDateTime(record.companyNotifiedAt) : 'Non registrata'}`, 9);
      if (options.includeDiagnosis) addLine(`Diagnosi/note cliniche: ${record.diagnosis || 'Non inserita'}`, 9);
      if (options.includePersonalNotes) addLine(`Note personali: ${record.notes || 'Nessuna'}`, 9);
      addLine(`Allegati archiviati: ${record.attachments?.length || 0}`, 8);
      y += 2;
    });
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i += 1) { doc.setPage(i); doc.setFontSize(8); doc.text(`Pagina ${i} di ${pages}`, 196, 290, { align:'right' }); }
    return doc.output('blob');
  }

  function exportSelectedRecordPdf() {
    const record = state.records.find(r => r.id === state.selectedRecordId);
    if (!record) return;
    const includeDiagnosis = confirm('Includere diagnosi e note cliniche nel PDF non cifrato?');
    const blob = generatePdf([record], { includeDiagnosis, includePersonalNotes: true, title: record.puc ? `Certificato PUC ${record.puc}` : 'Certificato di malattia' });
    downloadBlob(blob, `certificato-${record.puc || record.startDate || todayFile()}.pdf`);
  }

  function printSelectedRecord() {
    const record = state.records.find(r => r.id === state.selectedRecordId);
    if (!record) return;
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    if (!win) return alert('Consenti l’apertura della finestra di stampa.');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Certificato</title><style>body{font-family:Arial;padding:30px;line-height:1.5}h1{font-size:22px}.box{border:1px solid #ccc;padding:12px;margin:8px 0}small{color:#555}</style></head><body><h1>${record.puc ? `PUC ${escapeHtml(record.puc)}` : 'Certificato di malattia'}</h1><div class="box"><b>Periodo:</b> ${formatDate(record.startDate)} – ${formatDate(record.endDate)} (${calculateDays(record.startDate, record.endDate)} giorni)</div><div class="box"><b>Medico:</b> ${escapeHtml(record.doctor || 'Non indicato')}</div><div class="box"><b>Tipo:</b> ${escapeHtml(record.certificateType)} · ${escapeHtml(record.visitType)}</div><div class="box"><b>Categoria:</b> ${escapeHtml(record.category || 'Non indicata')}</div><div class="box"><b>Diagnosi:</b> ${escapeHtml(record.diagnosis || 'Non inserita')}</div><div class="box"><b>Note:</b> ${escapeHtml(record.notes || 'Nessuna')}</div><small>Documento generato da Archivio Malattia.</small><script>window.onload=()=>{window.print();}</script></body></html>`);
    win.document.close();
  }

  async function shareSelectedRecord() {
    const record = state.records.find(r => r.id === state.selectedRecordId);
    if (!record) return;
    const blob = generatePdf([record], { includeDiagnosis: false, includePersonalNotes: false, title: record.puc ? `Certificato PUC ${record.puc}` : 'Certificato di malattia' });
    const file = new File([blob], `certificato-${record.puc || record.startDate}.pdf`, { type:'application/pdf' });
    if (navigator.share && navigator.canShare?.({ files:[file] })) {
      try { await navigator.share({ title:'Certificato di malattia', text:`Periodo ${formatDate(record.startDate)} - ${formatDate(record.endDate)}`, files:[file] }); }
      catch (error) { if (error.name !== 'AbortError') alert('Condivisione non riuscita.'); }
    } else downloadBlob(blob, file.name);
  }

  function exportSelectedCalendarReminder() {
    const record = state.records.find(r => r.id === state.selectedRecordId);
    if (!record?.endDate) return;
    const start = record.endDate.replaceAll('-', '');
    const end = toIsoDate(addDays(parseLocalDate(record.endDate), 1)).replaceAll('-', '');
    const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Archivio Malattia//IT','BEGIN:VEVENT',`UID:${record.id}@archivio-malattia`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${start}`,`DTEND;VALUE=DATE:${end}`,`SUMMARY:Fine prognosi${record.puc ? ` - PUC ${record.puc}` : ''}`,'DESCRIPTION:Verifica eventuale rientro o necessità di continuazione.','END:VEVENT','END:VCALENDAR'].join('\r\n');
    downloadBlob(new Blob([ics], { type:'text/calendar;charset=utf-8' }), `fine-prognosi-${record.endDate}.ics`);
  }

  async function changePin(event) {
    event.preventDefault();
    const current = el('currentPin').value.trim();
    const next = el('newPin').value.trim();
    const confirmNext = el('newPinConfirm').value.trim();
    const message = el('changePinMessage');
    message.textContent = '';
    if (!/^\d{6,10}$/.test(next)) return message.textContent = 'Il nuovo PIN deve contenere da 6 a 10 cifre.';
    if (next !== confirmNext) return message.textContent = 'I nuovi PIN non coincidono.';
    const config = getPinConfig();
    try {
      const oldKey = await CryptoVault.unlockWithPin(current, config.saltBase64, config.verifier, config.iterations);
      const progress = el('changePinProgress');
      progress.classList.remove('hidden');
      const created = await CryptoVault.createPinVerifier(next);
      const encrypted = [];
      for (let i = 0; i < state.records.length; i += 1) {
        const record = state.records[i];
        // Verifica che la chiave attuale possa leggere davvero i record già in memoria tramite il record cifrato originale.
        const payload = await CryptoVault.encryptJson(created.key, record);
        encrypted.push({ id:record.id, payload, updatedAt:new Date().toISOString() });
        progress.querySelector('progress').value = Math.round(((i + 1) / Math.max(1,state.records.length)) * 100);
      }
      void oldKey;
      await SecureDB.replaceAll(encrypted);
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({ saltBase64:created.saltBase64, iterations:created.iterations, verifier:created.verifier }));
      state.key = created.key;
      progress.classList.add('hidden');
      el('changePinForm').reset();
      el('changePinDialog').close();
      alert('PIN cambiato. Tutto l’archivio è stato ricifrato.');
    } catch (error) {
      el('changePinProgress').classList.add('hidden');
      message.textContent = error.message === 'PIN non valido' ? 'Il PIN attuale non è corretto.' : (error.message || 'Cambio PIN non riuscito.');
    }
  }

  async function updateStorageEstimate() {
    if (!navigator.storage?.estimate) { el('storageText').textContent = 'Stima spazio non supportata dal browser.'; return; }
    try {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage || 0, quota = estimate.quota || 0;
      const percent = quota ? Math.min(100, used / quota * 100) : 0;
      el('storageText').textContent = `${formatBytes(used)} utilizzati su circa ${formatBytes(quota)} disponibili.`;
      el('storageBar').style.width = `${percent}%`;
      if (navigator.storage.persisted) {
        const persisted = await navigator.storage.persisted();
        el('persistStorageBtn').textContent = persisted ? 'Dati protetti dalla pulizia automatica' : 'Proteggi i dati dalla pulizia automatica';
        el('persistStorageBtn').disabled = persisted;
      }
    } catch { el('storageText').textContent = 'Impossibile calcolare lo spazio utilizzato.'; }
  }

  async function requestPersistentStorage() {
    if (!navigator.storage?.persist) return alert('Questa funzione non è supportata dal browser.');
    const granted = await navigator.storage.persist();
    alert(granted ? 'Il browser ha concesso la conservazione persistente dei dati.' : 'Il browser non ha concesso la conservazione persistente. Mantieni backup frequenti.');
    updateStorageEstimate();
  }

  async function importSharedFilesIfPresent() {
    try {
      const shared = await SecureDB.getSharedFiles();
      if (!shared.length) return;
      await SecureDB.clearSharedFiles();
      const files = shared.map(item => new File([item.blob], item.name || 'documento', { type:item.type || item.blob.type }));
      switchPanel('archivePanel');
      openCertificateDialog();
      await addFiles(files);
      renderAttachments();
      alert('Documento ricevuto dalla condivisione Android. Controlla i dati e avvia la lettura automatica.');
    } catch (error) { console.warn('Importazione condivisione non riuscita', error); }
  }

  async function openImageEditor(attachmentId) {
    const attachment = state.attachments.find(a => a.id === attachmentId);
    if (!attachment?.type?.startsWith('image/')) return;
    state.editor = { attachmentId, workingDataUrl: attachment.dataUrl, rotation: 0 };
    ['cropTop','cropBottom','cropLeft','cropRight'].forEach(id => el(id).value = '3');
    el('contrastToggle').checked = false;
    el('grayscaleToggle').checked = false;
    el('imageEditorMessage').textContent = '';
    el('imageEditorDialog').showModal();
    await renderEditorCanvas();
  }

  function closeImageEditor() {
    if (el('imageEditorDialog').open) el('imageEditorDialog').close();
    state.editor = null;
  }

  async function renderEditorCanvas() {
    if (!state.editor) return;
    const image = await ScannerTools.loadImage(state.editor.workingDataUrl);
    const canvas = el('imageEditorCanvas');
    const swap = Math.abs(state.editor.rotation % 180) === 90;
    const sourceWidth = swap ? image.naturalHeight : image.naturalWidth;
    const sourceHeight = swap ? image.naturalWidth : image.naturalHeight;
    const scale = Math.min(1, 1100 / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    const ctx = canvas.getContext('2d', { alpha:false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.translate(canvas.width/2,canvas.height/2);
    ctx.rotate(state.editor.rotation * Math.PI/180);
    ctx.drawImage(image, -image.naturalWidth*scale/2, -image.naturalHeight*scale/2, image.naturalWidth*scale, image.naturalHeight*scale);
    requestAnimationFrame(updateCropOverlay);
  }

  function rotateEditor(degrees) {
    if (!state.editor) return;
    state.editor.rotation = (state.editor.rotation + degrees) % 360;
    renderEditorCanvas();
  }

  function updateCropOverlay() {
    const canvas = el('imageEditorCanvas');
    const overlay = el('cropOverlay');
    if (!canvas.clientWidth) return;
    const left = Number(el('cropLeft').value)/100, right = Number(el('cropRight').value)/100;
    const top = Number(el('cropTop').value)/100, bottom = Number(el('cropBottom').value)/100;
    overlay.style.left = `${canvas.offsetLeft + canvas.clientWidth*left}px`;
    overlay.style.top = `${canvas.offsetTop + canvas.clientHeight*top}px`;
    overlay.style.width = `${canvas.clientWidth*(1-left-right)}px`;
    overlay.style.height = `${canvas.clientHeight*(1-top-bottom)}px`;
  }

  async function autoCorrectPerspective() {
    if (!state.editor) return;
    const button = el('autoPerspectiveBtn');
    button.disabled = true;
    el('imageEditorMessage').textContent = 'Rilevamento dei bordi del documento…';
    try {
      let source = state.editor.workingDataUrl;
      if (state.editor.rotation) source = (await ScannerTools.applyEdits(source, { rotation:state.editor.rotation })).dataUrl;
      const result = await ScannerTools.autoPerspective(source);
      state.editor.workingDataUrl = result.dataUrl;
      state.editor.rotation = 0;
      ['cropTop','cropBottom','cropLeft','cropRight'].forEach(id => el(id).value = '0');
      await renderEditorCanvas();
      el('cvModuleStatus').textContent = 'Locale e disponibile';
      el('imageEditorMessage').textContent = 'Prospettiva corretta. Controlla l’anteprima e applica.';
    } catch (error) { el('imageEditorMessage').textContent = error.message || 'Correzione automatica non riuscita.'; }
    finally { button.disabled = false; }
  }

  async function applyImageEdits() {
    if (!state.editor) return;
    const button = el('applyImageEditBtn');
    button.disabled = true;
    el('imageEditorMessage').textContent = 'Elaborazione della foto…';
    try {
      const result = await ScannerTools.applyEdits(state.editor.workingDataUrl, {
        rotation: state.editor.rotation,
        crop: { top:el('cropTop').value,bottom:el('cropBottom').value,left:el('cropLeft').value,right:el('cropRight').value },
        contrast: el('contrastToggle').checked,
        grayscale: el('grayscaleToggle').checked
      });
      const attachment = state.attachments.find(a => a.id === state.editor.attachmentId);
      Object.assign(attachment, result, { type:'image/jpeg', editedAt:new Date().toISOString() });
      closeImageEditor();
      renderAttachments();
    } catch (error) { el('imageEditorMessage').textContent = error.message || 'Modifica non riuscita.'; }
    finally { button.disabled = false; }
  }

  function initInstallPrompt() {
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault(); state.installPrompt = event; el('installBtn').classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => { state.installPrompt = null; el('installBtn').classList.add('hidden'); });
  }

  async function installApp() {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    el('installBtn').classList.add('hidden');
  }

  function initServiceWorker() {
    if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
  }

  function setOcrProgress(visible, value, text) {
    el('ocrProgress').classList.toggle('hidden', !visible);
    el('ocrProgressBar').value = value;
    el('ocrProgressText').textContent = text;
  }

  function getRecordStatus(record) {
    const today = toIsoDate(new Date());
    if (record.startDate > today) return 'futuro';
    if (record.endDate >= today) return 'in-corso';
    return 'terminato';
  }

  function getUniqueDateSet(records) {
    const set = new Set();
    records.forEach(record => forEachDate(record.startDate, record.endDate, date => set.add(toIsoDate(date))));
    return set;
  }

  function forEachDate(start, end, callback) {
    let date = parseLocalDate(start), last = parseLocalDate(end);
    if (!date || !last || last < date) return;
    let guard = 0;
    while (date <= last && guard < 4000) { callback(new Date(date)); date = addDays(date,1); guard += 1; }
  }

  function calculateDays(start, end) { return start && end ? Math.max(0, dayDiff(parseLocalDate(start), parseLocalDate(end)) + 1) : 0; }
  function countWeekdays(start, end) { let count = 0; forEachDate(start,end,date => { if (date.getDay() >= 1 && date.getDay() <= 5) count += 1; }); return count; }
  function rangesOverlap(aStart,aEnd,bStart,bEnd) { return Boolean(aStart && aEnd && bStart && bEnd && aStart <= bEnd && bStart <= aEnd); }
  function rangeTouchesYear(record, year) { return Boolean(record.startDate && record.endDate && record.startDate <= `${year}-12-31` && record.endDate >= `${year}-01-01`); }
  function parseLocalDate(value) { if (!value) return null; const [y,m,d] = value.split('-').map(Number); return new Date(y,m-1,d); }
  function startOfDay(date) { return new Date(date.getFullYear(),date.getMonth(),date.getDate()); }
  function dayDiff(a,b) { return !a || !b ? 0 : Math.round((startOfDay(b)-startOfDay(a))/86400000); }
  function addDays(date,days) { const result = new Date(date); result.setDate(result.getDate()+days); return result; }
  function toIsoDate(date) { const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }
  function formatDate(value) { const date=parseLocalDate(value); return date ? new Intl.DateTimeFormat('it-IT').format(date) : 'Non indicata'; }
  function formatDateTime(value) { if (!value) return 'Non indicata'; const date=new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short'}).format(date); }
  function normalizeDate(value) { const parts=value.replace(/[.-]/g,'/').split('/'); if (parts.length!==3) return ''; const [d,m,y]=parts; return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  function cleanExtractedName(value) { return value.replace(/CODICE|REGIONE|ASL|AO|DATI|MEDICO|SSN/gi,'').replace(/\s{2,}/g,' ').trim().slice(0,90); }
  function cleanDiagnosis(value) { return value.replace(/Patologia grave.*$/i,'').replace(/\s{2,}/g,' ').trim().slice(0,500); }
  function capitalize(value) { return value ? value.charAt(0).toUpperCase()+value.slice(1) : 'Non indicato'; }
  function dataUrlToUint8Array(dataUrl) { const base64=dataUrl.split(',')[1]; const binary=atob(base64); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i+=1) bytes[i]=binary.charCodeAt(i); return bytes; }
  function dataUrlToBlob(dataUrl) { const [meta]=dataUrl.split(','); const mime=meta.match(/data:(.*?);base64/)?.[1]||'application/octet-stream'; return new Blob([dataUrlToUint8Array(dataUrl)],{type:mime}); }
  function formatBytes(bytes) { if(!Number.isFinite(Number(bytes))) return ''; const n=Number(bytes); if(n<1024)return `${n} B`; if(n<1048576)return `${(n/1024).toFixed(1)} KB`; if(n<1073741824)return `${(n/1048576).toFixed(1)} MB`; return `${(n/1073741824).toFixed(1)} GB`; }
  function downloadBlob(blob,filename) { const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  function csvCell(value) { return `"${String(value??'').replace(/"/g,'""')}"`; }
  function todayFile() { return toIsoDate(new Date()); }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function clone(value) { return typeof structuredClone==='function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
  function escapeHtml(value) { return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
