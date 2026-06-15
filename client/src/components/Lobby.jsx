import { useState, useEffect } from 'react';
import socket from '../socket';

export default function Lobby({ gameId, isHost, onMatchStarted }) {
  const [playerName, setPlayerName] = useState('');
  const [joined, setJoined] = useState(isHost);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    socket.connect();

    // Host joins the socket room as a spectator so they receive player_joined events
    if (isHost) {
      socket.emit('spectate', { gameId });
    }

    socket.on('player_joined', ({ name }) => {
      setPlayers(prev => [...prev, name]);
    });

    socket.on('match_started', ({ match }) => {
      onMatchStarted(match);
    });

    socket.on('error', msg => setError(msg));

    return () => {
      socket.off('player_joined');
      socket.off('match_started');
      socket.off('error');
    };
  }, [isHost, gameId, onMatchStarted]);

  function join() {
    if (!playerName.trim()) return setError('Enter your name');
    socket.emit('join_game', { gameId, playerName: playerName.trim() });
    setJoined(true);
    setPlayers(prev => [...prev, playerName.trim()]);
  }

  function startGame() {
    socket.emit('start_game', { gameId });
  }

  const shareUrl = `${window.location.origin}?join=${gameId}`;

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>🏆 Bracket Game</h1>
      <div style={styles.gameCode}>Game Code: <strong>{gameId}</strong></div>

      {!joined ? (
        <div style={styles.joinBox}>
          <label style={styles.label}>Your Name</label>
          <input
            style={styles.input}
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && join()}
            placeholder="Enter your name"
            autoFocus
          />
          {error && <div style={styles.error}>{error}</div>}
          <button style={styles.btnPrimary} onClick={join}>Join Game</button>
        </div>
      ) : (
        <div style={styles.waitBox}>
          <div style={styles.waiting}>{isHost ? '👥 Waiting for players to join...' : '⏳ Waiting for host to start...'}</div>

          <div style={styles.shareBox}>
            <div style={styles.shareLabel}>Share this link with players:</div>
            <div style={styles.shareUrl}>{shareUrl}</div>
            <button style={styles.btnSecondary} onClick={() => navigator.clipboard.writeText(shareUrl)}>
              Copy Link
            </button>
          </div>

          <div style={styles.playerList}>
            <div style={styles.playerListHeader}>Players ({players.length})</div>
            {players.map((p, i) => (
              <div key={i} style={styles.playerItem}>👤 {p}</div>
            ))}
          </div>

          {isHost && (
            <button style={styles.btnPrimary} onClick={startGame}>
              Start Game
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: 480, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif' },
  heading: { textAlign: 'center', fontSize: 32, marginBottom: 8 },
  gameCode: { textAlign: 'center', fontSize: 18, color: '#555', marginBottom: 28 },
  joinBox: { display: 'flex', flexDirection: 'column', gap: 12 },
  waitBox: { display: 'flex', flexDirection: 'column', gap: 20 },
  waiting: { textAlign: 'center', fontSize: 18, color: '#555' },
  label: { fontWeight: 600 },
  input: { padding: '10px 12px', fontSize: 15, borderRadius: 8, border: '1px solid #ccc' },
  error: { color: '#c0392b', fontSize: 14 },
  shareBox: { background: '#f7f7f7', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 },
  shareLabel: { fontWeight: 600, fontSize: 14 },
  shareUrl: { fontSize: 13, color: '#2563eb', wordBreak: 'break-all' },
  playerList: { border: '1px solid #e0e0e0', borderRadius: 10, overflow: 'hidden' },
  playerListHeader: { padding: '8px 14px', background: '#f7f7f7', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #e0e0e0' },
  playerItem: { padding: '8px 14px', borderBottom: '1px solid #f0f0f0' },
  btnPrimary: { padding: '14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  btnSecondary: { padding: '8px 14px', background: '#e0e0e0', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, alignSelf: 'flex-start' },
};
