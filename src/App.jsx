import React, { useEffect, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';

export default function App() {
  const [parties, setParties] = useState([]);
  const [form, setForm] = useState({ partyType: 'ORGANIZATION', displayName: '', legalName: '' });
  const [error, setError] = useState('');

  async function load() {
    const response = await fetch('/api/v1/parties', { headers: { 'X-EIA-Tenant': TENANT } });
    if (!response.ok) throw new Error(`Load failed: ${response.status}`);
    setParties(await response.json());
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/v1/parties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EIA-Tenant': TENANT },
      body: JSON.stringify(form)
    });
    if (!response.ok) { setError(`Create failed: ${response.status}`); return; }
    setForm({ partyType: 'ORGANIZATION', displayName: '', legalName: '' });
    await load();
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1>Party</h1>
      <p>Direct and assumed books share party identity; associations remain book-scoped.</p>
      {error && <p role="alert" style={{ color: '#b00020' }}>{error}</p>}
      <form onSubmit={submit} style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
        <select value={form.partyType} onChange={(e) => setForm({ ...form, partyType: e.target.value })}>
          <option value="ORGANIZATION">Organization</option>
          <option value="PERSON">Person</option>
          <option value="TRUST">Trust</option>
          <option value="ESTATE">Estate</option>
        </select>
        <input placeholder="Display name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
        <input placeholder="Legal name" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} required />
        <button type="submit">Create party</button>
      </form>
      <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
        <thead><tr><th align="left">Number</th><th align="left">Name</th><th align="left">Type</th><th align="left">Status</th></tr></thead>
        <tbody>
          {parties.map((party) => (
            <tr key={party.id} style={{ borderTop: '1px solid #ddd' }}>
              <td>{party.partyNumber}</td><td>{party.displayName}</td><td>{party.partyType}</td><td>{party.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
