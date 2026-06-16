import { useState, useEffect } from 'react';
import HostSetup from './components/HostSetup';
import Lobby from './components/Lobby';
import Match from './components/Match';
import Results from './components/Results';

const API_BASE = import.meta.env.VITE_API_URL || '';
const HOST_KEY = 'brackets:host';
const PLAYER_KEY = 'brackets:player';

// Persist the host session so a refresh can recover control of the game.
const saveHostSession = (gameId, hostToken) => {
  try { localStorage.setItem(HOST_KEY, JSON.stringify({ gameId, hostToken })); } catch { /* ignore */ }
};
const loadHostSession = () => {
  try { return JSON.parse(localStorage.getItem(HOST_KEY)); } catch { return null; }
};
const clearHostSession = () => {
  try { localStorage.removeItem(HOST_KEY); } catch { /* ignore */ }
};

// Persist the player session so a refresh keeps the same identity (name + score).
const savePlayerSession = (gameId, sessionToken) => {
  try { localStorage.setItem(PLAYER_KEY, JSON.stringify({ gameId, sessionToken })); } catch { /* ignore */ }
};
const loadPlayerSession = () => {
  try { return JSON.parse(localStorage.getItem(PLAYER_KEY)); } catch { return null; }
};
const clearPlayerSession = () => {
  try { localStorage.removeItem(PLAYER_KEY); } catch { /* ignore */ }
};

// Screens: setup | lobby | match | results
export default function App() {
  const [screen, setScreen] = useState('setup');
  const [gameId, setGameId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [hostToken, setHostToken] = useState(null);
  const [sessionToken, setSessionToken] = useState(null);
  const [resumeToken, setResumeToken] = useState(null); // saved player token to rejoin with
  const [currentMatch, setCurrentMatch] = useState(null);
  const [champion, setChampion] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  // On load, restore the right context. Priority: an active player session (so a
  // refresh keeps your identity) → a ?join link → a host session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinId = params.get('join')?.toUpperCase() || null;
    const clearUrl = () => window.history.replaceState({}, '', window.location.pathname);

    const player = loadPlayerSession();
    // Recover a player session when we're not being pointed at a different game.
    if (player?.gameId && player?.sessionToken && (!joinId || joinId === player.gameId)) {
      fetch(`${API_BASE}/api/games/${player.gameId}`)
        .then(r => (r.ok ? r.json() : null))
        .then(game => {
          if (!game || game.status === 'complete') { clearPlayerSession(); return; }
          setGameId(player.gameId);
          setResumeToken(player.sessionToken); // Lobby will emit rejoin_game with this
          setIsHost(false);
          setScreen('lobby');
        })
        .catch(() => { /* offline — stay on setup */ });
      clearUrl();
      return;
    }

    // Joining a (different) game via share link — start fresh as a player.
    if (joinId) {
      if (player) clearPlayerSession();
      setGameId(joinId);
      setIsHost(false);
      setScreen('lobby');
      clearUrl();
      return;
    }

    // Host refresh recovery: if the saved game still exists and isn't over, rejoin
    // as host in the lobby. The server resyncs us to the live match if one's active.
    const host = loadHostSession();
    if (host?.gameId && host?.hostToken) {
      fetch(`${API_BASE}/api/games/${host.gameId}`)
        .then(r => (r.ok ? r.json() : null))
        .then(game => {
          if (!game || game.status === 'complete') { clearHostSession(); return; }
          setGameId(host.gameId);
          setHostToken(host.hostToken);
          setIsHost(true);
          setScreen('lobby');
        })
        .catch(() => { /* offline — stay on setup */ });
    }
  }, []);

  function handleGameCreated(id, token) {
    saveHostSession(id, token);
    setGameId(id);
    setHostToken(token);
    setIsHost(true);
    setScreen('lobby');
  }

  // A player joined or rejoined: remember their token so a refresh keeps it.
  function handleJoined(token) {
    savePlayerSession(gameId, token);
    setSessionToken(token);
    setResumeToken(null);
  }

  // Saved player token was rejected (stale/new game) — drop it and show the form.
  function handleResumeFailed() {
    clearPlayerSession();
    setResumeToken(null);
  }

  function handleMatchStarted(match) {
    setCurrentMatch(match);
    setScreen('match');
  }

  function handleMatchResolved(winner, nextMatch) {
    if (nextMatch) {
      setCurrentMatch(nextMatch);
    }
  }

  function handleGameComplete(champ, board) {
    clearHostSession();   // game is over — no session left to recover
    clearPlayerSession();
    setChampion(champ);
    setLeaderboard(board);
    setScreen('results');
  }

  function reset() {
    clearHostSession();
    clearPlayerSession();
    setScreen('setup');
    setGameId(null);
    setIsHost(false);
    setHostToken(null);
    setSessionToken(null);
    setResumeToken(null);
    setCurrentMatch(null);
    setChampion(null);
    setLeaderboard([]);
  }

  if (screen === 'setup') {
    return <HostSetup onGameCreated={handleGameCreated} />;
  }

  if (screen === 'lobby') {
    return (
      <Lobby
        gameId={gameId}
        isHost={isHost}
        hostToken={hostToken}
        resumeToken={resumeToken}
        onJoined={handleJoined}
        onResumeFailed={handleResumeFailed}
        onMatchStarted={handleMatchStarted}
      />
    );
  }

  if (screen === 'match') {
    return (
      <Match
        match={currentMatch}
        sessionToken={sessionToken}
        gameId={gameId}
        isHost={isHost}
        hostToken={hostToken}
        onMatchResolved={handleMatchResolved}
        onGameComplete={handleGameComplete}
      />
    );
  }

  if (screen === 'results') {
    return <Results champion={champion} leaderboard={leaderboard} onPlayAgain={reset} />;
  }
}
