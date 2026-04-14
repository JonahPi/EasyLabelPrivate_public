'use strict';

const AIO_BROKER = 'wss://io.adafruit.com:443/mqtt';

let mqttClient  = null;
let isConnected = false;
let TOPIC_DATA   = null;
let TOPIC_STATUS = null;

// ── Credentials ───────────────────────────────────────────────────────────────

function getCredentials() {
    const username = localStorage.getItem('aio_username');
    const key      = localStorage.getItem('aio_key');
    if (username && key) return { username, key };
    return null;
}

function saveCredentials(username, key) {
    localStorage.setItem('aio_username', username.trim());
    localStorage.setItem('aio_key', key.trim());
}

function buildTopics(username) {
    TOPIC_DATA   = `${username}/feeds/easylabelprivate.data`;
    TOPIC_STATUS = `${username}/feeds/easylabelprivate.status`;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
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
            {
                id: 'comment', label: 'Kommentar (optional)', type: 'text',
                maxLength: 50, placeholder: 'Wiki-Artikel',
            },
        ],
        buildPayload: (f) => ({
            label_type: 'qrcode',
            data: {
                content: f.content.trim(),
                ...(f.comment.trim() && { comment: f.comment.trim() }),
            },
        }),
    },

    filament: {
        title: 'Filament',
        fields: [
            {
                id: 'filament_type', label: 'Filament-Typ', type: 'text',
                required: true, maxLength: 100,
                placeholder: 'PLA 1.75mm Black',
                list: ['PLA', 'PETG', 'PETG-Carb', 'ASA', 'Flex', 'PVB'],
            },
            {
                id: 'opened', label: 'Geöffnet am', type: 'date',
                required: true, defaultValue: isoDate(),
            },
        ],
        buildPayload: (f) => ({
            label_type: 'filament',
            data: { filament_type: f.filament_type.trim(), opened: f.opened },
        }),
    },

    address: {
        title: 'Adressetikett',
        fields: [
            {
                id: 'company', label: 'Firma (optional)', type: 'text',
                maxLength: 100, placeholder: 'Migros',
            },
            {
                id: 'name', label: 'Name (optional)', type: 'text',
                maxLength: 100, placeholder: 'Max Mustermann',
            },
            {
                id: 'street', label: 'Strasse', type: 'text',
                required: true, maxLength: 100, placeholder: 'Migrosweg 2',
            },
            {
                id: 'zip', label: 'PLZ', type: 'text',
                required: true, maxLength: 20, placeholder: 'CH-8000',
            },
            {
                id: 'city', label: 'Ort', type: 'text',
                required: true, maxLength: 100, placeholder: 'Zürich',
            },
            {
                id: 'size', label: 'Grösse', type: 'select',
                options: [
                    { value: 'small', label: 'Klein' },
                    { value: 'large', label: 'Gross (quer, doppelt)' },
                ],
                defaultValue: 'small',
            },
            {
                id: 'includesender', label: 'Absenderzeile', type: 'select',
                options: [
                    { value: 'yes', label: 'Ja' },
                    { value: 'no',  label: 'Nein' },
                ],
                defaultValue: 'yes',
            },
        ],
        buildPayload: (f) => ({
            label_type: 'address',
            data: {
                ...(f.company.trim() && { company: f.company.trim() }),
                ...(f.name.trim()    && { name:    f.name.trim() }),
                street:        f.street.trim(),
                zip:           f.zip.trim(),
                city:          f.city.trim(),
                size:          f.size || 'small',
                includesender: f.includesender || 'yes',
            },
        }),
    },

    senderlabel: {
        title: 'Absenderetikett',
        fields: [
            {
                id: 'first', label: 'Vorname', type: 'text',
                required: true, maxLength: 50, placeholder: 'Bernd',
            },
        ],
        buildPayload: (f) => ({
            label_type: 'senderlabel',
            data: { first: f.first.trim() },
        }),
    },

    marmalade: {
        title: 'Konfitüre',
        fields: [
            {
                id: 'geschmack', label: 'Geschmack', type: 'text',
                required: true, maxLength: 100, placeholder: 'Erdbeer',
            },
            {
                id: 'received_from', label: 'Von (optional)', type: 'text',
                maxLength: 100, placeholder: 'Oma Gerda',
            },
            {
                id: 'received_on', label: 'Erhalten am', type: 'date',
                required: true, defaultValue: isoDate(),
            },
        ],
        buildPayload: (f) => ({
            label_type: 'marmalade',
            data: {
                geschmack: f.geschmack.trim(),
                ...(f.received_from.trim() && { received_from: f.received_from.trim() }),
                received_on: f.received_on,
            },
        }),
    },

    wine: {
        title: 'Wein',
        fields: [
            {
                id: 'geschmack', label: 'Geschmack', type: 'text',
                required: true, maxLength: 100, placeholder: 'Barolo 2019',
            },
            {
                id: 'received_from', label: 'Von (optional)', type: 'text',
                maxLength: 100, placeholder: 'Max',
            },
            {
                id: 'received_on', label: 'Erhalten am', type: 'date',
                required: true, defaultValue: isoDate(),
            },
        ],
        buildPayload: (f) => ({
            label_type: 'wine',
            data: {
                geschmack: f.geschmack.trim(),
                ...(f.received_from.trim() && { received_from: f.received_from.trim() }),
                received_on: f.received_on,
            },
        }),
    },
};

