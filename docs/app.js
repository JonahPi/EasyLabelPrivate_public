'use strict';

const BROKER_URL    = 'wss://broker.hivemq.com:8884/mqtt';
const TOPIC_DATA    = 'easylabel/data';
const TOPIC_RELEASE = 'easylabel/release';
const TOPIC_STATUS  = 'easylabel/status';

let mqttClient  = null;
let isConnected = false;

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

// ── Label type configuration ──────────────────────────────────────────────────

const LABEL_TYPES = {
    freetext: {
        title: 'Freitext',
        fields: [
            {
                id: 'text', label: 'Text', type: 'textarea',
                required: true, maxLength: 500,
                hint: 'Die erste Zeile wird als Titel gedruckt (größer und fett).',
            },
            {
                id: 'copies', label: 'Anzahl Kopien', type: 'number',
                min: 1, max: 99, defaultValue: '1',
            },
        ],
        buildPayload: (f) => ({
            label_type: 'freetext',
            data: { text: f.text.trim(), copies: Math.max(1, parseInt(f.copies) || 1) },
        }),
    },

    qrcode: {
        title: 'QR-Code',
        fields: [
            {
                id: 'content', label: 'Inhalt / URL', type: 'text',
                required: true, maxLength: 500,
                placeholder: 'https://example.com',
            },
        ],
        buildPayload: (f) => ({
            label_type: 'qrcode',
            data: { content: f.content.trim() },
        }),
    },

    material_storage: {
        title: 'Privates Material',
        fields: [
            {
                id: 'member', label: 'Mitglied', type: 'text', required: true,
            },
            {
                id: 'pieces', label: 'Anzahl Stücke', type: 'number',
                min: 1, max: 99, defaultValue: '1',
                hint: 'Es wird für jedes Stück ein eigenes Label gedruckt. Abholdatum wird automatisch auf 3 Wochen ab heute gesetzt.',
            },
        ],
        buildPayload: (f) => ({
            label_type: 'material_storage',
            data: {
                member: f.member.trim(),
                pieces: Math.max(1, parseInt(f.pieces) || 1),
            },
        }),
    },

    filament: {
        title: 'Filament',
        fields: [
            {
                id: 'filament_type', label: 'Filament-Typ', type: 'text',
                required: true,
                list: [
                    'PLA 1.75mm', 'PLA+ 1.75mm', 'PETG 1.75mm', 'ABS 1.75mm',
                    'TPU 1.75mm', 'ASA 1.75mm', 'Nylon 1.75mm', 'Resin',
                ],
            },
            {
                id: 'opened', label: 'Geöffnet am', type: 'date',
                required: true, defaultValue: isoDate(0),
            },
        ],
        buildPayload: (f) => ({
            label_type: 'filament',
            data: { filament_type: f.filament_type.trim(), opened: f.opened },
        }),
    },

    '3d_print': {
        title: '3D Print Pickup',
        fields: [
            {
                id: 'member', label: 'Mitglied', type: 'text', required: true,
            },
            {
                id: 'pickup_date', label: 'Abholung am', type: 'date',
                required: true, defaultValue: isoDate(7),
            },
        ],
        buildPayload: (f) => ({
            label_type: '3d_print',
            data: { member: f.member.trim(), pickup_date: f.pickup_date },
        }),
    },
};

// ── MQTT ──────────────────────────────────────────────────────────────────────

function initMQTT() {
    const clientId = 'pwa_' + Math.random().toString(36).slice(2, 10);
    mqttClient = mqtt.connect(BROKER_URL, {
        clientId,
        clean: true,
        reconnectPeriod: 3000,
        connectTimeout: 10000,
    });
    mqttClient.on('connect', () => {
        isConnected = true;
        setStatusDot(true);
        setStatusBar('Verbunden', 'ok');
        mqttClient.subscribe(TOPIC_STATUS, { qos: 1 });
    });
    mqttClient.on('offline', () => {
        isConnected = false;
        setStatusDot(false);
        setStatusBar('Verbindung getrennt — wird neu verbunden...', '');
    });
    mqttClient.on('error', (e) => {
        setStatusBar('Verbindungsfehler: ' + e.message, 'err');
    });
    mqttClient.on('message', (topic, message) => {
        if (topic !== TOPIC_STATUS) return;
        try {
            const payload = JSON.parse(message.toString());
            setPrinterStatus(payload.printer === 'online');
        } catch (_) {}
    });
}

function waitForConnect(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        if (isConnected) { resolve(); return; }
        const timer = setTimeout(
            () => reject(new Error('Verbindungs-Timeout. Bitte Internetverbindung prüfen.')),
            timeoutMs,
        );
        mqttClient.once('connect', () => { clearTimeout(timer); resolve(); });
    });
}

