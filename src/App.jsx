import React, { useEffect, useRef, useState } from 'react';
import './ui.css';
import ActivityTimeline from './ActivityTimeline.jsx';
import { activityEndpoint, eventItems, sortActivityEvents } from './events.js';
import { navigate, recordHref } from './navigation.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const RELATED_LIMIT = 5;
const POLICY_LIMIT = 5;
const QUEUE_FILTER_PLACEHOLDER = 'Filter parties by number, name, type, or status…';

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

function policyStatusTone(status) {
  if (['IN_FORCE', 'ISSUED', 'REINSTATED'].includes(status)) return 'green';
  if (['CANCELLED', 'EXPIRED', 'NON_RENEWED', 'VOID'].includes(status)) return 'red';
  if (['DRAFT', 'QUOTED'].includes(status)) return 'amber';
  return 'blue';
}

function documentStatusTone(status) {
  if (['ACTIVE', 'CLASSIFIED'].includes(status)) return 'green';
  if (['REJECTED', 'FAILED', 'DISPOSED'].includes(status)) return 'red';
  if (['PENDING_UPLOAD', 'RECEIVED', 'SCANNING', 'PROCESSING', 'ON_HOLD'].includes(status)) {
    return 'amber';
  }
  return 'blue';
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

function readUrlState() {
  if (typeof window === 'undefined') return { record: '', create: false };
  const params = new URLSearchParams(window.location.search);
  return { record: (params.get('record') || '').trim(), create: params.get('new') === '1' };
}

/**
 * The remote is mounted either at the shell route (/party) or directly at the
 * dev-server root (/). Only treat the URL as party state on those routes, so a
 * cross-link to /policy or /direct-claims is not read as a party id.
 */
function isPartyRoute() {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' || path === '/index.html' || path === '/party' || path.endsWith('/party');
}

function writeUrl({ record = '', create = false, replace = false } = {}) {
  if (typeof window === 'undefined' || !isPartyRoute()) return;
  const params = new URLSearchParams();
  if (record) params.set('record', record);
  if (create) params.set('new', '1');
  const query = params.toString();
  const target = `${window.location.pathname}${query ? `?${query}` : ''}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (target === current) return;
  try {
    if (replace) window.history.replaceState({}, '', target);
    else window.history.pushState({}, '', target);
  } catch {
    // URL state is an enhancement; queue selection still works without it.
  }
}

function filterParties(rows, filter) {
  const term = filter.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter((party) => [
    party.partyNumber,
    party.displayName,
    party.legalName,
    party.partyType,
    party.status,
    party.sanctionsStatus
  ].some((value) => String(value || '').toLowerCase().includes(term)));
}

function relatedHref(item, basePath) {
  const href = item?.href;
  if (typeof href === 'string' && href.startsWith('/')) return href;
  return recordHref(basePath, item?.id);
}

function CrossLink({ href, className, title, children }) {
  return (
    <a
      href={href}
      className={className}
      title={title}
      onClick={(event) => {
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

async function api(path, options = {}) {
  const headers = { 'X-EIA-Tenant': TENANT };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.book) headers['X-EIA-Book'] = options.book;
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
  const [queueFilter, setQueueFilter] = useState('');
  const [related, setRelated] = useState({ claims: [], loading: false, error: '' });
  const [policies, setPolicies] = useState({ items: [], loading: false, error: '' });
  const [documents, setDocuments] = useState({ items: [], loading: false, error: '' });
  const [activity, setActivity] = useState({ items: [], loading: false, error: '' });
  const detailRequest = useRef(0);
  const relatedRequest = useRef(0);
  const policyRequest = useRef(0);
  const documentRequest = useRef(0);
  const activityRequest = useRef(0);
  const partiesRef = useRef([]);
  const applyingUrlRef = useRef(false);
  const registerOpenRef = useRef(false);

  const normalizedQueueFilter = queueFilter.trim().toLowerCase();
  const filterActive = normalizedQueueFilter.length > 0;
  const visibleParties = filterActive ? filterParties(parties, queueFilter) : parties;

  const selectedParty = detail && detail.id === selectedId
    ? detail
    : parties.find((party) => party.id === selectedId) || null;

  useEffect(() => {
    partiesRef.current = parties;
  }, [parties]);

  useEffect(() => {
    registerOpenRef.current = registerOpen;
  }, [registerOpen]);

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

  async function loadRelated(partyId) {
    const requestId = relatedRequest.current + 1;
    relatedRequest.current = requestId;
    if (!partyId) {
      setRelated({ claims: [], loading: false, error: '' });
      return;
    }
    setRelated({ claims: [], loading: true, error: '' });
    try {
      const body = await api(
        `/api/v1/claims/search?q=${encodeURIComponent(partyId)}&limit=${RELATED_LIMIT}`,
        { book: 'DIRECT' }
      );
      if (requestId !== relatedRequest.current) return;
      const items = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []);
      setRelated({ claims: items, loading: false, error: '' });
    } catch (e) {
      if (requestId !== relatedRequest.current) return;
      setRelated({
        claims: [],
        loading: false,
        error: e.message || 'Related records are temporarily unavailable.'
      });
    }
  }

  /**
   * Policy lookups are a read-only cross-link: a failure is kept in its own
   * state so the party record and the claims lookup stay usable.
   */
  async function loadPolicies(partyId) {
    const requestId = policyRequest.current + 1;
    policyRequest.current = requestId;
    if (!partyId) {
      setPolicies({ items: [], loading: false, error: '' });
      return;
    }
    setPolicies({ items: [], loading: true, error: '' });
    try {
      const body = await api(
        `/api/v1/policies?insuredPartyId=${encodeURIComponent(partyId)}`
          + `&page=0&size=${POLICY_LIMIT}`,
        { book: 'DIRECT' }
      );
      if (requestId !== policyRequest.current) return;
      const items = Array.isArray(body?.items) ? body.items : [];
      setPolicies({ items, loading: false, error: '' });
    } catch (e) {
      if (requestId !== policyRequest.current) return;
      setPolicies({
        items: [],
        loading: false,
        error: e.message || 'Policy links are temporarily unavailable.'
      });
    }
  }

  function loadLinks(partyId) {
    loadRelated(partyId);
    loadPolicies(partyId);
    loadDocuments(partyId);
    loadActivity(partyId);
  }

  /**
   * The activity timeline is derived from the platform event stream, not from
   * the party aggregate. It loads as soon as a party is selected but stays
   * card-local: an unavailable event service never blocks the party record.
   */
  async function loadActivity(partyId) {
    const requestId = activityRequest.current + 1;
    activityRequest.current = requestId;
    if (!partyId) {
      setActivity({ items: [], loading: false, error: '' });
      return;
    }
    setActivity({ items: [], loading: true, error: '' });
    try {
      const body = await api(activityEndpoint(partyId));
      if (requestId !== activityRequest.current) return;
      setActivity({
        items: sortActivityEvents(eventItems(body)),
        loading: false,
        error: ''
      });
    } catch {
      if (requestId !== activityRequest.current) return;
      setActivity({
        items: [],
        loading: false,
        error: 'Activity timeline is temporarily unavailable.'
      });
    }
  }

  /**
   * Linked documents are evidence, not party master data. The lookup keeps its
   * own state so a failure never blocks the party record or the other cards.
   */
  async function loadDocuments(partyId) {
    const requestId = documentRequest.current + 1;
    documentRequest.current = requestId;
    if (!partyId) {
      setDocuments({ items: [], loading: false, error: '' });
      return;
    }
    setDocuments({ items: [], loading: true, error: '' });
    try {
      const body = await api(
        `/api/v1/documents?linkedType=PARTY&linkedId=${encodeURIComponent(partyId)}`
      );
      if (requestId !== documentRequest.current) return;
      const items = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []);
      setDocuments({ items, loading: false, error: '' });
    } catch {
      if (requestId !== documentRequest.current) return;
      setDocuments({
        items: [],
        loading: false,
        error: 'Document links are temporarily unavailable.'
      });
    }
  }

  function clearRelated() {
    relatedRequest.current += 1;
    policyRequest.current += 1;
    documentRequest.current += 1;
    activityRequest.current += 1;
    setRelated({ claims: [], loading: false, error: '' });
    setPolicies({ items: [], loading: false, error: '' });
    setDocuments({ items: [], loading: false, error: '' });
    setActivity({ items: [], loading: false, error: '' });
  }

  /**
   * Applies ?record= and ?new=1. The record is selected immediately when it is
   * already in the queue; otherwise the detail endpoint is fetched so a
   * deep-linked party still opens even when it is not in the loaded list.
   */
  async function applyUrlState(rows = partiesRef.current, { initial = false } = {}) {
    if (!isPartyRoute()) return;
    const { record, create } = readUrlState();
    if (create) {
      if (!registerOpenRef.current) setForm(EMPTY_FORM);
      setRegisterOpen(true);
    } else if (!initial) {
      setRegisterOpen(false);
    }

    if (!record) {
      if (create) return;
      if (rows.length === 0) {
        setSelectedId(null);
        setDetail(null);
        clearRelated();
        return;
      }
      const target = rows[0];
      setSelectedId(target.id);
      setDetail(null);
      setActiveTab('overview');
      await loadDetail(target.id);
      loadLinks(target.id);
      return;
    }

    if (applyingUrlRef.current) return;
    const known = rows.find((party) => party.id === record || party.partyNumber === record);
    if (known) {
      setSelectedId(known.id);
      setDetail(null);
      setActiveTab('overview');
      setError('');
      await loadDetail(known.id);
      loadLinks(known.id);
      return;
    }

    applyingUrlRef.current = true;
    try {
      const recordData = await api(`/api/v1/parties/${encodeURIComponent(record)}`);
      if (!recordData?.id) return;
      setSelectedId(recordData.id);
      setDetail(recordData);
      setParties((current) => {
        const next = current.some((party) => party.id === recordData.id)
          ? current
          : [recordData, ...current];
        partiesRef.current = next;
        return next;
      });
      setActiveTab('overview');
      setError('');
      loadLinks(recordData.id);
    } catch (e) {
      setSelectedId(null);
      setDetail(null);
      setError(`Party “${record}” could not be loaded: ${e.message}`);
      clearRelated();
    } finally {
      applyingUrlRef.current = false;
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function initialise() {
      try {
        const rows = await fetchParties();
        if (cancelled) return;
        partiesRef.current = rows;
        setParties(rows);
        await applyUrlState(rows, { initial: true });
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const onPopState = () => {
      applyUrlState(partiesRef.current).catch((e) => setError(e.message));
    };

    window.addEventListener('popstate', onPopState);
    initialise();

    return () => {
      cancelled = true;
      window.removeEventListener('popstate', onPopState);
      detailRequest.current += 1;
      relatedRequest.current += 1;
      policyRequest.current += 1;
      documentRequest.current += 1;
      activityRequest.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!registerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !registering) {
        setRegisterOpen(false);
        setError('');
        writeUrl({ record: selectedId || '' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [registerOpen, registering, selectedId]);

  function selectParty(partyId) {
    if (!partyId) return;
    writeUrl({ record: partyId });
    if (partyId === selectedId) return;
    setSelectedId(partyId);
    setDetail(null);
    setActiveTab('overview');
    setError('');
    setNotice('');
    loadDetail(partyId);
    loadLinks(partyId);
  }

  async function refreshWorkspace() {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const rows = await fetchParties();
      partiesRef.current = rows;
      setParties(rows);
      const target = rows.find((party) => party.id === selectedId) || rows[0] || null;
      if (!target) {
        setSelectedId(null);
        setDetail(null);
        clearRelated();
        return;
      }
      if (target.id !== selectedId) {
        setSelectedId(target.id);
        setDetail(null);
      }
      await loadDetail(target.id, { silent: true });
      loadLinks(target.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function openRegister() {
    setForm(EMPTY_FORM);
    setError('');
    setNotice('');
    setRegisterOpen(true);
    writeUrl({ record: selectedId || '', create: true });
  }

  function closeRegister() {
    if (registering) return;
    setRegisterOpen(false);
    setError('');
    writeUrl({ record: selectedId || '' });
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
        setParties((current) => {
          const next = [created, ...current.filter((party) => party.id !== created.id)];
          partiesRef.current = next;
          return next;
        });
        writeUrl({ record: created.id });
        loadLinks(created.id);
      }
      try {
        const rows = await fetchParties();
        const merged = created?.id && !rows.some((party) => party.id === created.id)
          ? [created, ...rows]
          : rows;
        partiesRef.current = merged;
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
            <span className="eia-muted">Newest first · derived from party events</span>
          </div>
          <ActivityTimeline
            items={activity.items}
            loading={activity.loading}
            error={activity.error}
            onRefresh={() => loadActivity(party.id)}
          />
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

        <section
          className="eia-card"
          aria-label="Policies for this party"
          data-testid="party-policies"
          style={{ marginTop: 14 }}
        >
          <div className="eia-section-title" style={{ marginTop: 0 }}>
            <h3>Policies for this party</h3>
            <span className="eia-badge" title="Direct-book policies">DIRECT</span>
          </div>
          {policies.loading ? (
            <p className="eia-muted" style={{ margin: '8px 0 0' }}>Loading policies…</p>
          ) : policies.error ? (
            <p className="eia-muted" style={{ margin: '8px 0 0' }}>
              Policy links are unavailable right now.
            </p>
          ) : policies.items.length === 0 ? (
            <p className="eia-muted" style={{ margin: '8px 0 0' }}>
              No direct policies reference this party.
            </p>
          ) : (
            <div className="eia-table-wrap">
              <table className="eia-table">
                <thead>
                  <tr>
                    <th>Policy number</th>
                    <th>Product</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <CrossLink
                          className="eia-mono"
                          href={`/policy?record=${encodeURIComponent(item.id)}`}
                          title={`Open policy ${item.policyNumber || item.id}`}
                        >
                          {item.policyNumber || 'Policy'}
                        </CrossLink>
                      </td>
                      <td>{item.productCode || '—'}</td>
                      <td>
                        <span className={`eia-pill ${policyStatusTone(item.status)}`}>
                          {item.status || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section
          className="eia-card"
          aria-label="Documents for this party"
          data-testid="party-documents"
          style={{ marginTop: 14 }}
        >
          <div className="eia-section-title" style={{ marginTop: 0 }}>
            <h3>Documents</h3>
            <span className="eia-badge" data-testid="party-documents-count">
              {documents.loading
                ? '…'
                : `${documents.items.length} ${documents.items.length === 1 ? 'document' : 'documents'}`}
            </span>
          </div>
          <p
            className="eia-muted"
            style={{ margin: '4px 0 0' }}
            data-testid="documents-evidence-note"
          >
            Documents are evidence, not business facts. Open a document in the Document workspace to
            review its content and links.
          </p>
          {documents.loading ? (
            <p className="eia-muted" style={{ margin: '8px 0 0' }}>Loading documents…</p>
          ) : documents.error ? (
            <p className="eia-muted" style={{ margin: '8px 0 0' }}>{documents.error}</p>
          ) : documents.items.length === 0 ? (
            <p className="eia-muted" style={{ margin: '8px 0 0' }}>
              No documents are linked to this party.
            </p>
          ) : (
            <div className="eia-table-wrap" style={{ marginTop: 10 }}>
              <table className="eia-table">
                <thead>
                  <tr>
                    <th>Document number</th>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.items.map((item, index) => (
                    <tr key={item.id || item.documentNumber || `document-${index}`}>
                      <td>
                        {item.id ? (
                          <CrossLink
                            className="eia-mono"
                            href={`/document?record=${encodeURIComponent(item.id)}`}
                            title={`Open document ${item.documentNumber || item.id}`}
                          >
                            {item.documentNumber || 'Document'}
                          </CrossLink>
                        ) : (item.documentNumber || '—')}
                      </td>
                      <td>{item.title || '—'}</td>
                      <td>{item.documentType || item.type || '—'}</td>
                      <td>
                        <span className={`eia-pill ${documentStatusTone(item.status)}`}>
                          {item.status || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="eia-card" aria-label="API coverage" style={{ marginTop: 14 }}>
          <h3>Available operations</h3>
          <p style={{ margin: '8px 0 0' }}>
            This release supports listing and reading party records, registering new parties, and
            reading the event-derived activity timeline. Status transitions, identifiers, and
            addresses are not exposed by the Party API yet, so those sections are marked unavailable
            instead of showing derived or placeholder data.
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
            sanctions screening, and confidentiality. Policies, claims, and contracts keep their own
            book scope.
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div className="eia-queue-search" role="search" aria-label="Filter the party queue">
            <div className="eia-search-box">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={queueFilter}
                onChange={(event) => setQueueFilter(event.target.value)}
                placeholder={QUEUE_FILTER_PLACEHOLDER}
                aria-label="Filter parties"
                autoComplete="off"
              />
              {filterActive && (
                <button
                  type="button"
                  className="eia-queue-clear"
                  onClick={() => setQueueFilter('')}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <aside className="eia-record-list" aria-label="Party register">
            <div className="eia-record-list-head">
              <strong>Party register</strong>
              <span className="eia-muted">
                {loading ? '…' : filterActive ? `${visibleParties.length} of ${parties.length}` : parties.length}
              </span>
            </div>
            {visibleParties.map((party) => {
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
            {!loading && parties.length > 0 && visibleParties.length === 0 && (
              <div className="empty">No matching parties</div>
            )}
            {loading && parties.length === 0 && <div className="empty">Loading parties…</div>}
          </aside>
        </div>

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

              <div className="eia-context-panel" aria-label="Why this matters" data-testid="why-this-matters">
                <h4>Why this matters</h4>
                <p>
                  Party is shared master data across both books: the same identity is referenced by
                  direct policies and claims and by assumed contracts and claims. Book associations
                  remain book-scoped — this record does not belong to either book. Status and sanctions
                  are process gates: an inactive, blocked, restricted, or unsanctioned party can stop
                  downstream processing until it is cleared.
                </p>
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

              <section
                className="eia-card"
                aria-label="Related records"
                data-testid="related-records"
                style={{ marginTop: 14 }}
              >
                <h3>Related records</h3>
                <p className="eia-muted" style={{ margin: '4px 0 0' }}>
                  Direct-book records that reference this shared party.
                </p>
                {related.loading ? (
                  <p className="eia-muted" style={{ margin: '8px 0 0' }}>Loading related records…</p>
                ) : (
                  <>
                    {related.error && (
                      <p className="eia-muted" style={{ margin: '8px 0 0' }}>{related.error}</p>
                    )}
                    <div className="eia-related-group-label">Direct claims</div>
                    {related.claims.length === 0 ? (
                      <p className="eia-muted" style={{ margin: '8px 0 0' }}>
                        {related.error
                          ? 'Claim links are unavailable right now.'
                          : 'No direct claims reference this party.'}
                      </p>
                    ) : (
                      <div className="eia-related-list">
                        {related.claims.map((item, index) => {
                          const href = relatedHref(item, 'direct-claims');
                          return (
                            <CrossLink
                              key={item.id || item.href || `related-claim-${index}`}
                              className="eia-related-record"
                              href={href}
                              title={item.secondary}
                            >
                              <b>{item.label}</b>
                              {item.status ? <span>{item.status}</span> : null}
                            </CrossLink>
                          );
                        })}
                      </div>
                    )}
                    <div className="eia-related-group-label">Policies</div>
                    <div className="eia-related-list">
                      <CrossLink
                        className="eia-related-record"
                        href="/policy"
                        title="Search direct policies"
                      >
                        <b>Policy search</b>
                      </CrossLink>
                    </div>
                  </>
                )}
              </section>
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
