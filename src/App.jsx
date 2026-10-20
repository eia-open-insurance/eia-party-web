import React, { useEffect, useRef, useState } from 'react';
import './ui.css';

const TENANT = '11111111-1111-7111-8111-111111111111';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'identifiers', label: 'Identifiers' },
  { id: 'names', label: 'Names & Addresses' },
  { id: 'activity', label: 'Activity' }
];

const PARTY_TYPES = [
  ['ORGANIZATION', 'Organization'],
  ['PERSON', 'Person'],
  ['TRUST', 'Trust'],
  ['ESTATE', 'Estate']
];

const EMPTY_FORM = { partyType: 'ORGANIZATION', displayName: '', legalName: '' };

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background: 'rgba(11, 46, 79, 0.52)'
};

const DIALOG_STYLE = {
  width: 'min(760px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

function statusTone(status) {
  if (status === 'ACTIVE') return 'green';
  if (['BLOCKED', 'DECEASED', 'DISSOLVED', 'MERGED'].includes(status)) return 'red';
  if (['PROSPECT', 'INACTIVE', 'RESTRICTED'].includes(status)) return 'amber';
  return 'blue';
}

function sanctionsTone(status) {
  if (status === 'CLEAR') return 'green';
  if (['BLOCKED', 'HIT', 'MATCH', 'POTENTIAL_MATCH'].includes(status)) return 'red';
  if (status === 'NOT_SCREENED') return 'amber';
  return 'blue';
}

function confidentialityTone(value) {
  if (['CONFIDENTIAL', 'RESTRICTED'].includes(value)) return 'red';
  if (value === 'INTERNAL') return 'blue';
  return 'amber';
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function problemMessage(body, fallback) {
  if (!body || typeof body !== 'object') return fallback;
  const summary = body.message || body.detail || body.title || fallback;
  const details = [];
  if (body.details && typeof body.details === 'object' && !Array.isArray(body.details)) {
    for (const [field, message] of Object.entries(body.details)) {
      details.push(`${field}: ${message}`);
    }
  }
  if (Array.isArray(body.errors)) {
    for (const error of body.errors) {
      details.push(`${error.field || 'request'}: ${error.message || error.code || 'is invalid'}`);
    }
  }
  return details.length > 0 ? `${summary} (${details.join('; ')})` : summary;
}

async function readJson(response) {
  return response.json().catch(() => null);
}

async function api(path, options = {}) {
  const headers = { 'X-EIA-Tenant': TENANT };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(problemMessage(body, `Request failed: ${response.status}`));
  }
  return body;
}

function updateField(setter, field, value) {
  setter((current) => ({ ...current, [field]: value }));
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`eia-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function App() {
  const [parties, setParties] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const detailRequest = useRef(0);

  const selectedParty = detail && detail.id === selectedId
    ? detail
    : parties.find((party) => party.id === selectedId) || null;

  async function fetchParties() {
    const body = await api('/api/v1/parties');
    return Array.isArray(body) ? body : [];
  }

  async function loadDetail(partyId, options = {}) {
    const requestId = detailRequest.current + 1;
    detailRequest.current = requestId;
    if (!options.silent) setDetailLoading(true);
    try {
      const record = await api(`/api/v1/parties/${encodeURIComponent(partyId)}`);
      if (requestId === detailRequest.current) setDetail(record);
    } catch (e) {
      if (requestId === detailRequest.current) setError(e.message);
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function initialise() {
      try {
        const rows = await fetchParties();
        if (cancelled) return;
        setParties(rows);
        if (rows.length > 0) {
          setSelectedId(rows[0].id);
          await loadDetail(rows[0].id);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    initialise();
    return () => {
      cancelled = true;
      detailRequest.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!registerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !registering) {
        setRegisterOpen(false);
        setError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [registerOpen, registering]);

  function selectParty(partyId) {
    if (partyId === selectedId) return;
    setSelectedId(partyId);
    setDetail(null);
    setActiveTab('overview');
    setError('');
    setNotice('');
    loadDetail(partyId);
  }

  async function refreshWorkspace() {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const rows = await fetchParties();
      setParties(rows);
      const target = rows.find((party) => party.id === selectedId) || rows[0] || null;
      if (!target) {
        setSelectedId(null);
        setDetail(null);
        return;
      }
      if (target.id !== selectedId) {
        setSelectedId(target.id);
        setDetail(null);
      }
      await loadDetail(target.id, { silent: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function openRegister() {
    setForm(EMPTY_FORM);
    setError('');
    setRegisterOpen(true);
  }

  function closeRegister() {
    if (registering) return;
    setRegisterOpen(false);
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    setRegistering(true);
    setError('');
    try {
      const created = await api('/api/v1/parties', {
        method: 'POST',
        body: {
          partyType: form.partyType,
          displayName: form.displayName.trim(),
          legalName: form.legalName.trim()
        }
      });
      setRegisterOpen(false);
      setForm(EMPTY_FORM);
      setActiveTab('overview');
      setNotice(`Registered ${created?.partyNumber || 'party'}.`);
      if (created?.id) {
        setSelectedId(created.id);
        setDetail(created);
        setParties((current) => [created, ...current.filter((party) => party.id !== created.id)]);
      }
      try {
        const rows = await fetchParties();
        const merged = created?.id && !rows.some((party) => party.id === created.id)
          ? [created, ...rows]
          : rows;
        setParties(merged);
        if (created?.id) {
          setSelectedId(created.id);
          setDetail(created);
        }
      } catch (refreshError) {
        setError(refreshError.message);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setRegistering(false);
    }
  }

  function renderActiveTab(party) {
    if (activeTab === 'identifiers') {
      return (
        <section id="panel-identifiers" role="tabpanel" aria-labelledby="tab-identifiers">
          <div className="eia-section-title" style={{ marginTop: 0 }}>
            <h2>Identifiers</h2>
            <span className="eia-badge warn">Not available</span>
          </div>
          <p className="eia-muted" style={{ marginTop: 0 }}>
            The Party API exposes core party fields only in this release. Tax identifiers, registration
            numbers, and LEIs cannot be read or maintained here yet.
          </p>
          <div className="eia-table-wrap">
            <table className="eia-table">
              <thead>
                <tr>
                  <th>Identifier</th>
                  <th>Value</th>
                  <th>Issued by</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="eia-muted" colSpan={4}>
                    No identifier endpoint is available in this release.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      );
    }

    if (activeTab === 'names') {
      return (
        <section id="panel-names" role="tabpanel" aria-labelledby="tab-names">
          <div className="eia-section-title" style={{ marginTop: 0 }}>
            <h2>Names</h2>
            <span className="eia-badge ok">Core fields</span>
          </div>
          <div className="eia-table-wrap">
            <table className="eia-table">
              <thead>
                <tr>
                  <th>Name type</th>
                  <th>Value</th>
                  <th>Source field</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Display name</td>
                  <td>{party.displayName || '—'}</td>
                  <td><code className="eia-mono">displayName</code></td>
                </tr>
                <tr>
                  <td>Legal name</td>
                  <td>{party.legalName || '—'}</td>
                  <td><code className="eia-mono">legalName</code></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="eia-section-title">
            <h2>Addresses</h2>
            <span className="eia-badge warn">Not available</span>
          </div>
          <p className="eia-muted" style={{ marginTop: 0 }}>
            Address records are not exposed by the Party API in this release.
          </p>
          <div className="eia-table-wrap">
            <table className="eia-table">
              <thead>
                <tr>
                  <th>Address type</th>
                  <th>Line 1</th>
                  <th>City</th>
                  <th>Country</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="eia-muted" colSpan={4}>
                    No address endpoint is available in this release.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      );
    }

    if (activeTab === 'activity') {
      return (
        <section id="panel-activity" role="tabpanel" aria-labelledby="tab-activity">
          <div className="eia-section-title" style={{ marginTop: 0 }}>
            <h2>Activity</h2>
            <span className="eia-badge warn">Not available</span>
          </div>
          <p className="eia-muted" style={{ marginTop: 0 }}>
            No activity or audit-history endpoint is exposed by the Party API in this release. The
            record&apos;s created and updated timestamps are shown on Overview.
          </p>
          <div className="eia-table-wrap">
            <table className="eia-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="eia-muted" colSpan={3}>
                    No activity endpoint is available in this release.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      );
    }

    return (
      <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
        <div className="eia-grid eia-grid-2">
          <section className="eia-card" aria-label="Party identity">
            <h3>Party identity</h3>
            <dl className="eia-kv">
              <dt>Party number</dt>
              <dd className="eia-mono" data-testid="overview-party-number">{party.partyNumber || '—'}</dd>
              <dt>Display name</dt>
              <dd>{party.displayName || '—'}</dd>
              <dt>Legal name</dt>
              <dd>{party.legalName || '—'}</dd>
              <dt>Party type</dt>
              <dd>{party.partyType || '—'}</dd>
              <dt>Status</dt>
              <dd>
                <span className={`eia-pill ${statusTone(party.status)}`}>{party.status || '—'}</span>
              </dd>
              <dt>Sanctions</dt>
              <dd>
                <span className={`eia-pill ${sanctionsTone(party.sanctionsStatus)}`}>
                  {party.sanctionsStatus || '—'}
                </span>
              </dd>
              <dt>Confidentiality</dt>
              <dd>
                <span className={`eia-pill ${confidentialityTone(party.confidentiality)}`}>
                  {party.confidentiality || '—'}
                </span>
              </dd>
            </dl>
          </section>

          <section className="eia-card" aria-label="Record metadata">
            <h3>Record metadata</h3>
            <dl className="eia-kv">
              <dt>Party ID</dt>
              <dd className="eia-mono">{party.id || '—'}</dd>
              <dt>Tenant ID</dt>
              <dd className="eia-mono">{party.tenantId || TENANT}</dd>
              <dt>Version</dt>
              <dd>{party.version ?? '—'}</dd>
              <dt>Created</dt>
              <dd>{formatTimestamp(party.createdAt)}</dd>
              <dt>Updated</dt>
              <dd>{formatTimestamp(party.updatedAt)}</dd>
            </dl>
          </section>
        </div>

        <section className="eia-card" aria-label="API coverage" style={{ marginTop: 14 }}>
          <h3>Available operations</h3>
          <p style={{ margin: '8px 0 0' }}>
            This release supports listing and reading party records and registering new parties. Status
            transitions, identifiers, addresses, and activity history are not exposed by the Party API yet,
            so those sections are marked unavailable instead of showing derived or placeholder data.
          </p>
        </section>
      </section>
    );
  }

  return (
    <main>
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Party · Shared master data</div>
          <h1>Party</h1>
          <p className="subtitle">
            Shared party master data for the direct and assumed books: identity, classification,
            sanctions screening, and confidentiality. Book associations remain book-scoped.
          </p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge" title="Shared master data across books">SHARED</span>
          <button type="button" className="eia-btn-ghost" onClick={refreshWorkspace} disabled={loading}>
            Refresh
          </button>
          <button type="button" onClick={openRegister} aria-haspopup="dialog">
            Register party
          </button>
        </div>
      </header>

      {notice && <p role="status" style={{ margin: '0 0 12px' }}>{notice}</p>}
      {error && !registerOpen && <p role="alert" style={{ margin: '0 0 12px' }}>{error}</p>}

      <div className="eia-record-layout">
        <aside className="eia-record-list" aria-label="Party register">
          <div className="eia-record-list-head">
            <strong>Party register</strong>
            <span className="eia-muted">{loading ? '…' : parties.length}</span>
          </div>
          {parties.map((party) => {
            const isSelected = party.id === selectedId;
            return (
              <button
                key={party.id}
                type="button"
                className={isSelected ? 'selected' : ''}
                aria-pressed={isSelected}
                aria-label={`Open record ${party.partyNumber}`}
                onClick={() => selectParty(party.id)}
              >
                <span className="record-primary">{party.partyNumber}</span>
                <span className="record-secondary">{party.displayName}</span>
                <span
                  className="record-secondary"
                  style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <span className="eia-badge">{party.partyType || '—'}</span>
                  <span className={`eia-pill ${statusTone(party.status)}`}>{party.status || '—'}</span>
                </span>
              </button>
            );
          })}
          {!loading && parties.length === 0 && (
            <div className="empty">No parties yet. Register the first shared party.</div>
          )}
          {loading && parties.length === 0 && <div className="empty">Loading parties…</div>}
        </aside>

        <section className="eia-record-panel" aria-label="Party record">
          {selectedParty ? (
            <>
              <div className="eia-record-title">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h2 className="eia-mono" data-testid="party-number">{selectedParty.partyNumber}</h2>
                    <span className="eia-badge" data-testid="party-type">
                      {selectedParty.partyType || '—'}
                    </span>
                    <span
                      className={`eia-pill ${statusTone(selectedParty.status)}`}
                      data-testid="party-status"
                    >
                      {selectedParty.status || '—'}
                    </span>
                  </div>
                  <p className="eia-record-subtitle">
                    <span data-testid="party-name">{selectedParty.displayName}</span>
                    {' · '}
                    Shared master record
                    {detailLoading ? ' · Loading record…' : ''}
                  </p>
                </div>
                <div className="eia-actions">
                  <button
                    type="button"
                    className="eia-btn-ghost"
                    onClick={refreshWorkspace}
                    disabled={loading}
                  >
                    Refresh record
                  </button>
                </div>
              </div>

              <div className="eia-summary-grid">
                <div className="eia-card">
                  <h3>Party type</h3>
                  <div className="value" data-testid="summary-party-type">{selectedParty.partyType || '—'}</div>
                  <div className="eia-metric-label">Classification</div>
                </div>
                <div className="eia-card">
                  <h3>Status</h3>
                  <div className="value" data-testid="summary-status">{selectedParty.status || '—'}</div>
                  <div className="eia-metric-label">Lifecycle state</div>
                </div>
                <div className="eia-card">
                  <h3>Sanctions</h3>
                  <div className="value" data-testid="summary-sanctions">
                    {selectedParty.sanctionsStatus || '—'}
                  </div>
                  <div className="eia-metric-label">Screening status</div>
                </div>
                <div className="eia-card">
                  <h3>Confidentiality</h3>
                  <div className="value" data-testid="summary-confidentiality">
                    {selectedParty.confidentiality || '—'}
                  </div>
                  <div className="eia-metric-label">Access classification</div>
                </div>
              </div>

              <nav className="eia-tabs" role="tablist" aria-label="Party sections">
                {TABS.map((entry) => (
                  <button
                    key={entry.id}
                    id={`tab-${entry.id}`}
                    type="button"
                    role="tab"
                    className={`eia-tab${activeTab === entry.id ? ' active' : ''}`}
                    aria-selected={activeTab === entry.id}
                    aria-controls={`panel-${entry.id}`}
                    onClick={() => setActiveTab(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </nav>

              {renderActiveTab(selectedParty)}
            </>
          ) : (
            <div className="eia-empty">
              <p style={{ marginTop: 0 }}>
                {loading
                  ? 'Loading the shared party register…'
                  : 'Select a party from the register or register the first shared party.'}
              </p>
              {!loading && (
                <button type="button" onClick={openRegister} aria-haspopup="dialog">
                  Register party
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {registerOpen && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !registering) closeRegister();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-title"
            className="eia-card"
            style={DIALOG_STYLE}
          >
            <div className="eia-record-title">
              <div>
                <h2 id="register-title" style={{ margin: 0 }}>Register party</h2>
                <p className="eia-record-subtitle">
                  Creates a shared party record. The service assigns the party number; new parties start
                  as PROSPECT with sanctions NOT_SCREENED and INTERNAL confidentiality.
                </p>
              </div>
              <button
                type="button"
                className="eia-btn-ghost"
                onClick={closeRegister}
                disabled={registering}
              >
                Close
              </button>
            </div>

            <form className="eia-form-grid" onSubmit={submit} style={{ marginTop: 16 }}>
              <Field label="Party type">
                <select
                  id="party-type"
                  value={form.partyType}
                  onChange={(event) => updateField(setForm, 'partyType', event.target.value)}
                  required
                >
                  {PARTY_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Display name" className="span-2">
                <input
                  id="display-name"
                  value={form.displayName}
                  onChange={(event) => updateField(setForm, 'displayName', event.target.value)}
                  placeholder="e.g. Acme Manufacturing"
                  maxLength={300}
                  autoFocus
                  required
                />
              </Field>
              <Field label="Legal name" className="span-3">
                <input
                  id="legal-name"
                  value={form.legalName}
                  onChange={(event) => updateField(setForm, 'legalName', event.target.value)}
                  placeholder="Registered legal entity or person name"
                  maxLength={300}
                  required
                />
              </Field>

              <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeRegister}
                  disabled={registering}
                >
                  Cancel
                </button>
                <button type="submit" disabled={registering}>
                  {registering ? 'Registering…' : 'Register party'}
                </button>
              </div>
            </form>

            {error && <p role="alert" style={{ margin: '10px 0 0' }}>{error}</p>}
          </section>
        </div>
      )}
    </main>
  );
}
