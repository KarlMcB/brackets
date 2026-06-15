const { db } = require('../firebase');
const { resolveMatch, advanceRound, pointsForRound } = require('../gameLogic');

const timers = {};

// Firestore turns arrays into maps when you update nested fields with dot notation.
// Always read-modify-write the full matches array to keep it as an array.
async function getGame(gameId) {
  const ref = db.collection('games').doc(gameId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const game = doc.data();
  // Heal Firestore map-to-array corruption if it happened
  if (game.matches && !Array.isArray(game.matches)) {
    game.matches = Object.values(game.matches);
  }
  return { ref, game };
}

function registerHandlers(io, socket) {
  // Host joins room without being counted as a player
  socket.on('spectate', async ({ gameId }) => {
    const result = await getGame(gameId);
    if (!result) return socket.emit('error', 'Game not found');
    socket.join(gameId);
    socket.emit('spectating', { gameState: result.game });
  });

  // Player joins a game room
  socket.on('join_game', async ({ gameId, playerName }) => {
    const result = await getGame(gameId);
    if (!result) return socket.emit('error', 'Game not found');
    const { ref } = result;

    const sessionToken = require('crypto').randomUUID();
    const player = { name: playerName, score: 0, sessionToken };

    await ref.update({ [`players.${sessionToken}`]: player });

    socket.join(gameId);
    socket.emit('joined', { sessionToken, gameState: result.game });
    io.to(gameId).emit('player_joined', { name: playerName });
  });

  // Host starts the game
  socket.on('start_game', async ({ gameId }) => {
    const result = await getGame(gameId);
    if (!result) return socket.emit('error', 'Game not found');
    const { ref, game } = result;

    if (game.status !== 'lobby') return socket.emit('error', 'Game already started');

    await ref.update({ status: 'active' });
    await startMatch(io, gameId, 0);
  });

  // Player submits a vote
  socket.on('vote', async ({ gameId, sessionToken, matchId, choice }) => {
    const result = await getGame(gameId);
    if (!result) return socket.emit('error', 'Game not found');
    const { ref, game } = result;

    const matchIndex = game.matches.findIndex(m => m.matchId === matchId);
    if (matchIndex === -1) return socket.emit('error', 'Match not found');

    const match = game.matches[matchIndex];
    if (match.winner) return socket.emit('error', 'Match already resolved');
    if (choice !== match.itemA && choice !== match.itemB)
      return socket.emit('error', 'Invalid choice');

    // Read-modify-write the full array to avoid Firestore map corruption
    const matches = [...game.matches];
    matches[matchIndex] = {
      ...matches[matchIndex],
      votes: { ...(matches[matchIndex].votes || {}), [sessionToken]: choice },
    };
    await ref.update({ matches });

    const voteCount = Object.keys(matches[matchIndex].votes).length;
    const playerCount = Object.keys(game.players).length;
    io.to(gameId).emit('vote_received', { matchId, playerCount: voteCount });

    if (voteCount >= playerCount) {
      clearTimer(gameId);
      await resolveCurrentMatch(io, gameId);
    }
  });
}

async function startMatch(io, gameId, matchIndex) {
  const result = await getGame(gameId);
  if (!result) return;
  const { ref, game } = result;
  const match = game.matches[matchIndex];

  let deadline = null;
  const matches = [...game.matches];

  if (game.timeLimitSeconds > 0) {
    deadline = Date.now() + game.timeLimitSeconds * 1000;
    matches[matchIndex] = { ...matches[matchIndex], deadline };

    timers[gameId] = setTimeout(async () => {
      await resolveCurrentMatch(io, gameId);
    }, game.timeLimitSeconds * 1000);
  }

  await ref.update({ matches, currentMatchIndex: matchIndex });
  io.to(gameId).emit('match_started', { match: { ...match, deadline } });
}

async function resolveCurrentMatch(io, gameId) {
  const result = await getGame(gameId);
  if (!result) return;
  const { ref, game } = result;

  const matchIndex = game.currentMatchIndex;
  const match = game.matches[matchIndex];
  if (match.winner) return;

  const winner = resolveMatch(match);

  // Score players who voted correctly
  const players = { ...game.players };
  for (const [token, vote] of Object.entries(match.votes || {})) {
    if (vote === winner && players[token]) {
      players[token] = {
        ...players[token],
        score: (players[token].score || 0) + pointsForRound(match.round),
      };
    }
  }

  // Write winner into the matches array (read-modify-write)
  const matches = [...game.matches];
  matches[matchIndex] = { ...matches[matchIndex], winner };

  await ref.update({ matches, players });

  io.to(gameId).emit('match_resolved', { matchId: match.matchId, winner });

  const updatedResult = await getGame(gameId);
  if (updatedResult) {
    await advanceIfRoundComplete(io, gameId, updatedResult.game, match.round, matchIndex);
  }
}

async function advanceIfRoundComplete(io, gameId, game, round, resolvedIndex) {
  const ref = db.collection('games').doc(gameId);
  const roundMatches = game.matches.filter(m => m.round === round);
  const allDone = roundMatches.every(m => m.winner !== null);

  if (!allDone) {
    const nextIndex = resolvedIndex + 1;
    if (nextIndex < game.matches.length && game.matches[nextIndex].round === round) {
      await startMatch(io, gameId, nextIndex);
    }
    return;
  }

  const winners = roundMatches.map(m => m.winner).filter(w => !w.startsWith('BYE_'));

  if (winners.length === 1) {
    await ref.update({ status: 'complete' });
    const finalResult = await getGame(gameId);
    const leaderboard = Object.values(finalResult.game.players)
      .sort((a, b) => b.score - a.score)
      .map(({ name, score }) => ({ name, score }));
    io.to(gameId).emit('game_complete', { champion: winners[0], leaderboard });
    return;
  }

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
