/**
 * Party lifecycle status transitions.
 *
 * `PATCH /api/v1/parties/{id}/status` moves a party to another `PartyStatus`
 * (SPEC 11.1.5) with an optional audit reason. The write is guarded with the
 * version/ETag the record was read at, so a stale view cannot overwrite a
 * transition made by another operator.
 *
 * Status is a process gate, not a delete: a restrictive state stops new
 * downstream work while the records that already reference the party keep
 * their own facts and history.
 */

/** The closed PartyStatus enum, in the order the API and SPEC list it. */
export const PARTY_STATUSES = [
  'PROSPECT',
  'ACTIVE',
  'INACTIVE',
  'DECEASED',
  'DISSOLVED',
  'MERGED',
  'RESTRICTED',
  'BLOCKED'
];

/** Statuses whose transition can stop new claims, policies, and payments. */
export const RESTRICTIVE_STATUSES = ['INACTIVE', 'BLOCKED', 'RESTRICTED'];

export const STATUS_REASON_MAX = 500;

export const STATUS_EFFECT_TEXT = 'Status is a process gate. INACTIVE, BLOCKED, or RESTRICTED '
  + 'can stop new claims, policies, and payments. Existing claims, policies, payments, and other '
  + 'records are unchanged; this action only moves the shared party status and is recorded on the '
  + 'activity timeline.';

const STATUS_DESCRIPTIONS = {
  PROSPECT: 'Not yet verified. New business can proceed only after the party becomes active.',
  ACTIVE: 'Verified and eligible for new claims, policies, and payments.',
  INACTIVE: 'No active roles. New claims, policies, and payments can stop until the party is active.',
  DECEASED: 'A person death has been recorded. Estate handling applies to downstream work.',
  DISSOLVED: 'The organization has dissolved. New business should reference its successor.',
  MERGED: 'The party merged into a survivor record. Use the survivor for new business.',
  RESTRICTED: 'A sanctions or legal restriction applies. New processing can stop until it is lifted.',
  BLOCKED: 'A confirmed sanctions match blocks new payments until a dual-approved clearance.'
};

/** Builds PATCH /api/v1/parties/{id}/status for one party. */
export function statusEndpoint(partyId) {
  const id = String(partyId || '').trim();
  if (!id) return '';
  return `/api/v1/parties/${encodeURIComponent(id)}/status`;
}

function normalizedStatus(value) {
  return String(value || '').trim().toUpperCase();
}

/** Every status except the party's current one, in enum order. */
export function statusTargets(currentStatus) {
  const current = normalizedStatus(currentStatus);
  return PARTY_STATUSES.filter((status) => status !== current);
}

/** Initial select value: the first status the party can move to. */
export function defaultStatusTarget(currentStatus) {
  return statusTargets(currentStatus)[0] || '';
}

export function isRestrictiveStatus(status) {
  return RESTRICTIVE_STATUSES.includes(normalizedStatus(status));
}

/** One-line explanation of what the selected target means for the party. */
export function statusDescription(status) {
  return STATUS_DESCRIPTIONS[normalizedStatus(status)] || '';
}

/**
 * The PATCH body. The reason is optional and trimmed; a blank reason is
 * omitted so a routine transition sends only the status.
 */
export function statusPayload(target, reason = '') {
  const payload = { status: normalizedStatus(target) };
  const trimmed = String(reason ?? '').trim();
  if (trimmed) payload.reason = trimmed;
  return payload;
}

/** Client-side mirror of the API rule: a target is required and differs. */
export function validateStatusChange(currentStatus, target, reason = '') {
  const current = normalizedStatus(currentStatus);
  const next = normalizedStatus(target);
  if (!next) return 'Select the status to move this party to.';
  if (!PARTY_STATUSES.includes(next)) return 'Select a supported party status.';
  if (next === current) return `The party is already ${current}. Choose a different status.`;
  if (String(reason ?? '').trim().length > STATUS_REASON_MAX) {
    return `Keep the reason to ${STATUS_REASON_MAX} characters or fewer.`;
  }
  return '';
}

/**
 * The If-Match value: the ETag returned with the detail read when available,
 * otherwise the quoted aggregate version the API exposes on every projection.
 */
export function statusEtag(party, responseEtag = '') {
  const etag = String(responseEtag || '').trim();
  if (etag) return etag;
  const version = party?.version;
  if (version === null || version === undefined || version === '') return '';
  return `"${version}"`;
}

/** Problem copy for a failed status write, with a recovery hint for races. */
export function statusChangeErrorText(cause, currentStatus = '') {
  const message = String(cause?.message || 'The party status could not be changed.').trim();
  const status = Number(cause?.status);
  if ([409, 412, 428].includes(status)) {
    const current = currentStatus ? ` The party is now ${currentStatus}.` : '';
    return `The party changed while the dialog was open.${current} `
      + `Review the current status and try again. ${message}`;
  }
  if (status === 404) return `This party no longer exists. ${message}`;
  return message;
}
