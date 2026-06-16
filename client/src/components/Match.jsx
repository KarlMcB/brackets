import { useState, useEffect } from 'react';
import socket from '../socket';

export default function Match({ match: initialMatch, sessionToken, gameId, isHost, hostToken, onMatchResolved, onGameComplete }) {
  const [match, setMatch] = useState(initialMatch);
  const [voted, setVoted] = useState(null);
  const [winner, setWinner] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const [tally, setTally] = useState({ votes: 0, total: 0 });
  const [tiebreak, setTiebreak] = useState(null);     // { itemA, itemB } when tied
  const [leaders, setLeaders] = useState([]);         // top-5 standings

  // Pull current standings as soon as the match view appears (covers reconnects)
  useEffect(() => {
    socket.emit('get_leaderboard', { gameId });
  }, [gameId]);

  useEffect(() => {
    setMatch(initialMatch);
    // Restore our prior selection when resuming a match we'd already voted on
    setVoted(initialMatch.yourVote ?? null);
    setWinner(null);
    setTally({ votes: 0, total: 0 });
    // Restore tiebreak state if we (re)joined a match already parked for a tie
    setTiebreak(initialMatch.tiebreak ? { itemA: initialMatch.itemA, itemB: initialMatch.itemB } : null);

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

    socket.on('tiebreak_needed', ({ matchId, itemA, itemB }) => {
      if (matchId === match.matchId) setTiebreak({ itemA, itemB });
    });

    socket.on('match_resolved', ({ matchId, winner: w }) => {
      if (matchId === match.matchId) {
        setTiebreak(null);
        setWinner(w);
        setTimeout(() => onMatchResolved(w), 2000);
      }
    });

    socket.on('match_started', ({ match: nextMatch }) => {
      onMatchResolved(null, nextMatch);
    });

    socket.on('leaderboard_update', ({ top }) => setLeaders(top));

    socket.on('game_complete', ({ champion, leaderboard, matches, totalRounds }) => {
      onGameComplete(champion, leaderboard, matches, totalRounds);
    });

    return () => {
      socket.off('vote_received');
      socket.off('tiebreak_needed');
      socket.off('match_resolved');
      socket.off('match_started');
      socket.off('leaderboard_update');
      socket.off('game_complete');
    };
  }, [match.matchId, onMatchResolved, onGameComplete]);

  function vote(choice) {
    // During a tiebreak, only the host can act — and it picks the winner
    if (tiebreak) {
      if (isHost && !winner) socket.emit('break_tie', { gameId, hostToken, matchId: match.matchId, choice });
      return;
    }
    if (isHost || voted || winner) return; // host spectates and cannot vote
    socket.emit('vote', { gameId, sessionToken, matchId: match.matchId, choice });
    setVoted(choice);
  }

  function skip() {
    socket.emit('skip_match', { gameId, hostToken });
  }

  const isBye = (item) => item?.startsWith('BYE_');
  const canClick = (item) =>
    tiebreak ? isHost && !winner : !isHost && !voted && !winner;

  return (
    <div style={styles.container}>
      <div style={styles.meta}>Round {match.round} · Match {match.position + 1}</div>
      <h2 style={styles.heading}>{isHost ? 'Live Voting' : 'Vote Now'}</h2>

      {timeLeft !== null && !tiebreak && !winner && (
        <div style={{ ...styles.timer, color: timeLeft <= 10 ? '#e53e3e' : '#333' }}>
          ⏱ {timeLeft}s remaining
        </div>
      )}

      {tiebreak && (
        <div style={styles.tieBanner}>
          🔔 It's a tie! {isHost ? 'You decide the winner:' : 'Waiting for the host to choose…'}
        </div>
      )}

      {tally.total > 0 && !tiebreak && (
        <div style={styles.voteCount}>{tally.votes} of {tally.total} voted</div>
      )}

      <div style={styles.matchup}>
        {[match.itemA, match.itemB].map((item) => {
          if (isBye(item)) return null;
          const isVoted = voted === item;
          const isWinner = winner === item;
          const isLoser = winner && winner !== item;
          const clickable = canClick(item);
          return (
            <button
              key={item}
              style={{
                ...styles.choiceBtn,
                ...(isVoted ? styles.voted : {}),
                ...(isWinner ? styles.winnerBtn : {}),
                ...(isLoser ? styles.loserBtn : {}),
                ...(tiebreak && isHost && !winner ? styles.tiePick : {}),
                ...(!clickable && !winner && !isVoted ? styles.spectate : {}),
              }}
              onClick={() => vote(item)}
              disabled={!clickable}
            >
              {item}
              {isWinner && <span style={styles.winBadge}>✓ Winner</span>}
              {isVoted && !winner && <span style={styles.votedBadge}>Your vote</span>}
            </button>
          );
        })}
      </div>

      {winner && <div style={styles.resolved}>🎉 <strong>{winner}</strong> advances!</div>}
      {isHost && !winner && !tiebreak && (
        <>
          <div style={styles.waiting}>Watching live — players are voting…</div>
          <button style={styles.skipBtn} onClick={skip}>⏭ Skip / end match now</button>
        </>
      )}
      {!isHost && voted && !winner && !tiebreak && <div style={styles.waiting}>Waiting for other votes...</div>}

      {leaders.length > 0 && (
        <div style={styles.board}>
          <div style={styles.boardTitle}>🏆 Top 5</div>
          {leaders.map((p, i) => (
            <div key={i} style={styles.boardRow}>
              <span style={styles.boardRank}>{i + 1}</span>
              <span style={styles.boardName}>{p.name}</span>
              <span style={styles.boardScore}>{p.score}</span>
            </div>
          ))}
        </div>
      )}
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
  skipBtn: { marginTop: 16, padding: '10px 20px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  tieBanner: { marginBottom: 12, padding: '10px 14px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, fontWeight: 600, color: '#92400e' },
  tiePick: { border: '2px solid #d97706', cursor: 'pointer', opacity: 1 },
  board: { marginTop: 32, textAlign: 'left', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' },
  boardTitle: { padding: '8px 14px', background: '#f9fafb', fontWeight: 700, fontSize: 14, borderBottom: '1px solid #e5e7eb' },
  boardRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderBottom: '1px solid #f3f4f6' },
  boardRank: { width: 20, color: '#9ca3af', fontWeight: 700, fontSize: 14 },
  boardName: { flex: 1, fontWeight: 600, fontSize: 15 },
  boardScore: { fontWeight: 700, color: '#2563eb', fontSize: 15 },
};
