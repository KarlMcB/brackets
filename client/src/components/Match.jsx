import { useState, useEffect } from 'react';
import socket from '../socket';

export default function Match({ match: initialMatch, sessionToken, gameId, isHost, onMatchResolved, onGameComplete }) {
  const [match, setMatch] = useState(initialMatch);
  const [voted, setVoted] = useState(null);
  const [winner, setWinner] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const [tally, setTally] = useState({ votes: 0, total: 0 });

  useEffect(() => {
    setMatch(initialMatch);
    setVoted(null);
    setWinner(null);
    setTally({ votes: 0, total: 0 });

    if (initialMatch.deadline) {
      const remaining = Math.max(0, Math.ceil((initialMatch.deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
    } else {
      setTimeLeft(null);
    }
  }, [initialMatch]);

  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, match.matchId]);

  useEffect(() => {
    socket.on('vote_received', ({ matchId, votes, total }) => {
      if (matchId === match.matchId) setTally({ votes, total });
    });

    socket.on('match_resolved', ({ matchId, winner: w }) => {
      if (matchId === match.matchId) {
        setWinner(w);
        setTimeout(() => onMatchResolved(w), 2000);
      }
    });

    socket.on('match_started', ({ match: nextMatch }) => {
      onMatchResolved(null, nextMatch);
    });

    socket.on('game_complete', ({ champion, leaderboard }) => {
      onGameComplete(champion, leaderboard);
    });

    return () => {
      socket.off('vote_received');
      socket.off('match_resolved');
      socket.off('match_started');
      socket.off('game_complete');
    };
  }, [match.matchId, onMatchResolved, onGameComplete]);

  function vote(choice) {
    if (isHost || voted || winner) return; // host spectates and cannot vote
    socket.emit('vote', { gameId, sessionToken, matchId: match.matchId, choice });
    setVoted(choice);
  }

  const isBye = (item) => item?.startsWith('BYE_');

  return (
    <div style={styles.container}>
      <div style={styles.meta}>Round {match.round} · Match {match.position + 1}</div>
      <h2 style={styles.heading}>{isHost ? 'Live Voting' : 'Vote Now'}</h2>

      {timeLeft !== null && (
        <div style={{ ...styles.timer, color: timeLeft <= 10 ? '#e53e3e' : '#333' }}>
          ⏱ {timeLeft}s remaining
        </div>
      )}

      {tally.total > 0 && (
        <div style={styles.voteCount}>{tally.votes} of {tally.total} voted</div>
      )}

      <div style={styles.matchup}>
        {[match.itemA, match.itemB].map((item) => {
          if (isBye(item)) return null;
          const isVoted = voted === item;
          const isWinner = winner === item;
          const isLoser = winner && winner !== item;
          return (
            <button
              key={item}
              style={{
                ...styles.choiceBtn,
                ...(isVoted ? styles.voted : {}),
                ...(isWinner ? styles.winnerBtn : {}),
                ...(isLoser ? styles.loserBtn : {}),
                ...(isHost && !winner ? styles.spectate : {}),
              }}
              onClick={() => vote(item)}
              disabled={isHost || !!voted || !!winner}
            >
              {item}
              {isWinner && <span style={styles.winBadge}>✓ Winner</span>}
              {isVoted && !winner && <span style={styles.votedBadge}>Your vote</span>}
            </button>
          );
        })}
      </div>

      {winner && <div style={styles.resolved}>🎉 <strong>{winner}</strong> advances!</div>}
      {isHost && !winner && <div style={styles.waiting}>Watching live — players are voting…</div>}
      {!isHost && voted && !winner && <div style={styles.waiting}>Waiting for other votes...</div>}
    </div>
  );
}

const styles = {
  container: { maxWidth: 480, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif', textAlign: 'center' },
  meta: { color: '#888', fontSize: 14, marginBottom: 4 },
  heading: { fontSize: 28, marginBottom: 12 },
  timer: { fontSize: 20, fontWeight: 700, marginBottom: 8 },
  voteCount: { color: '#888', fontSize: 14, marginBottom: 16 },
  matchup: { display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 },
  choiceBtn: {
    padding: '24px 20px', fontSize: 20, fontWeight: 700, borderRadius: 14,
    border: '2px solid #e0e0e0', background: '#fff', cursor: 'pointer',
    transition: 'all 0.15s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
  },
  voted: { border: '2px solid #2563eb', background: '#eff6ff' },
  spectate: { cursor: 'default', opacity: 0.85 },
  winnerBtn: { border: '2px solid #16a34a', background: '#f0fdf4' },
  loserBtn: { opacity: 0.4 },
  winBadge: { fontSize: 13, fontWeight: 600, color: '#16a34a' },
  votedBadge: { fontSize: 13, fontWeight: 600, color: '#2563eb' },
  resolved: { marginTop: 28, fontSize: 20, color: '#16a34a' },
  waiting: { marginTop: 20, color: '#888', fontSize: 15 },
};
