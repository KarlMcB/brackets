import { useState, useEffect } from 'react';
import HostSetup from './components/HostSetup';
import Lobby from './components/Lobby';
import Match from './components/Match';
import Results from './components/Results';

// Screens: setup | lobby | match | results
export default function App() {
  const [screen, setScreen] = useState('setup');
  const [gameId, setGameId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [sessionToken, setSessionToken] = useState(null);
  const [currentMatch, setCurrentMatch] = useState(null);
  const [champion, setChampion] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  // Handle ?join=GAMEID in the URL (player joining via shared link)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinId = params.get('join');
    if (joinId) {
      setGameId(joinId.toUpperCase());
      setIsHost(false);
      setScreen('lobby');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  function handleGameCreated(id) {
    setGameId(id);
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
    setChampion(champ);
    setLeaderboard(board);
    setScreen('results');
  }

  function reset() {
    setScreen('setup');
    setGameId(null);
    setIsHost(false);
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
        onMatchResolved={handleMatchResolved}
        onGameComplete={handleGameComplete}
      />
    );
  }

  if (screen === 'results') {
    return <Results champion={champion} leaderboard={leaderboard} onPlayAgain={reset} />;
  }
}
