import React, { useEffect, useRef, useState } from 'react';
import Field from './Field.jsx';
import { api } from './api.js';
import { formatTimestamp } from './format.js';
import {
  EMPTY_IDENTIFIER_FORM,
  IDENTIFIER_TYPES,
  identifierEndpoint,
  identifierErrorText,
  identifierFromResponse,
  identifierRows,
  identifierPayload,
  validateIdentifier
} from './masterData.js';

const CONTEXT_TEXT = 'Identifiers are party master data. Claims, policies, and payments reference '
  + 'them for tax reporting, licensing, and payee matching, so a correction here applies to every '
  + 'linked record.';

/**
 * The Identifiers tab owns its list and add form. A list failure, a validation
 * error, or a duplicate 409 stays inside this section; the party record and the
 * other tabs never depend on it.
 */
export default function IdentifiersPanel({ partyId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(EMPTY_IDENTIFIER_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const requestRef = useRef(0);

  async function loadIdentifiers() {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setLoadError('');
    try {
      const body = await api(identifierEndpoint(partyId));
      if (requestId !== requestRef.current) return;
      setItems(identifierRows(body));
    } catch {
      if (requestId !== requestRef.current) return;
      setItems([]);
      setLoadError('Identifiers are temporarily unavailable.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    setItems([]);
    setForm(EMPTY_IDENTIFIER_FORM);
    setFieldErrors({});
    setFormError('');
    setNotice('');
    loadIdentifiers();
    return () => {
      requestRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError('');
    setNotice('');
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const errors = validateIdentifier(form);
    setFieldErrors(errors);
    setFormError('');
    setNotice('');
    if (Object.keys(errors).length > 0) {
      setFormError('Fix the highlighted fields before adding this identifier.');
      return;
    }

    setSaving(true);
    try {
      const body = await api(identifierEndpoint(partyId), {
        method: 'POST',
        body: identifierPayload(form)
      });
      const created = identifierFromResponse(body, form);
      setItems((current) => [...current, created]);
      setLoadError('');
      setForm(EMPTY_IDENTIFIER_FORM);
      setFieldErrors({});
      setNotice('Identifier added.');
    } catch (cause) {
      setFormError(identifierErrorText(cause));
    } finally {
      setSaving(false);
    }
  }

  const countLabel = loading
    ? '…'
    : `${items.length} ${items.length === 1 ? 'identifier' : 'identifiers'}`;

  return (
    <section
      id="panel-identifiers"
      role="tabpanel"
      aria-labelledby="tab-identifiers"
      data-testid="party-identifiers"
    >
      <div className="eia-section-title" style={{ marginTop: 0 }}>
        <h2>Identifiers</h2>
        <div className="eia-actions">
          <span className="eia-badge" data-testid="identifiers-count">{countLabel}</span>
          <button
            type="button"
            className="eia-btn-secondary"
            onClick={loadIdentifiers}
            disabled={loading}
            aria-label="Refresh identifiers"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <p className="eia-muted" style={{ marginTop: 0 }} data-testid="identifiers-context">
        {CONTEXT_TEXT}
      </p>

      {loading ? (
        <p className="eia-muted" data-testid="identifiers-loading" style={{ margin: '8px 0 0' }}>
          Loading identifiers…
        </p>
      ) : loadError ? (
        <p className="eia-muted" data-testid="identifiers-error" style={{ margin: '8px 0 0' }}>
          {loadError}
        </p>
      ) : items.length === 0 ? (
        <div className="eia-empty" data-testid="identifiers-empty">
          No identifiers are recorded for this party yet.
        </div>
      ) : (
        <div className="eia-table-wrap">
          <table className="eia-table" aria-label="Party identifiers">
            <thead>
              <tr>
                <th>Type</th>
                <th>Value</th>
                <th>Issuing authority</th>
                <th>Effective date</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr
                  key={item.id || `identifier-row-${index}`}
                  data-testid="identifier-row"
                  data-identifier-id={item.id}
                >
                  <td data-testid="identifier-type">{item.identifierType || '—'}</td>
                  <td
                    className="eia-mono"
                    data-testid="identifier-value"
                    title={item.value || undefined}
                  >
                    {item.value || '—'}
                  </td>
                  <td data-testid="identifier-authority">{item.issuingAuthority || '—'}</td>
                  <td data-testid="identifier-effective">{item.effectiveDate || '—'}</td>
                  <td data-testid="identifier-created">{formatTimestamp(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="eia-card" aria-label="Add identifier" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Add identifier</h3>
        <form
          className="eia-form-grid"
          data-testid="identifier-form"
          onSubmit={submit}
          noValidate
          style={{ marginTop: 12 }}
        >
          <Field label="Identifier type" error={fieldErrors.identifierType}>
            <select
              id="identifier-type"
              value={form.identifierType}
              onChange={(event) => update('identifierType', event.target.value)}
              aria-invalid={fieldErrors.identifierType ? 'true' : undefined}
            >
              <option value="">Select identifier type…</option>
              {IDENTIFIER_TYPES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>

          <Field label="Value" className="span-2" error={fieldErrors.value}>
            <input
              id="identifier-value"
              value={form.value}
              onChange={(event) => update('value', event.target.value)}
              placeholder="e.g. 12-3456789"
              maxLength={128}
              autoComplete="off"
              aria-invalid={fieldErrors.value ? 'true' : undefined}
            />
          </Field>

          <Field label="Issuing authority" className="span-2" error={fieldErrors.issuingAuthority}>
            <input
              id="identifier-issuing-authority"
              value={form.issuingAuthority}
              onChange={(event) => update('issuingAuthority', event.target.value)}
              placeholder="e.g. Internal Revenue Service"
              maxLength={160}
              autoComplete="off"
              aria-invalid={fieldErrors.issuingAuthority ? 'true' : undefined}
            />
          </Field>

          <Field label="Effective date" error={fieldErrors.effectiveDate}>
            <input
              id="identifier-effective-date"
              type="date"
              value={form.effectiveDate}
              onChange={(event) => update('effectiveDate', event.target.value)}
              aria-invalid={fieldErrors.effectiveDate ? 'true' : undefined}
            />
          </Field>

          <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" disabled={saving}>
              {saving ? 'Adding…' : 'Add identifier'}
            </button>
          </div>
        </form>

        {formError && (
          <p
            className="eia-form-error"
            role="alert"
            data-testid="identifier-form-error"
            style={{ margin: '10px 0 0' }}
          >
            {formError}
          </p>
        )}
        {notice && (
          <p
            className="eia-form-notice"
            role="status"
            data-testid="identifier-notice"
            style={{ margin: '10px 0 0' }}
          >
            {notice}
          </p>
        )}
      </section>
    </section>
  );
}