function mqttPublish(topic, payload) {
    return new Promise((resolve, reject) => {
        mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
            if (err) reject(err); else resolve();
        });
    });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function setStatusDot(ok) {
    const dot = document.getElementById('status-dot');
    if (dot) dot.className = 'status-dot' + (ok ? ' ok' : '');
}

let _printerOnline = null;

function setPrinterStatus(online) {
    _printerOnline = online;
    const el = document.getElementById('printer-status');
    if (el) {
        el.textContent = online ? 'Printer ON' : 'Printer OFF';
        el.className = 'printer-status ' + (online ? 'online' : 'offline');
    }
    // Update warning banner if visible on label pages
    const warn = document.getElementById('printer-warning');
    if (warn) warn.style.display = online ? 'none' : 'block';
}

function setStatusBar(msg, cls = '') {
    const bar = document.getElementById('status-bar');
    if (!bar) return;
    bar.textContent = msg;
    bar.className = 'status-bar' + (cls ? ' ' + cls : '');
}

function setPageTitle(t) {
    const el = document.getElementById('page-title');
    if (el) el.textContent = t;
    document.title = t ? t + ' — EasyLabel' : 'EasyLabel';
}

function showBack(show) {
    document.getElementById('back-btn').classList.toggle('hidden', !show);
}

function setApp(html) {
    document.getElementById('app').innerHTML = html;
}

function showFeedback(msg, success) {
    const el = document.getElementById('feedback');
    if (!el) return;
    el.textContent = msg;
    el.className = 'feedback ' + (success ? 'success' : 'error');
}

// ── Field renderer ────────────────────────────────────────────────────────────

function renderField(f) {
    const val = f.defaultValue || '';
    let input;

    if (f.type === 'textarea') {
        input = `<textarea id="${f.id}" name="${f.id}"
            ${f.required  ? 'required'               : ''}
            ${f.maxLength ? `maxlength="${f.maxLength}"` : ''}
            ${f.placeholder ? `placeholder="${escAttr(f.placeholder)}"` : ''}
        ></textarea>`;

    } else if (f.list) {
        const listId = f.id + '-list';
        const opts   = f.list.map(v => `<option value="${escAttr(v)}">`).join('');
        input = `
            <input type="text" id="${f.id}" name="${f.id}" list="${listId}"
                ${f.required ? 'required' : ''}
                value="${escAttr(val)}">
            <datalist id="${listId}">${opts}</datalist>`;

    } else {
        input = `<input type="${f.type}" id="${f.id}" name="${f.id}"
            ${f.required    ? 'required'                  : ''}
            ${f.min  !== undefined ? `min="${f.min}"`     : ''}
            ${f.max  !== undefined ? `max="${f.max}"`     : ''}
            ${f.maxLength   ? `maxlength="${f.maxLength}"` : ''}
            ${f.placeholder ? `placeholder="${escAttr(f.placeholder)}"` : ''}
            value="${escAttr(val)}">`;
    }

    return `
        <div class="form-group">
            <label for="${f.id}">${escHTML(f.label)}</label>
            ${input}
            ${f.hint ? `<p class="hint">${escHTML(f.hint)}</p>` : ''}
        </div>`;
}

