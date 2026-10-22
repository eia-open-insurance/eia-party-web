/**
 * Party master data: identifiers and addresses.
 *
 * Identifiers and addresses are party aggregate members. They are listed with
 * GET and added with POST on `/api/v1/parties/{id}/identifiers` and
 * `/api/v1/parties/{id}/addresses`. The request/response fields below are the
 * camelCase form of SPEC 11.1.4 `party_identifier` and `party_address`.
 */

export const IDENTIFIER_TYPES = [
  ['TIN', 'TIN — Taxpayer identification number'],
  ['EIN', 'EIN — Employer identification number'],
  ['SSN', 'SSN — Social Security number'],
  ['ITIN', 'ITIN — Individual taxpayer identification number'],
  ['DUNS', 'DUNS — Business identifier'],
  ['LEI', 'LEI — Legal entity identifier'],
  ['PASSPORT', 'Passport'],
  ['DRIVER_LICENSE', 'Driver license'],
  ['STATE_ID', 'State identification'],
  ['MEDICARE_ID', 'Medicare identifier'],
  ['MEDICAID_ID', 'Medicaid identifier'],
  ['NPI', 'NPI — National provider identifier'],
  ['BAR_NUMBER', 'Bar number'],
  ['ACORD_PARTY_ID', 'ACORD party identifier'],
  ['ISO_PARTY_ID', 'ISO party identifier'],
  ['TRUST_CLAIM_NUMBER', 'Trust claim number'],
  ['BANKRUPTCY_CASE_NUMBER', 'Bankruptcy case number']
];

export const ADDRESS_TYPES = [
  ['LEGAL', 'Legal'],
  ['PHYSICAL', 'Physical'],
  ['MAILING', 'Mailing'],
  ['BILLING', 'Billing'],
  ['CLAIM_SITE', 'Claim site'],
  ['EXPOSURE_SITE', 'Exposure site'],
  ['EMPLOYER', 'Employer'],
  ['PROVIDER', 'Provider'],
  ['BANK', 'Bank'],
  ['OTHER', 'Other']
];

export const EMPTY_IDENTIFIER_FORM = {
  identifierType: '',
  value: '',
  issuingAuthority: '',
  effectiveDate: ''
};

export const EMPTY_ADDRESS_FORM = {
  addressType: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: ''
};

export function identifierEndpoint(partyId) {
  return `/api/v1/parties/${encodeURIComponent(partyId)}/identifiers`;
}

export function addressEndpoint(partyId) {
  return `/api/v1/parties/${encodeURIComponent(partyId)}/addresses`;
}

function collection(body) {
  if (Array.isArray(body)) return body;
  for (const key of ['items', 'content', 'data']) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function trimmed(value) {
  return text(value).trim();
}

export function identifierRows(body) {
  return collection(body).map((entry, index) => {
    const row = entry || {};
    return {
      id: text(row.id) || `identifier-${index}`,
      identifierType: text(row.identifierType || row.type),
      value: text(row.value ?? row.identifierValue),
      issuingAuthority: text(row.issuingAuthority),
      effectiveDate: text(row.effectiveDate || row.effectiveFrom),
      createdAt: text(row.createdAt || row.created)
    };
  });
}

function addressLines(row) {
  if (Array.isArray(row?.lines)) {
    return row.lines.map(trimmed).filter(Boolean);
  }
  return [
    row?.line1 ?? row?.addressLine1,
    row?.line2 ?? row?.addressLine2,
    row?.line3 ?? row?.addressLine3
  ]
    .map(trimmed)
    .filter(Boolean);
}

export function addressRows(body) {
  return collection(body).map((entry, index) => {
    const row = entry || {};
    return {
      id: text(row.id) || `address-${index}`,
      addressType: text(row.addressType || row.type),
      lines: addressLines(row),
      city: text(row.city),
      state: text(row.state || row.stateRegion || row.region),
      postalCode: text(row.postalCode || row.postal),
      country: text(row.country),
      createdAt: text(row.createdAt || row.created)
    };
  });
}

export function validateIdentifier(form) {
  const errors = {};
  if (!form.identifierType) errors.identifierType = 'Select an identifier type.';
  const value = trimmed(form.value);
  if (!value) errors.value = 'Enter the identifier value.';
  else if (value.length > 128) errors.value = 'Use 128 characters or fewer.';
  if (trimmed(form.issuingAuthority).length > 160) {
    errors.issuingAuthority = 'Use 160 characters or fewer.';
  }
  if (form.effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate)) {
    errors.effectiveDate = 'Enter a valid effective date.';
  }
  return errors;
}