// ── MQTT ──────────────────────────────────────────────────────────────────────

function initMQTT(username, key) {
    buildTopics(username);
    const clientId = 'pwa_' + Math.random().toString(36).slice(2, 10);
    mqttClient = mqtt.connect(AIO_BROKER, {
        clientId,
        username,
        password: key,
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
    document.title = t ? t + ' — EasyLabel Home' : 'EasyLabel Home';
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

    } else if (f.type === 'select') {
        const opts = f.options.map(o =>
            `<option value="${escAttr(o.value)}" ${o.value === val ? 'selected' : ''}>${escHTML(o.label)}</option>`
        ).join('');
        input = `<select id="${f.id}" name="${f.id}">${opts}</select>`;

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
    setPageTitle('EasyLabel Home');
    showBack(false);
    const buttons = Object.entries(LABEL_TYPES)
        .map(([type, cfg]) =>
            `<button class="label-btn" data-type="${escAttr(type)}">${escHTML(cfg.title)}</button>`)
        .join('');
    setApp(`<div class="home-grid">${buttons}</div>`);
    document.querySelectorAll('.label-btn').forEach(btn => {
        btn.addEventListener('click', () => showLabelPage(btn.dataset.type));
    });
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
                <button type="submit" class="btn-primary" id="prepare-btn">Drucken</button>
            </form>
            <div id="feedback" class="feedback"></div>
        </div>
    `);

    document.getElementById('label-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('prepare-btn');

        const formData = {};
        for (const f of cfg.fields) {
            formData[f.id] = document.getElementById(f.id).value;
        }

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
            showFeedback('✓ Druckauftrag gesendet!', true);
        } catch (err) {
            showFeedback('Fehler: ' + err.message, false);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Drucken';
        }
    });
}

// ── Setup page ────────────────────────────────────────────────────────────────

function showSetupPage() {
    const creds = getCredentials();
    setPageTitle('Einstellungen');
    showBack(false);
    setApp(`
        <div class="card">
            <form id="setup-form" novalidate>
                <div class="form-group">
                    <label for="setup-username">Adafruit IO Benutzername</label>
                    <input type="text" id="setup-username" required
                        value="${escAttr(creds ? creds.username : '')}"
                        placeholder="dein_benutzername">
                </div>
                <div class="form-group">
                    <label for="setup-key">Adafruit IO Key</label>
                    <input type="password" id="setup-key" required
                        value="${escAttr(creds ? creds.key : '')}"
                        placeholder="aio_xxxxxxxxxxxx">
                </div>
                <button type="submit" class="btn-primary">Speichern</button>
            </form>
            <div id="feedback" class="feedback"></div>
        </div>
    `);

    document.getElementById('setup-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('setup-username').value.trim();
        const key      = document.getElementById('setup-key').value.trim();
        if (!username || !key) {
            showFeedback('Bitte beide Felder ausfüllen.', false);
            return;
        }
        saveCredentials(username, key);
        if (mqttClient) mqttClient.end(true);
        mqttClient  = null;
        isConnected = false;
        initMQTT(username, key);
        showHome();
    });
}

// ── Router ────────────────────────────────────────────────────────────────────

function route() {
    const creds = getCredentials();
    if (!creds) { showSetupPage(); return; }

    const p    = new URLSearchParams(location.search);
    const type = p.get('type');

    if (type && LABEL_TYPES[type]) showLabelPage(type);
    else                           showHome();
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('back-btn').addEventListener('click', () => showHome());
    document.getElementById('settings-btn').addEventListener('click', () => showSetupPage());

    const creds = getCredentials();
    if (creds) initMQTT(creds.username, creds.key);

    route();
});
