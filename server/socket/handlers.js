const { db } = require('../firebase');
const { resolveMatch, advanceRound, pointsForRound } = require('../gameLogic');

const timers = {};

// Firestore stores matches as an array; if a stray dot-notation write ever turns
// it into a map, normalize it back to an array.
function asArray(matches) {
  return Array.isArray(matches) ? matches : Object.values(matches || {});
}

async function getGame(gameId) {
  const ref = db.collection('games').doc(gameId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const game = doc.data();
  game.matches = asArray(game.matches);
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

  // Player submits a vote. Votes live in voteMap (matchId -> token -> choice) and
  // are written with an atomic field update. Different players write different
  // keys, so concurrent votes never contend — no transaction, no lost votes.
  socket.on('vote', async ({ gameId, sessionToken, matchId, choice }) => {
    const result = await getGame(gameId);
    if (!result) return socket.emit('error', 'Game not found');
    const { ref, game } = result;

    // Only joined players may vote — ignores host/spectators and stale tokens
    if (!sessionToken || !game.players[sessionToken]) {
      return socket.emit('error', 'Only joined players can vote');
    }
    const match = game.matches.find(m => m.matchId === matchId);
    if (!match) return socket.emit('error', 'Match not found');
    if (match.winner) return socket.emit('error', 'Match already resolved');
    if (choice !== match.itemA && choice !== match.itemB)
      return socket.emit('error', 'Invalid choice');

    // Atomic single-field write — no read-modify-write, no contention
    await ref.update({ [`voteMap.${matchId}.${sessionToken}`]: choice });

    // Re-read to count votes; the last writer's read sees every committed vote
    const fresh = await getGame(gameId);
    const votes = (fresh.game.voteMap && fresh.game.voteMap[matchId]) || {};
    const voteCount = Object.keys(votes).length;
    const playerCount = Object.keys(fresh.game.players).length;
    io.to(gameId).emit('vote_received', { matchId, votes: voteCount, total: playerCount });

    // As soon as everyone who has joined has voted, advance to the next matchup.
    // When a time limit is set, the server timer in startMatch is the backstop
    // for players who don't vote in time.
    if (voteCount >= playerCount) {
      await resolveMatchById(io, gameId, matchId);
    }
  });

  // Host skips the current match: end it now with whatever votes exist and move on
  socket.on('skip_match', async ({ gameId }) => {
    const result = await getGame(gameId);
    if (!result) return socket.emit('error', 'Game not found');
    const { game } = result;
    if (game.status !== 'active') return;
    const match = game.matches[game.currentMatchIndex];
    if (!match || match.winner) return; // nothing to skip
    await resolveMatchById(io, gameId, match.matchId);
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
      await resolveMatchById(io, gameId, match.matchId);
    }, game.timeLimitSeconds * 1000);
  }

  await ref.update({ matches, currentMatchIndex: matchIndex });
  io.to(gameId).emit('match_started', { match: { ...match, deadline } });
}

// Resolve a SPECIFIC match by id, idempotently. Resolving by id (not by the
// live currentMatchIndex) means a duplicate/stale trigger for an already-resolved
// match is a harmless no-op — it can't accidentally resolve the next match.
async function resolveMatchById(io, gameId, matchId) {
  clearTimer(gameId); // cancel any pending timer so a match resolves only once
  const ref = db.collection('games').doc(gameId);

  let result;
  try {
    result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return null;
      const game = doc.data();
      const matches = asArray(game.matches);
      const idx = matches.findIndex(m => m.matchId === matchId);
      if (idx === -1) return null;
      const match = matches[idx];
      if (match.winner) return null; // already resolved — stale trigger, no-op

      const votes = (game.voteMap && game.voteMap[matchId]) || {};
      const winner = resolveMatch(match, votes);

      const players = { ...game.players };
      for (const [token, vote] of Object.entries(votes)) {
        if (vote === winner && players[token]) {
          players[token] = {
            ...players[token],
            score: (players[token].score || 0) + pointsForRound(match.round),
          };
        }
      }

      matches[idx] = { ...match, winner };
      tx.update(ref, { matches, players });
      return { winner, matchId, round: match.round, matchIndex: idx };
    });
  } catch {
    return;
  }
  if (!result) return;

  io.to(gameId).emit('match_resolved', { matchId: result.matchId, winner: result.winner });

  const updatedResult = await getGame(gameId);
  if (updatedResult) {
    await advanceIfRoundComplete(io, gameId, updatedResult.game, result.round, result.matchIndex);
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
