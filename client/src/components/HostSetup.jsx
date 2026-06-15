import { useState } from 'react';

export default function HostSetup({ onGameCreated }) {
  const [title, setTitle] = useState('');
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(60);
  const [items, setItems] = useState([]);
  const [itemInput, setItemInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function addItem() {
    const trimmed = itemInput.trim();
    if (!trimmed) return;
    if (items.includes(trimmed)) {
      setError('Item already in list');
      return;
    }
    setItems([...items, trimmed]);
    setItemInput('');
    setError('');
  }

  function removeItem(i) {
    setItems(items.filter((_, idx) => idx !== i));
  }

  function handleCSV(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      loadCSVText(evt.target.result);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function loadCSVText(text) {
    const lines = text
      .split(/[\r\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const merged = [...new Set([...items, ...lines])];
    setItems(merged);
    setError('');
  }

  async function loadPreset(filename, defaultTitle) {
    try {
      const res = await fetch(`/seeds/${filename}`);
      const text = await res.text();
      loadCSVText(text);
      if (!title) setTitle(defaultTitle);
    } catch {
      setError('Failed to load preset');
    }
  }

  function isPowerOfTwo(n) {
    return n >= 2 && (n & (n - 1)) === 0;
  }

  function nextPowerOfTwo(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  async function createGame() {
    if (!title.trim()) return setError('Enter a game title');
    if (items.length < 2) return setError('Add at least 2 items');
    setError('');
    setLoading(true);

    const next = nextPowerOfTwo(items.length);
    if (!isPowerOfTwo(items.length)) {
      const diff = next - items.length;
      setError(`${diff} BYE slot(s) will be added to reach ${next} items (power of 2 required). Continuing...`);
    }

    try {
      const base = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${base}/api/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), items, timeLimitSeconds: Number(timeLimitSeconds) }),
      });
      const data = await res.json();
      if (data.gameId) onGameCreated(data.gameId);
      else setError(data.error || 'Failed to create game');
    } catch {
      setError('Could not reach server');
    }
    setLoading(false);
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>🏆 Bracket Game</h1>
      <h2 style={styles.sub}>Host Setup</h2>

      <label style={styles.label}>Game Title</label>
      <input
        style={styles.input}
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="e.g. Best Movies of 2024"
      />

      <label style={styles.label}>Time Limit Per Match (seconds, 0 = no limit)</label>
      <input
        style={styles.input}
        type="number"
        min="0"
        value={timeLimitSeconds}
        onChange={e => setTimeLimitSeconds(e.target.value)}
      />

      <label style={styles.label}>Bracket Items</label>
      <div style={styles.row}>
        <input
          style={{ ...styles.input, flex: 1, marginBottom: 0 }}
          value={itemInput}
          onChange={e => setItemInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addItem()}
          placeholder="Type an item and press Enter"
        />
        <button style={styles.btnSecondary} onClick={addItem}>Add</button>
      </div>

      <div style={styles.csvRow}>
        <label style={styles.csvLabel}>
          📂 Upload CSV
          <input type="file" accept=".csv,.txt" onChange={handleCSV} style={{ display: 'none' }} />
        </label>
        <button style={styles.csvLabel} onClick={() => loadPreset('disney-movies.csv', '64 Disney Movies')}>
          🎬 Load Disney Movies
        </button>
        <span style={styles.hint}>One item per line or comma-separated</span>
      </div>

      {items.length > 0 && (
        <div style={styles.itemList}>
          <div style={styles.itemCount}>{items.length} items {!isPowerOfTwo(items.length) && `→ will pad to ${nextPowerOfTwo(items.length)}`}</div>
          {items.map((item, i) => (
            <div key={i} style={styles.item}>
              <span>{item}</span>
              <button style={styles.removeBtn} onClick={() => removeItem(i)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      <button style={styles.btnPrimary} onClick={createGame} disabled={loading}>
        {loading ? 'Creating...' : 'Create Game'}
      </button>
    </div>
  );
}

const styles = {
  container: { maxWidth: 520, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif' },
  heading: { textAlign: 'center', fontSize: 32, marginBottom: 4 },
  sub: { textAlign: 'center', color: '#555', fontWeight: 400, marginBottom: 28 },
  label: { display: 'block', fontWeight: 600, marginBottom: 6, marginTop: 16 },
  input: { display: 'block', width: '100%', padding: '10px 12px', fontSize: 15, borderRadius: 8, border: '1px solid #ccc', boxSizing: 'border-box', marginBottom: 4 },
  row: { display: 'flex', gap: 8, alignItems: 'center' },
  csvRow: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 },
  csvLabel: { padding: '8px 14px', background: '#f0f0f0', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  hint: { color: '#888', fontSize: 13 },
  itemList: { marginTop: 16, border: '1px solid #e0e0e0', borderRadius: 10, overflow: 'hidden' },
  itemCount: { padding: '8px 14px', background: '#f7f7f7', fontSize: 13, color: '#555', borderBottom: '1px solid #e0e0e0' },
  item: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid #f0f0f0' },
  removeBtn: { background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 16 },
  error: { marginTop: 12, color: '#c0392b', fontSize: 14 },
  btnPrimary: { display: 'block', width: '100%', marginTop: 24, padding: '14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  btnSecondary: { padding: '10px 16px', background: '#e0e0e0', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
};