function escAttr(s) {
    return String(s).replace(/"/g, '&quot;');
}
function escHTML(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Pages ─────────────────────────────────────────────────────────────────────

function showHome() {
    setPageTitle('EasyLabel');
    showBack(false);
    const buttons = Object.entries(LABEL_TYPES)
        .map(([type, cfg]) =>
            `<a class="label-btn" href="?type=${encodeURIComponent(type)}">${escHTML(cfg.title)}</a>`)
        .join('');
    setApp(`<div class="home-grid">${buttons}</div>`);
}

function showLabelPage(type) {
    const cfg = LABEL_TYPES[type];
    if (!cfg) { showHome(); return; }

    setPageTitle(cfg.title);
    showBack(true);

    const fields = cfg.fields.map(renderField).join('');
    const printerOffline = _printerOnline === false;
    setApp(`
        <div id="printer-warning" class="printer-warning" style="${printerOffline ? '' : 'display:none'}">
            &#9888; Drucker nicht erreichbar — Label wird trotzdem vorbereitet.
        </div>
        <div class="card">
            <form id="label-form" novalidate>
                ${fields}
                <button type="submit" class="btn-primary" id="prepare-btn">Vorbereiten</button>
            </form>
            <div id="feedback" class="feedback"></div>
        </div>
    `);

    document.getElementById('label-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('prepare-btn');

        // Collect values
        const formData = {};
        for (const f of cfg.fields) {
            formData[f.id] = document.getElementById(f.id).value;
        }

        // Validate required fields
        for (const f of cfg.fields) {
            if (f.required && !formData[f.id].trim()) {
                showFeedback(`Bitte "${f.label}" ausfüllen.`, false);
                document.getElementById(f.id).focus();
                return;
            }
        }

        btn.disabled = true;
        btn.textContent = 'Sende…';

        try {
            if (!isConnected) {
                setStatusBar('Warte auf Verbindung…', '');
                await waitForConnect();
            }
            const payload = cfg.buildPayload(formData);
            await mqttPublish(TOPIC_DATA, payload);
            showScannerPage();
        } catch (err) {
            showFeedback('Fehler: ' + err.message, false);
            btn.disabled = false;
            btn.textContent = 'Vorbereiten';
        }
    });
}

async function showReleasePage(key) {
    setPageTitle('Drucken');
    showBack(false);
    setApp(`
        <div class="card release-card">
            <div class="spinner"></div>
            <div class="release-title">Druckauftrag wird gesendet…</div>
            <div class="release-sub">Bitte warten</div>
        </div>
    `);

    try {
        if (!isConnected) await waitForConnect();
        await mqttPublish(TOPIC_RELEASE, { key });
        setApp(`
            <div class="card release-card">
                <div class="release-icon">&#10003;</div>
                <div class="release-title">Druckauftrag gesendet!</div>
                <div class="release-sub">Das Label wird jetzt gedruckt.</div>
            </div>
        `);
    } catch (err) {
        setApp(`
            <div class="card release-card">
                <div class="release-icon">&#10007;</div>
                <div class="release-title">Fehler beim Senden</div>
                <div class="release-sub">${escHTML(err.message)}</div>
            </div>
        `);
    }
}

// ── Camera scanner ────────────────────────────────────────────────────────────

let _scannerStream     = null;
let _scannerIntervalId = null;
let _scannerRoot       = null;

function showScannerPage() {
    stopScanner();
    setPageTitle('QR scannen');
    showBack(false);

    _scannerRoot = document.createElement('div');
    _scannerRoot.className = 'scanner-root';
    _scannerRoot.innerHTML = `
        <video id="scanner-video" autoplay muted playsinline></video>
        <canvas id="scanner-canvas"></canvas>
        <div class="scanner-overlay">
            <p class="scanner-hint">Halte die Kamera auf den QR-Code am Drucker</p>
            <div class="scanner-frame"></div>
            <button class="scanner-cancel-btn" type="button">Abbrechen</button>
        </div>
    `;
    document.body.appendChild(_scannerRoot);

    _scannerRoot.querySelector('.scanner-cancel-btn').addEventListener('click', () => {
        stopScanner();
        showHome();
    });

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        _showScannerError('Kamera nicht verfügbar. Bitte mit der nativen Kamera-App scannen.');
        return;
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then(stream => {
            _scannerStream = stream;
            const video  = _scannerRoot.querySelector('#scanner-video');
            const canvas = _scannerRoot.querySelector('#scanner-canvas');
            const ctx    = canvas.getContext('2d', { willReadFrequently: true });
            video.srcObject = stream;

            _scannerIntervalId = setInterval(() => {
                if (!_scannerRoot || video.readyState !== video.HAVE_ENOUGH_DATA) return;
                canvas.width  = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0);
                const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                if (!code) return;
                try {
                    const key = new URL(code.data).searchParams.get('key');
                    if (key) { stopScanner(); showReleasePage(key); }
                } catch (_) {}
            }, 150);
        })
        .catch(err => _showScannerError('Kamera nicht verfügbar: ' + err.message));
}

function _showScannerError(msg) {
    if (!_scannerRoot) return;
    const overlay = _scannerRoot.querySelector('.scanner-overlay');
    overlay.innerHTML = `
        <div class="scanner-error-box">
            <p>${escHTML(msg)}</p>
            <p class="scanner-error-hint">Sie können den QR-Code am Drucker auch mit der nativen Kamera-App scannen.</p>
            <button class="scanner-cancel-btn" type="button">Zurück</button>
        </div>
    `;
    overlay.querySelector('.scanner-cancel-btn').addEventListener('click', () => {
        stopScanner();
        showHome();
    });
}

function stopScanner() {
    if (_scannerIntervalId) { clearInterval(_scannerIntervalId); _scannerIntervalId = null; }
    if (_scannerStream)     { _scannerStream.getTracks().forEach(t => t.stop()); _scannerStream = null; }
    if (_scannerRoot)       { _scannerRoot.remove(); _scannerRoot = null; }
}

// ── Router ────────────────────────────────────────────────────────────────────

function route() {
    const p    = new URLSearchParams(location.search);
    const type = p.get('type');
    const key  = p.get('key');

    if (key)                           showReleasePage(key);
    else if (type && LABEL_TYPES[type]) showLabelPage(type);
    else                               showHome();
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('back-btn').addEventListener('click', () => history.back());
    initMQTT();
    route();
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
