import { useState, useEffect } from 'react';
import HostSetup from './components/HostSetup';
import Lobby from './components/Lobby';
import Match from './components/Match';
import Results from './components/Results';

const API_BASE = import.meta.env.VITE_API_URL || '';
const HOST_KEY = 'brackets:host';

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

// Screens: setup | lobby | match | results
export default function App() {
  const [screen, setScreen] = useState('setup');
  const [gameId, setGameId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [hostToken, setHostToken] = useState(null);
  const [sessionToken, setSessionToken] = useState(null);
  const [currentMatch, setCurrentMatch] = useState(null);
  const [champion, setChampion] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  // On load: a ?join link makes you a player; otherwise try to recover a host session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinId = params.get('join');
    if (joinId) {
      setGameId(joinId.toUpperCase());
      setIsHost(false);
      setScreen('lobby');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    // Host refresh recovery: if the saved game still exists and isn't over, rejoin
    // as host in the lobby. The server resyncs us to the live match if one's active.
    const saved = loadHostSession();
    if (saved?.gameId && saved?.hostToken) {
      fetch(`${API_BASE}/api/games/${saved.gameId}`)
        .then(r => (r.ok ? r.json() : null))
        .then(game => {
          if (!game || game.status === 'complete') { clearHostSession(); return; }
          setGameId(saved.gameId);
          setHostToken(saved.hostToken);
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
    clearHostSession(); // game is over — nothing left to host
    setChampion(champ);
    setLeaderboard(board);
    setScreen('results');
  }

  function reset() {
    clearHostSession();
    setScreen('setup');
    setGameId(null);
    setIsHost(false);
    setHostToken(null);
    setSessionToken(null);
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
        onJoined={setSessionToken}
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
