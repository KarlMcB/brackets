import { useState } from 'react';

// Renders the whole tournament as an SVG bracket. The SVG has a fixed viewBox,
// so on screen we scale it by `zoom` inside a scrollable box, and for print we
// let it fit (preserveAspectRatio) into one landscape letter page.
export default function BracketView({ matches = [], totalRounds = 0, champion, onBack }) {
  const [zoom, setZoom] = useState(1);

  // Group matches into rounds (1..totalRounds), ordered top-to-bottom by position
  const rounds = [];
  for (let r = 1; r <= totalRounds; r++) {
    rounds.push(matches.filter(m => m.round === r).sort((a, b) => a.position - b.position));
  }

  // Layout constants in SVG units
  const ROW_H = 26;          // one competitor row
  const BOX_W = 176;         // name box width
  const COL_GAP = 46;        // gap between round columns
  const COL_W = BOX_W + COL_GAP;
  const V_GAP = 22;          // vertical gap between first-round matches
  const unitH = 2 * ROW_H + V_GAP;
  const PAD = 24;
  const LABEL_H = 30;

  const CHAMP_W = 208;       // champion box (wider, fits trophy + longer names)
  const M1 = rounds[0]?.length || 0;
  const naturalW = PAD * 2 + totalRounds * COL_W + CHAMP_W;
  const naturalH = PAD * 2 + LABEL_H + Math.max(M1, 1) * unitH;

  const centerY = (r, pos) => PAD + LABEL_H + (pos + 0.5) * Math.pow(2, r - 1) * unitH;
  const colX = (r) => PAD + (r - 1) * COL_W;
  const champX = colX(totalRounds) + COL_W;

  const isBye = (s) => typeof s === 'string' && s.startsWith('BYE_');
  const trunc = (s, n = 24) => (!s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s);

  const roundName = (r) => {
    const teams = Math.pow(2, totalRounds - r + 1);
    if (teams === 2) return 'Final';
    if (teams === 4) return 'Semifinals';
    if (teams === 8) return 'Quarterfinals';
    return `Round of ${teams}`;
  };

  const lines = [];
  const boxes = [];
  const labels = [];

  rounds.forEach((roundMatches, ri) => {
    const r = ri + 1;
    labels.push(
      <text key={`lbl-${r}`} x={colX(r) + BOX_W / 2} y={PAD + LABEL_H / 2}
        textAnchor="middle" dominantBaseline="middle" fontSize="13" fontWeight="700" fill="#475569">
        {roundName(r)}
      </text>
    );

    roundMatches.forEach((match) => {
      const cy = centerY(r, match.position);
      const x = colX(r);
      const top = cy - ROW_H;

      [match.itemA, match.itemB].forEach((item, idx) => {
        const y = top + idx * ROW_H;
        const bye = isBye(item);
        const isWinner = !bye && match.winner === item;
        boxes.push(
          <g key={`${match.matchId}-${idx}`}>
            <rect x={x} y={y} width={BOX_W} height={ROW_H}
              fill={isWinner ? '#dcfce7' : '#ffffff'} stroke="#cbd5e1" strokeWidth="1" />
            <text x={x + 8} y={y + ROW_H / 2} dominantBaseline="middle" fontSize="13"
              fontWeight={isWinner ? 700 : 400} fill={bye ? '#cbd5e1' : '#0f172a'}>
              {bye ? '—' : trunc(item)}
            </text>
          </g>
        );
      });

      // Elbow connector to the parent match in the next round
      if (r < totalRounds) {
        const childX = x + BOX_W;
        const parentY = centerY(r + 1, Math.floor(match.position / 2));
        const midX = childX + COL_GAP / 2;
        lines.push(
          <path key={`c-${match.matchId}`}
            d={`M ${childX} ${cy} H ${midX} V ${parentY} H ${colX(r + 1)}`}
            fill="none" stroke="#cbd5e1" strokeWidth="1.5" />
        );
      }
    });
  });

  // Champion column
  if (totalRounds > 0) {
    const cy = centerY(totalRounds, 0);
    lines.push(
      <path key="c-champ" d={`M ${colX(totalRounds) + BOX_W} ${cy} H ${champX}`}
        fill="none" stroke="#eab308" strokeWidth="2" />
    );
    labels.push(
      <text key="lbl-champ" x={champX + CHAMP_W / 2} y={PAD + LABEL_H / 2}
        textAnchor="middle" dominantBaseline="middle" fontSize="13" fontWeight="700" fill="#854d0e">
        Champion
      </text>
    );
    boxes.push(
      <g key="champ-box">
        <rect x={champX} y={cy - ROW_H / 2} width={CHAMP_W} height={ROW_H}
          fill="#fef9c3" stroke="#eab308" strokeWidth="2" rx="4" />
        <text x={champX + 8} y={cy} dominantBaseline="middle" fontSize="13" fontWeight="800" fill="#854d0e">
          🏆 {trunc(champion, 26)}
        </text>
      </g>
    );
  }

  return (
    <div style={styles.page}>
      <style>{`
        @media print {
          @page { size: letter landscape; margin: 0.35in; }
          body * { visibility: hidden; }
          .bracket-print, .bracket-print * { visibility: visible; }
          .bracket-print { position: fixed; left: 0; top: 0; width: 100%; height: 100%;
            overflow: hidden; background: #fff; margin: 0; padding: 0; }
          .bracket-print svg { width: 100% !important; height: 100% !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div style={styles.toolbar} className="no-print">
        <button style={styles.btn} onClick={onBack}>← Back</button>
        <div style={{ flex: 1 }} />
        <button style={styles.btn} onClick={() => setZoom(z => Math.max(0.3, +(z - 0.15).toFixed(2)))}>－</button>
        <span style={styles.zoom}>{Math.round(zoom * 100)}%</span>
        <button style={styles.btn} onClick={() => setZoom(z => Math.min(3, +(z + 0.15).toFixed(2)))}>＋</button>
        <button style={styles.btn} onClick={() => setZoom(1)}>Reset</button>
        <button style={styles.btnPrimary} onClick={() => window.print()}>🖨 Print</button>
      </div>

      <div style={styles.scroll} className="bracket-print">
        <svg viewBox={`0 0 ${naturalW} ${naturalH}`} width={naturalW * zoom} height={naturalH * zoom}
          style={{ display: 'block' }} xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width={naturalW} height={naturalH} fill="#ffffff" />
          {labels}
          {lines}
          {boxes}
        </svg>
      </div>
    </div>
  );
}

const styles = {
  page: { height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc' },
  btn: { padding: '8px 14px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnPrimary: { padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  zoom: { minWidth: 48, textAlign: 'center', fontSize: 14, color: '#475569', fontWeight: 600 },
  scroll: { flex: 1, overflow: 'auto', background: '#f1f5f9', padding: 16 },
};
