import { useEffect, useState } from 'react';
import './App.css';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8081';
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY ?? 'dev-admin-key';

async function adminFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}/admin${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': ADMIN_KEY,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function App() {
  const [dash, setDash] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [listenerId, setListenerId] = useState('');
  const [msg, setMsg] = useState('');

  const refresh = async () => {
    const [d, r] = await Promise.all([
      adminFetch('/dashboard'),
      adminFetch('/reports'),
    ]);
    setDash(d);
    setReports(r.reports || []);
  };

  useEffect(() => {
    refresh().catch((e) => setMsg(String(e)));
    const t = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="page">
      <header>
        <h1>Human Conversation Admin</h1>
        <button onClick={() => refresh()}>Refresh</button>
      </header>

      {msg && <p className="error">{msg}</p>}

      <section className="cards">
        <div className="card">
          <div className="label">Online listeners</div>
          <div className="value">{dash?.online_listeners ?? '—'}</div>
        </div>
        <div className="card">
          <div className="label">Available</div>
          <div className="value">{dash?.available ?? '—'}</div>
        </div>
        <div className="card">
          <div className="label">Busy</div>
          <div className="value">{dash?.busy ?? '—'}</div>
        </div>
        <div className="card">
          <div className="label">Active calls</div>
          <div className="value">{dash?.active_calls ?? '—'}</div>
        </div>
      </section>

      <section>
        <h2>Approve listener</h2>
        <div className="row">
          <input
            placeholder="Listener user UUID"
            value={listenerId}
            onChange={(e) => setListenerId(e.target.value)}
          />
          <button
            onClick={async () => {
              await adminFetch(`/listeners/${listenerId}/approve`, { method: 'POST' });
              setMsg('Approved ' + listenerId);
              setListenerId('');
            }}
          >
            Approve
          </button>
        </div>
      </section>

      <section>
        <h2>Open reports</h2>
        {reports.length === 0 && <p className="muted">No open reports.</p>}
        <ul>
          {reports.map((r) => (
            <li key={r.id}>
              <strong>{r.reason}</strong> — {r.details || 'no details'}{' '}
              <span className="muted">({r.created_at})</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
