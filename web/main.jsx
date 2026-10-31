import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  ShieldCheck,
  Layers,
  Activity,
  Box,
  Terminal,
  ChevronDown,
  Check,
  Clock,
  Copy,
  Download,
  X,
  FlaskConical,
  KeyRound,
  ExternalLink,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import './style.css';
const shorten = (v = '', n = 6) => (v.length > n * 2 ? `${v.slice(0, n)}…${v.slice(-n)}` : v);
const profiles = {
  Healthy: [35, 42, 4, 20],
  'Memory pressure': [68, 96, 12, 65],
  'Retry storm': [40, 60, 85, 90],
};
function App() {
  const [status, setStatus] = useState(null),
    [jobs, setJobs] = useState([]),
    [tab, setTab] = useState('Overview'),
    [modal, setModal] = useState(false),
    [selected, setSelected] = useState(null),
    [features, setFeatures] = useState(profiles.Healthy),
    [name, setName] = useState('Telemetry check'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(sessionStorage.getItem('proofline-token') || ''),
    [auth, setAuth] = useState(false),
    [copied, setCopied] = useState('');
  async function api(url, options = {}) {
    const res = await fetch('/api' + url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...options.headers,
      },
    });
    if (res.status === 401) {
      setAuth(true);
      throw new Error('Enter the operator token to connect.');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  async function refresh() {
    try {
      const [s, j] = await Promise.all([api('/status'), api('/jobs')]);
      setStatus(s);
      setJobs(j);
      setSelected((old) => (old ? j.find((v) => v.id === old.id) || old : null));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [token]);
  useEffect(() => {
    if (!modal && !selected && !auth) return;
    const previous = document.activeElement;
    const dialog = document.querySelector('.overlay:last-of-type [role="dialog"]');
    const controls = () => [...dialog.querySelectorAll('button:not(:disabled),input,a[href]')];
    controls()[0]?.focus();
    const listener = (e) => {
      if (e.key === 'Escape') {
        setModal(false);
        setSelected(null);
        setAuth(false);
      }
      if (e.key === 'Tab') {
        const list = controls(),
          first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          last?.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first?.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
      previous?.focus();
    };
  }, [modal, selected?.id, auth]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const j = await api('/jobs', { method: 'POST', body: JSON.stringify({ features, name }) });
      setModal(false);
      setSelected(j);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function download(j) {
    try {
      const bundle = await api(`/jobs/${j.id}/bundle`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `proofline-job-${j.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  }
  async function copy(v) {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(v);
      setTimeout(() => setCopied(''), 1200);
    } catch {
      setError('Clipboard unavailable in this browser.');
    }
  }
  const settled = jobs.filter((j) => j.status === 'settled'),
    checks = settled.flatMap((j) => j.checks || []),
    avg = settled.length
      ? Math.round(settled.reduce((s, j) => s + j.proveMs, 0) / settled.length)
      : null;
  const Icon = ({ type, size = 18 }) => {
    const I = type;
    return <I size={size} />;
  };
  const badge = (s) => (
    <span className={'badge ' + s}>
      <span />
      {s}
    </span>
  );
  const table = (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>REQUEST</th>
            <th>MODEL</th>
            <th>STATUS</th>
            <th>RESULT</th>
            <th>PROOF TIME</th>
            <th>REWARD</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr
              key={j.id}
              onClick={() => setSelected(j)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSelected(j);
              }}
              aria-label={`Open request ${j.id}`}
            >
              <td>
                <strong>{j.name}</strong>
                <small>
                  REQ-{j.id.padStart(4, '0')} ·{' '}
                  {new Date(j.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </small>
              </td>
              <td>
                <span className="model-dot" />
                Sentinel <span className="muted">v1</span>
              </td>
              <td>{badge(j.status)}</td>
              <td>{j.risk === undefined ? '—' : j.risk ? 'Elevated risk' : 'Healthy'}</td>
              <td className="mono">{j.proveMs ? `${(j.proveMs / 1000).toFixed(2)}s` : '—'}</td>
              <td className="mono">{j.reward} ETH</td>
              <td>
                <ArrowUpRight size={16} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!jobs.length && (
        <div className="empty">
          <Box size={30} />
          <h3>Your first verifiable request.</h3>
          <p>Send telemetry through the model. Get a real proof and settle it on-chain.</p>
          <button className="button primary" onClick={() => setModal(true)}>
            <Plus size={16} />
            Create request
          </button>
        </div>
      )}
    </div>
  );
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="logo" href="/">
          <span className="logo-mark">p</span>proofline<span className="version">β</span>
        </a>
        <div className="workspace">
          <span className="avatar">P</span>
          <div>
            Proofline workspace<small>Verifiable compute</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {[
            [Layers, 'Overview'],
            [Activity, 'Requests'],
            [Box, 'Model & circuit'],
            [FlaskConical, 'Verification lab'],
          ].map(([I, t]) => (
            <button key={t} className={tab === t ? 'nav active' : 'nav'} onClick={() => setTab(t)}>
              <I size={18} />
              {t}
              {t === 'Requests' && <span>{jobs.length}</span>}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="network-box">
            <span className="live-dot" />
            <span>
              {status?.mode === 'external' ? 'External EVM' : 'Local EVM'}
              <small>Chain {status?.chainId || 'connecting…'}</small>
            </span>
            <ShieldCheck size={16} />
          </div>
          <button className="nav" onClick={() => setAuth(true)}>
            <KeyRound size={16} />
            Operator access
          </button>
          <a
            className="nav"
            href="https://github.com/Mudit-R/proofline"
            target="_blank"
            rel="noreferrer"
          >
            <Terminal size={16} />
            Source & documentation
            <ArrowUpRight size={14} />
          </a>
          <div className="side-foot">COMPUTE. PROVE. VERIFY.</div>
        </div>
      </aside>
      <div className="main">
        <header>
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>{tab}</strong>
          </div>
          <div className="header-right">
            <span className="network-label">
              <span className="live-dot" />
              {status ? 'Network connected' : 'Connecting'}
            </span>
            <button className="icon-button" aria-label="Refresh workspace" onClick={refresh}>
              <RefreshCw size={16} />
            </button>
            <span className="avatar small">MR</span>
          </div>
        </header>
        <main className="content">
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError('')} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <p className="eyebrow">VERIFIABLE INFERENCE</p>
              <h1>{tab === 'Overview' ? 'Every result. Accounted for.' : tab}</h1>
              <p>
                {tab === 'Overview'
                  ? 'Off-chain intelligence. Cryptographic certainty. On-chain settlement.'
                  : tab === 'Requests'
                    ? 'Follow each request from commitment to a verified result.'
                    : tab === 'Model & circuit'
                      ? 'Inspect the exact computation your proof attests to.'
                      : 'Real adversarial checks against the deployed settlement contract.'}
              </p>
            </div>
            <button className="button primary" onClick={() => setModal(true)} disabled={!status}>
              <Plus size={16} />
              New request
            </button>
          </div>
          {(tab === 'Overview' || tab === 'Requests') && (
            <>
              <section className="stats">
                <div>
                  <span>
                    Requests submitted <Activity size={15} />
                  </span>
                  <strong>
                    {jobs.length}
                    <small>total</small>
                  </strong>
                  <p>Committed to the EVM</p>
                </div>
                <div>
                  <span>
                    Verified & settled <ShieldCheck size={15} />
                  </span>
                  <strong>
                    {settled.length}
                    <small>results</small>
                  </strong>
                  <p>Real Groth16 proofs</p>
                </div>
                <div>
                  <span>
                    Mean proof + local verify <Clock size={15} />
                  </span>
                  <strong>
                    {avg === null ? '—' : (avg / 1000).toFixed(2)}
                    <small>{avg === null ? 'no runs yet' : 'seconds'}</small>
                  </strong>
                  <p>Measured on this instance</p>
                </div>
                <div>
                  <span>
                    Worker credit <Wallet size={15} />
                  </span>
                  <strong>
                    {status?.workerCredit || '0.0'}
                    <small>ETH</small>
                  </strong>
                  <button
                    className="inline-button"
                    onClick={async () => {
                      try {
                        await api('/withdraw', { method: 'POST', body: '{}' });
                        refresh();
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Withdraw settled rewards ↗
                  </button>
                </div>
              </section>
              {tab === 'Overview' && (
                <section className="overview-grid">
                  <div className="flow-card">
                    <div className="card-label">
                      <span className="orange-dot" />
                      THE VERIFICATION PATH <span>LIVE PIPELINE</span>
                    </div>
                    <h2>
                      From a claim
                      <br />
                      to a fact you can verify.
                    </h2>
                    <p>
                      One request, bound to one model, one input commitment, and one worker. No
                      result is settled without a valid proof.
                    </p>
                    <div className="flow">
                      {[
                        ['01', 'Commit', 'Salted Poseidon'],
                        ['02', 'Prove', 'Circom · Groth16'],
                        ['03', 'Settle', 'Solidity verifier'],
                      ].map(([n, t, s], i) => (
                        <React.Fragment key={n}>
                          {i > 0 && <ArrowRight size={15} />}
                          <div>
                            <span>{n}</span>
                            <strong>{t}</strong>
                            <small>{s}</small>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  <div className="model-card">
                    <div className="card-label">
                      <Box size={15} />
                      ACTIVE MODEL <span>v1.0.0</span>
                    </div>
                    <div className="model-art" aria-hidden="true">
                      <div />
                      <div />
                      <div />
                      <i />
                      <i />
                      <i />
                      <span>Σ</span>
                    </div>
                    <h3>Sentinel telemetry tree</h3>
                    <p>Classifies operational pressure from four bounded telemetry inputs.</p>
                    <div className="model-footer">
                      <span className="badge settled">Immutable verifier</span>
                      <button className="inline-button" onClick={() => setTab('Model & circuit')}>
                        Inspect <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </div>
                </section>
              )}
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <h2>
                      {tab === 'Overview' ? 'Recent requests' : 'All requests'}{' '}
                      <span>{jobs.length}</span>
                    </h2>
                    <p>Proof-backed inference, from request to settlement.</p>
                  </div>
                  <button className="button" onClick={() => setModal(true)}>
                    <Plus size={14} />
                    Create
                  </button>
                </div>
                {table}
              </section>
            </>
          )}
          {tab === 'Model & circuit' && (
            <div className="details-grid">
              <section className="panel padded">
                <p className="eyebrow">SENTINEL / VERSION 1.0.0</p>
                <h2>
                  A small model.
                  <br />A precise guarantee.
                </h2>
                <p>
                  A depth-three decision tree trained on deterministic synthetic telemetry. The
                  circuit evaluates its fixed thresholds with integer arithmetic; it does not prove
                  the model is accurate on real systems.
                </p>
                <div className="model-metrics">
                  <div>
                    <strong>{status?.model.training.trainRows || '—'}</strong>
                    <span>training examples</span>
                  </div>
                  <div>
                    <strong>
                      {status ? `${(status.model.training.testAccuracy * 100).toFixed(2)}%` : '—'}
                    </strong>
                    <span>held-out synthetic accuracy</span>
                  </div>
                </div>
                <h3>Model identity</h3>
                <code className="code-block">{status?.model.id}</code>
                <h3>Decision tree</h3>
                <pre>{JSON.stringify(status?.model.tree, null, 2)}</pre>
              </section>
              <section className="panel padded">
                <h2>What the proof binds</h2>
                {[
                  'Four telemetry features, each constrained to an integer in [0, 100]',
                  'Input commitment: Poseidon(features, random 248-bit salt)',
                  'Context commitment: chain, consumer, job, requester, worker, model',
                  'Model ID fixed in the circuit and immutable deployment',
                  'Risk classification computed from the trained tree',
                ].map((t) => (
                  <div className="guarantee" key={t}>
                    <ShieldCheck size={18} />
                    <p>{t}</p>
                  </div>
                ))}
                <div className="notice">
                  <strong>Trust boundary</strong>
                  <p>
                    Groth16 uses a trusted setup. This instance uses a local development ceremony.
                    Private inputs are hidden from on-chain observers, but visible to the proving
                    operator. Use independent setup contributions before security-sensitive use.
                  </p>
                </div>
              </section>
            </div>
          )}
          {tab === 'Verification lab' && (
            <>
              <section className="panel padded">
                <div className="panel-title">
                  <div>
                    <h2>Attack the statement.</h2>
                    <p>
                      Every completed run exercises invalid submissions using EVM static calls, then
                      tests duplicate settlement.
                    </p>
                  </div>
                  <FlaskConical size={30} />
                </div>
                <div className="lab-stats">
                  <strong>
                    {checks.filter((c) => c.rejected).length}
                    <span> rejected attempts</span>
                  </strong>
                  <strong>
                    {checks.filter((c) => !c.rejected).length}
                    <span> unexpected acceptances</span>
                  </strong>
                </div>
                <p className="muted">
                  Checks are run against the real verifier and consumer. Static-call rejection does
                  not create a mined attack transaction.
                </p>
              </section>
              <div className="attack-list">
                {settled.map((j) => (
                  <section className="panel padded" key={j.id}>
                    <h3>
                      REQ-{j.id.padStart(4, '0')} · {j.name}
                    </h3>
                    {j.checks?.map((c) => (
                      <div className="attack" key={c.name}>
                        <span>{c.name}</span>
                        <span className={'badge ' + (c.rejected ? 'settled' : 'failed')}>
                          {c.rejected ? <Check size={13} /> : <X size={13} />}{' '}
                          {c.rejected ? 'Rejected' : 'Accepted — investigate'}
                        </span>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
              {!settled.length && (
                <div className="empty">
                  <FlaskConical size={30} />
                  <h3>No attack results yet.</h3>
                  <p>Settle your first request to run the adversarial checks.</p>
                </div>
              )}
            </>
          )}
          <footer>
            <span>Proofline · Verifiable compute infrastructure</span>
            <span>
              {status?.mode === 'demo'
                ? 'Local demo · Disposable test ETH · Development setup'
                : 'Operator-managed EVM deployment'}
            </span>
          </footer>
        </main>
      </div>
      {modal && (
        <div className="overlay" onClick={() => !busy && setModal(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <span className="eyebrow">NEW INFERENCE REQUEST</span>
              <button
                className="icon-button"
                aria-label="Close request form"
                onClick={() => setModal(false)}
              >
                <X size={19} />
              </button>
            </div>
            <h2 id="request-title">Put compute to the test.</h2>
            <p>
              Provide telemetry. The worker proves its inference before the contract releases the
              reward.
            </p>
            <form onSubmit={submit}>
              <label className="field-label">
                Request name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  required
                />
              </label>
              <div className="presets">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const t = await api('/telemetry');
                      setFeatures(t.features);
                      setName('Live host telemetry');
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  Use server telemetry ↗
                </button>
                {Object.entries(profiles).map(([p, f]) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setFeatures([...f]);
                      setName(p + ' check');
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {(status?.model.features || []).map((f, i) => (
                <label className="slider-label" key={f.key}>
                  <span>
                    {f.label}
                    <strong>{features[i]}%</strong>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={features[i]}
                    onChange={(e) =>
                      setFeatures(features.map((v, k) => (i === k ? Number(e.target.value) : v)))
                    }
                  />
                </label>
              ))}
              <div className="request-summary">
                <span>
                  Model <strong>Sentinel v1</strong>
                </span>
                <span>
                  Escrow reward <strong>0.001 test ETH</strong>
                </span>
                <span>
                  Deadline <strong>10 minutes</strong>
                </span>
              </div>
              <button className="button primary full" disabled={busy}>
                {busy ? 'Registering on-chain…' : 'Commit & request proof'}
                <ArrowRight size={16} />
              </button>
              <p className="fine">
                Inputs go to this proving operator. The chain receives a salted commitment and the
                proved result.
              </p>
            </form>
          </section>
        </div>
      )}
      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <section
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={'Request ' + selected.id}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <p className="eyebrow">REQ-{selected.id.padStart(4, '0')}</p>
              <button
                className="icon-button"
                aria-label="Close request details"
                onClick={() => setSelected(null)}
              >
                <X size={20} />
              </button>
            </div>
            <h2>{selected.name}</h2>
            {badge(selected.status)}
            <div className="request-result">
              <span>Proved result</span>
              <strong>
                {selected.risk === undefined
                  ? 'Awaiting proof'
                  : selected.risk
                    ? 'Elevated risk'
                    : 'Healthy'}
              </strong>
              <small>
                {selected.risk === undefined
                  ? 'The worker is processing this request.'
                  : 'The contract verified the model computation.'}
              </small>
            </div>
            {selected.error && <div className="error">{selected.error}</div>}
            <div className="facts">
              {[
                ['Input commitment', selected.commitment],
                ['Request transaction', selected.requestTx],
                ['Settlement transaction', selected.settleTx],
                ['Worker', selected.worker],
                ['Verification gas', selected.gasUsed],
                ['Proof + local verification', selected.proveMs ? selected.proveMs + ' ms' : null],
                [
                  'Proof coordinates ABI',
                  selected.proofBytes ? selected.proofBytes + ' bytes' : null,
                ],
                ['Reward', selected.reward + ' test ETH'],
              ].map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <button title={v || ''} disabled={!v} onClick={() => v && copy(v)}>
                    {shorten(v || 'Pending', 12)}
                    {v && (copied === v ? <Check size={12} /> : <Copy size={12} />)}
                  </button>
                </div>
              ))}
            </div>
            {selected.proof && (
              <button className="button full" onClick={() => download(selected)}>
                <Download size={16} />
                Download proof & verification key
              </button>
            )}
            {selected.checks && (
              <div className="notice">
                <strong>
                  {selected.checks.filter((c) => c.rejected).length}/{selected.checks.length}{' '}
                  adversarial checks rejected
                </strong>
                <p>Inspect the Verification lab for individual attack results.</p>
              </div>
            )}
            {['expired', 'failed'].includes(selected.status) && (
              <button
                className="button full"
                onClick={async () => {
                  try {
                    await api('/jobs/' + selected.id + '/refund', { method: 'POST', body: '{}' });
                    refresh();
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Refund expired escrow
              </button>
            )}
          </section>
        </div>
      )}
      {auth && (
        <div className="overlay">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Operator access">
            <div className="modal-heading">
              <h2>Operator access</h2>
              <button
                className="icon-button"
                onClick={() => setAuth(false)}
                aria-label="Close operator access"
              >
                <X size={18} />
              </button>
            </div>
            <p>
              Enter the token configured on your server. It is stored only for this browser session.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = new FormData(e.target).get('token');
                sessionStorage.setItem('proofline-token', v);
                setToken(v);
                setAuth(false);
              }}
            >
              <input
                name="token"
                type="password"
                aria-label="Operator token"
                autoComplete="off"
                defaultValue={token}
              />
              <button className="button primary full">Connect</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);
