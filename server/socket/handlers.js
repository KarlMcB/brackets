const { db } = require('../firebase');
const { resolveMatch, advanceRound, pointsForRound } = require('../gameLogic');

// Active timers keyed by gameId — kept in memory on the server
const timers = {};

function registerHandlers(io, socket) {
  // Player joins a game room
  socket.on('join_game', async ({ gameId, playerName }) => {
    const ref = db.collection('games').doc(gameId);
    const doc = await ref.get();
    if (!doc.exists) return socket.emit('error', 'Game not found');

    const sessionToken = require('crypto').randomUUID();
    const player = { name: playerName, score: 0, sessionToken };

    await ref.update({ [`players.${sessionToken}`]: player });

    socket.join(gameId);
    socket.emit('joined', { sessionToken, gameState: doc.data() });
    io.to(gameId).emit('player_joined', { name: playerName });
  });

  // Host starts the game
  socket.on('start_game', async ({ gameId }) => {
    const ref = db.collection('games').doc(gameId);
    const doc = await ref.get();
    if (!doc.exists) return socket.emit('error', 'Game not found');

    const game = doc.data();
    if (game.status !== 'lobby') return socket.emit('error', 'Game already started');

    await ref.update({ status: 'active' });
    await startMatch(io, gameId, 0);
  });

  // Player submits a vote
  socket.on('vote', async ({ gameId, sessionToken, matchId, choice }) => {
    const ref = db.collection('games').doc(gameId);
    const doc = await ref.get();
    if (!doc.exists) return socket.emit('error', 'Game not found');

    const game = doc.data();
    const matchIndex = game.matches.findIndex(m => m.matchId === matchId);
    if (matchIndex === -1) return socket.emit('error', 'Match not found');

    const match = game.matches[matchIndex];
    if (match.winner) return socket.emit('error', 'Match already resolved');
    if (choice !== match.itemA && choice !== match.itemB)
      return socket.emit('error', 'Invalid choice');

    // Record vote (one per player, last vote wins if they change)
    await ref.update({ [`matches.${matchIndex}.votes.${sessionToken}`]: choice });
    io.to(gameId).emit('vote_received', { matchId, playerCount: Object.keys(match.votes).length + 1 });

    // If all players have voted, resolve early
    const updatedDoc = await ref.get();
    const updatedGame = updatedDoc.data();
    const updatedMatch = updatedGame.matches[matchIndex];
    const playerCount = Object.keys(updatedGame.players).length;
    const voteCount = Object.keys(updatedMatch.votes).length;

    if (voteCount >= playerCount) {
      clearTimer(gameId);
      await resolveCurrentMatch(io, gameId);
    }
  });
}

async function startMatch(io, gameId, matchIndex) {
  const ref = db.collection('games').doc(gameId);
  const doc = await ref.get();
  const game = doc.data();
  const match = game.matches[matchIndex];

  let deadline = null;
  if (game.timeLimitSeconds > 0) {
    deadline = Date.now() + game.timeLimitSeconds * 1000;
    await ref.update({ [`matches.${matchIndex}.deadline`]: deadline });

    timers[gameId] = setTimeout(async () => {
      await resolveCurrentMatch(io, gameId);
    }, game.timeLimitSeconds * 1000);
  }

  await ref.update({ currentMatchIndex: matchIndex });
  io.to(gameId).emit('match_started', { match: { ...match, deadline } });
}

async function resolveCurrentMatch(io, gameId) {
  const ref = db.collection('games').doc(gameId);
  const doc = await ref.get();
  const game = doc.data();
  const matchIndex = game.currentMatchIndex;
  const match = game.matches[matchIndex];

  if (match.winner) return; // already resolved

  const { resolveMatch } = require('../gameLogic');
  const winner = resolveMatch(match);

  // Score players who voted for the winner
  const scoreUpdates = {};
  for (const [token, vote] of Object.entries(match.votes || {})) {
    if (vote === winner && game.players[token]) {
      const pts = pointsForRound(match.round);
      const current = game.players[token].score || 0;
      scoreUpdates[`players.${token}.score`] = current + pts;
    }
  }

  await ref.update({
    [`matches.${matchIndex}.winner`]: winner,
    ...scoreUpdates,
  });

  io.to(gameId).emit('match_resolved', { matchId: match.matchId, winner });

  // Check if this was the last match in the round
  const updatedDoc = await ref.get();
  const updatedGame = updatedDoc.data();
  await advanceIfRoundComplete(io, gameId, updatedGame, match.round, matchIndex);
}

async function advanceIfRoundComplete(io, gameId, game, round, resolvedIndex) {
  const ref = db.collection('games').doc(gameId);
  const roundMatches = game.matches.filter(m => m.round === round);
  const allDone = roundMatches.every(m => m.winner !== null);

  if (!allDone) {
    // Move to the next match in this round
    const nextIndex = resolvedIndex + 1;
    if (nextIndex < game.matches.length && game.matches[nextIndex].round === round) {
      await startMatch(io, gameId, nextIndex);
    }
    return;
  }

  const winners = roundMatches.map(m => m.winner).filter(w => !w.startsWith('BYE_'));

  if (winners.length === 1) {
    // Tournament over
    await ref.update({ status: 'complete' });
    const finalDoc = await ref.get();
    const finalGame = finalDoc.data();
    const leaderboard = Object.values(finalGame.players)
      .sort((a, b) => b.score - a.score)
      .map(({ name, score }) => ({ name, score }));

    io.to(gameId).emit('game_complete', { champion: winners[0], leaderboard });
    return;
  }

  // Build next round and append to matches array
  const nextRound = round + 1;
  const nextMatches = advanceRound(winners, nextRound);
  const allMatches = [...game.matches, ...nextMatches];
  await ref.update({ matches: allMatches });

  io.to(gameId).emit('round_complete', { round, nextRound });

  const nextIndex = allMatches.findIndex(m => m.round === nextRound);
  await startMatch(io, gameId, nextIndex);
}

function clearTimer(gameId) {
  if (timers[gameId]) {
    clearTimeout(timers[gameId]);
    delete timers[gameId];
  }
}

module.exports = { registerHandlers };