export function validateAddress(form) {
  const errors = {};
  if (!form.addressType) errors.addressType = 'Select an address type.';
  const line1 = trimmed(form.line1);
  if (!line1) errors.line1 = 'Enter the first address line.';
  else if (line1.length > 200) errors.line1 = 'Use 200 characters or fewer.';
  if (trimmed(form.line2).length > 200) errors.line2 = 'Use 200 characters or fewer.';
  const city = trimmed(form.city);
  if (!city) errors.city = 'Enter the city.';
  else if (city.length > 120) errors.city = 'Use 120 characters or fewer.';
  if (trimmed(form.state).length > 120) errors.state = 'Use 120 characters or fewer.';
  if (trimmed(form.postalCode).length > 20) errors.postalCode = 'Use 20 characters or fewer.';
  const country = trimmed(form.country);
  if (!country) errors.country = 'Enter the country code.';
  else if (!/^[A-Za-z]{2}$/.test(country)) {
    errors.country = 'Enter a 2-letter ISO country code (for example US).';
  }
  return errors;
}

export function identifierPayload(form) {
  return {
    identifierType: form.identifierType,
    identifierValue: trimmed(form.value),
    issuingAuthority: trimmed(form.issuingAuthority) || null,
    effectiveDate: form.effectiveDate || null
  };
}

export function addressPayload(form) {
  return {
    addressType: form.addressType,
    line1: trimmed(form.line1),
    line2: trimmed(form.line2) || null,
    city: trimmed(form.city),
    stateRegion: trimmed(form.state) || null,
    postalCode: trimmed(form.postalCode) || null,
    country: trimmed(form.country).toUpperCase()
  };
}

export function identifierFromResponse(body, form) {
  const row = body?.identifier || body?.item || body || {};
  return {
    id: text(row.id) || `local-identifier-${Date.now()}`,
    identifierType: text(row.identifierType || row.type) || form.identifierType,
    value: text(row.value ?? row.identifierValue) || trimmed(form.value),
    issuingAuthority: text(row.issuingAuthority) || trimmed(form.issuingAuthority),
    effectiveDate: text(row.effectiveDate || row.effectiveFrom) || form.effectiveDate,
    createdAt: text(row.createdAt || row.created) || new Date().toISOString()
  };
}

export function addressFromResponse(body, form) {
  const row = body?.address || body?.item || body || {};
  const lines = addressLines(row);
  return {
    id: text(row.id) || `local-address-${Date.now()}`,
    addressType: text(row.addressType || row.type) || form.addressType,
    lines: lines.length > 0
      ? lines
      : [trimmed(form.line1), trimmed(form.line2)].filter(Boolean),
    city: text(row.city) || trimmed(form.city),
    state: text(row.state || row.stateRegion || row.region) || trimmed(form.state),
    postalCode: text(row.postalCode || row.postal) || trimmed(form.postalCode),
    country: text(row.country) || trimmed(form.country).toUpperCase(),
    createdAt: text(row.createdAt || row.created) || new Date().toISOString()
  };
}

/**
 * A 409 on a master-data create means the value is already present. The server
 * message is kept and a recovery hint points at the existing list, so the
 * conflict stays inside the form instead of becoming a page-level error.
 */
export function identifierErrorText(cause) {
  const message = cause?.message || 'The identifier could not be added.';
  if (cause?.status === 409) {
    return `Duplicate identifier — ${message} Review the existing identifiers before retrying.`;
  }
  return message;
}

export function addressErrorText(cause) {
  const message = cause?.message || 'The address could not be added.';
  if (cause?.status === 409) {
    return `Duplicate address — ${message} Review the existing addresses before retrying.`;
  }
  return message;
}
