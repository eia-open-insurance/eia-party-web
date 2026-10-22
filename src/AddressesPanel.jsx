import React, { useEffect, useRef, useState } from 'react';
import Field from './Field.jsx';
import { api } from './api.js';
import {
  ADDRESS_TYPES,
  EMPTY_ADDRESS_FORM,
  addressChildEndpoint,
  addressDeleteConfirmation,
  addressEndpoint,
  addressErrorText,
  addressFormFromRow,
  addressFromResponse,
  addressPayload,
  addressRows,
  validateAddress
} from './masterData.js';

const CONTEXT_TEXT = 'Addresses are party master data. Policies, claims, and payments use them for '
  + 'mailing, rating, and remittance, so keeping the lines current here keeps every linked record '
  + 'consistent.';

/**
 * The Addresses section lives inside the Names & Addresses tab. Its list and
 * add form contain their own loading, validation, and conflict state, so an
 * unavailable address service never blocks the party record or the names.
 */
export default function AddressesPanel({ partyId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(EMPTY_ADDRESS_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [actionError, setActionError] = useState('');
  const requestRef = useRef(0);

  async function loadAddresses() {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setLoadError('');
    try {
      const body = await api(addressEndpoint(partyId));
      if (requestId !== requestRef.current) return;
      setItems(addressRows(body));
    } catch {
      if (requestId !== requestRef.current) return;
      setItems([]);
      setLoadError('Addresses are temporarily unavailable.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    setItems([]);
    setForm(EMPTY_ADDRESS_FORM);
    setFieldErrors({});
    setFormError('');
    setNotice('');
    setEditingId('');
    setDeletingId('');
    setActionError('');
    loadAddresses();
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
    setActionError('');
    setNotice('');
  }

  function startEdit(item) {
    setEditingId(item.id);
    setForm(addressFormFromRow(item));
    setFieldErrors({});
    setFormError('');
    setActionError('');
    setNotice('');
  }

  function cancelEdit() {
    setEditingId('');
    setForm(EMPTY_ADDRESS_FORM);
    setFieldErrors({});
    setFormError('');
    setActionError('');
    setNotice('');
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const editing = Boolean(editingId);
    const errors = validateAddress(form);
    setFieldErrors(errors);
    setFormError('');
    setActionError('');
    setNotice('');
    if (Object.keys(errors).length > 0) {
      setFormError(editing
        ? 'Fix the highlighted fields before saving this address.'
        : 'Fix the highlighted fields before adding this address.');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await api(addressChildEndpoint(partyId, editingId), {
          method: 'PATCH',
          body: addressPayload(form)
        });
        setEditingId('');
        setForm(EMPTY_ADDRESS_FORM);
        setFieldErrors({});
        setNotice('Address updated.');
        await loadAddresses();
      } else {
        const body = await api(addressEndpoint(partyId), {
          method: 'POST',
          body: addressPayload(form)
        });
        const created = addressFromResponse(body, form);
        setItems((current) => [...current, created]);
        setLoadError('');
        setForm(EMPTY_ADDRESS_FORM);
        setFieldErrors({});
        setNotice('Address added.');
      }
    } catch (cause) {
      setFormError(addressErrorText(cause, editing ? 'update' : 'add'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(item) {
    if (deletingId || saving) return;
    if (!window.confirm(addressDeleteConfirmation(item))) return;

    setDeletingId(item.id);
    setActionError('');
    setNotice('');
    try {
      await api(addressChildEndpoint(partyId, item.id), { method: 'DELETE' });
      if (editingId === item.id) {
        setEditingId('');
        setForm(EMPTY_ADDRESS_FORM);
        setFieldErrors({});
        setFormError('');
      }
      setNotice('Address deleted.');
      await loadAddresses();
    } catch (cause) {
      setActionError(addressErrorText(cause, 'delete'));
      if (cause?.status === 404 || cause?.status === 409) {
        await loadAddresses();
      }
    } finally {
      setDeletingId('');
    }
  }

  const actionsDisabled = saving || Boolean(deletingId);
  const editing = Boolean(editingId);

  const countLabel = loading
    ? '…'
    : `${items.length} ${items.length === 1 ? 'address' : 'addresses'}`;

  return (
    <section data-testid="party-addresses" aria-label="Party addresses">
      <div className="eia-section-title">
        <h2>Addresses</h2>
        <div className="eia-actions">
          <span className="eia-badge" data-testid="addresses-count">{countLabel}</span>
          <button
            type="button"
            className="eia-btn-secondary"
            onClick={loadAddresses}
            disabled={loading}
            aria-label="Refresh addresses"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <p className="eia-muted" style={{ marginTop: 0 }} data-testid="addresses-context">
        {CONTEXT_TEXT}
      </p>

      {loading ? (
        <p className="eia-muted" data-testid="addresses-loading" style={{ margin: '8px 0 0' }}>
          Loading addresses…
        </p>
      ) : loadError ? (
        <p className="eia-muted" data-testid="addresses-error" style={{ margin: '8px 0 0' }}>
          {loadError}
        </p>
      ) : items.length === 0 ? (
        <div className="eia-empty" data-testid="addresses-empty">
          No addresses are recorded for this party yet.
        </div>
      ) : (
        <div className="eia-table-wrap">
          <table className="eia-table" aria-label="Party addresses">
            <thead>
              <tr>
                <th>Type</th>
                <th>Address lines</th>
                <th>City</th>
                <th>State / region</th>
                <th>Postal code</th>
                <th>Country</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr
                  key={item.id || `address-row-${index}`}
                  data-testid="address-row"
                  data-address-id={item.id}
                >
                  <td data-testid="address-type">{item.addressType || '—'}</td>
                  <td data-testid="address-lines">
                    {item.lines.length > 0
                      ? item.lines.map((line, lineIndex) => (
                        <div key={`${item.id}-line-${lineIndex}`}>{line}</div>
                      ))
                      : '—'}
                  </td>
                  <td data-testid="address-city">{item.city || '—'}</td>
                  <td data-testid="address-state">{item.state || '—'}</td>
                  <td className="eia-mono" data-testid="address-postal">
                    {item.postalCode || '—'}
                  </td>
                  <td data-testid="address-country">{item.country || '—'}</td>
                  <td data-testid="address-actions">
                    <div className="eia-actions">
                      <button
                        type="button"
                        className="eia-btn-ghost"
                        onClick={() => startEdit(item)}
                        disabled={actionsDisabled}
                        data-testid="address-edit"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="eia-btn-ghost"
                        onClick={() => remove(item)}
                        disabled={actionsDisabled}
                        aria-busy={deletingId === item.id ? 'true' : undefined}
                        data-testid="address-delete"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {actionError && (
        <p
          className="eia-form-error"
          role="alert"
          data-testid="address-action-error"
          style={{ margin: '10px 0 0' }}
        >
          {actionError}
        </p>
      )}

      <section
        className="eia-card"
        aria-label={editing ? 'Edit address' : 'Add address'}
        style={{ marginTop: 14 }}
      >
        <h3 style={{ marginTop: 0 }} data-testid="address-form-title">
          {editing ? 'Edit address' : 'Add address'}
        </h3>
        {editing && (
          <p className="eia-muted" style={{ margin: '4px 0 0' }} data-testid="address-edit-context">
            Editing an existing address updates party master data used by every linked policy,
            claim, and payment.
          </p>
        )}
        <form
          className="eia-form-grid"
          data-testid="address-form"
          onSubmit={submit}
          noValidate
          style={{ marginTop: 12 }}
        >
          <Field label="Address type" error={fieldErrors.addressType}>
            <select
              id="address-type"
              value={form.addressType}
              onChange={(event) => update('addressType', event.target.value)}
              aria-invalid={fieldErrors.addressType ? 'true' : undefined}
            >
              <option value="">Select address type…</option>
              {ADDRESS_TYPES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>

          <Field label="Address line 1" className="span-2" error={fieldErrors.line1}>
            <input
              id="address-line-1"
              value={form.line1}
              onChange={(event) => update('line1', event.target.value)}
              placeholder="e.g. 100 Market Street"
              maxLength={200}
              autoComplete="off"
              aria-invalid={fieldErrors.line1 ? 'true' : undefined}
            />
          </Field>

          <Field label="Address line 2" className="span-3" error={fieldErrors.line2}>
            <input
              id="address-line-2"
              value={form.line2}
              onChange={(event) => update('line2', event.target.value)}
              placeholder="Suite, floor, or care-of (optional)"
              maxLength={200}
              autoComplete="off"
              aria-invalid={fieldErrors.line2 ? 'true' : undefined}
            />
          </Field>

          <Field label="City" error={fieldErrors.city}>
            <input
              id="address-city"
              value={form.city}
              onChange={(event) => update('city', event.target.value)}
              maxLength={120}
              autoComplete="off"
              aria-invalid={fieldErrors.city ? 'true' : undefined}
            />
          </Field>

          <Field label="State / region" error={fieldErrors.state}>
            <input
              id="address-state"
              value={form.state}
              onChange={(event) => update('state', event.target.value)}
              placeholder="e.g. OH"
              maxLength={120}
              autoComplete="off"
              aria-invalid={fieldErrors.state ? 'true' : undefined}
            />
          </Field>

          <Field label="Postal code" error={fieldErrors.postalCode}>
            <input
              id="address-postal-code"
              value={form.postalCode}
              onChange={(event) => update('postalCode', event.target.value)}
              placeholder="e.g. 43215"
              maxLength={20}
              autoComplete="off"
              aria-invalid={fieldErrors.postalCode ? 'true' : undefined}
            />
          </Field>

          <Field label="Country" error={fieldErrors.country}>
            <input
              id="address-country"
              value={form.country}
              onChange={(event) => update('country', event.target.value.toUpperCase())}
              placeholder="USA"
              maxLength={3}
              autoComplete="off"
              aria-invalid={fieldErrors.country ? 'true' : undefined}
            />
          </Field>

          <div className="eia-actions span-2" style={{ justifyContent: 'flex-end' }}>
            {editing && (
              <button
                type="button"
                className="eia-btn-secondary"
                onClick={cancelEdit}
                disabled={saving}
                data-testid="address-cancel"
              >
                Cancel edit
              </button>
            )}
            <button
              type="submit"
              disabled={saving || Boolean(deletingId)}
              data-testid="address-submit"
            >
              {saving
                ? (editing ? 'Saving…' : 'Adding…')
                : (editing ? 'Save changes' : 'Add address')}
            </button>
          </div>
        </form>

        {formError && (
          <p
            className="eia-form-error"
            role="alert"
            data-testid="address-form-error"
            style={{ margin: '10px 0 0' }}
          >
            {formError}
          </p>
        )}
        {notice && (
          <p
            className="eia-form-notice"
            role="status"
            data-testid="address-notice"
            style={{ margin: '10px 0 0' }}
          >
            {notice}
          </p>
        )}
      </section>
    </section>
  );
}
