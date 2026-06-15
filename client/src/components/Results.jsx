export default function Results({ champion, leaderboard, onPlayAgain }) {
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>🏆 Champion</h1>
      <div style={styles.champion}>{champion}</div>

      <h2 style={styles.sub}>Leaderboard</h2>
      <div style={styles.board}>
        {leaderboard.map((p, i) => (
          <div key={i} style={{ ...styles.row, ...(i === 0 ? styles.first : {}) }}>
            <span style={styles.rank}>{medals[i] || `${i + 1}.`}</span>
            <span style={styles.name}>{p.name}</span>
            <span style={styles.score}>{p.score} pts</span>
          </div>
        ))}
      </div>

      <button style={styles.btn} onClick={onPlayAgain}>Play Again</button>
    </div>
  );
}

const styles = {
  container: { maxWidth: 480, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif', textAlign: 'center' },
  heading: { fontSize: 32, marginBottom: 8 },
  champion: { fontSize: 36, fontWeight: 800, color: '#d97706', marginBottom: 32, padding: '20px', background: '#fffbeb', borderRadius: 16, border: '2px solid #fcd34d' },
  sub: { fontSize: 22, marginBottom: 16 },
  board: { border: '1px solid #e0e0e0', borderRadius: 12, overflow: 'hidden', marginBottom: 32 },
  row: { display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f0f0f0', gap: 12 },
  first: { background: '#fffbeb' },
  rank: { fontSize: 22, width: 36 },
  name: { flex: 1, textAlign: 'left', fontWeight: 600, fontSize: 16 },
  score: { fontWeight: 700, color: '#2563eb', fontSize: 16 },
  btn: { padding: '14px 40px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer' },
};
