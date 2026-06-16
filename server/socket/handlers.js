const { db } = require('../firebase');
const { decideWinner, tallyMatch, advanceRound, pointsForRound } = require('../gameLogic');

const timers = {};

// Add round points to every player who voted for the winning item.
function applyScores(players, votes, winner, round) {
  const updated = { ...players };
  for (const [token, vote] of Object.entries(votes || {})) {
    if (vote === winner && updated[token]) {
      updated[token] = {
        ...updated[token],
        score: (updated[token].score || 0) + pointsForRound(round),
      };
    }
  }
  return updated;
}

// Compute the current top-5 standings.
function topFive(game) {
  return Object.values(game.players || {})
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ name, score }) => ({ name, score }));
}

// Broadcast the current top-5 standings to everyone in the game.
function emitLeaderboard(io, gameId, game) {
  io.to(gameId).emit('leaderboard_update', { top: topFive(game) });
}

// Bring a reconnecting host back to the live match (the match carries its own
// deadline and tiebreak flag, so the UI restores fully). The match view requests
// standings itself on mount via get_leaderboard.
function resyncSocket(socket, game) {
  if (game.status !== 'active') return;
  const match = game.matches[game.currentMatchIndex];
  if (!match || match.winner) return;
  socket.emit('match_started', { match });
}

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

// Never expose the host token (or raw voteMap) to clients.
function sanitize(game) {
  const { hostToken, voteMap, ...safe } = game;
  return safe;
}

function registerHandlers(io, socket) {
  // Host joins room without being counted as a player
  socket.on('spectate', async ({ gameId }) => {
    const result = await getGame(gameId);
    if (!result) return socket.emit('error', 'Game not found');
    socket.join(gameId);
    socket.emit('spectating', { gameState: sanitize(result.game) });
    resyncSocket(socket, result.game); // restore a reconnecting host to the live match
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
    socket.emit('joined', { sessionToken, gameState: sanitize(result.game) });
    io.to(gameId).emit('player_joined', { name: playerName });
  });

  // Host starts the game
  socket.on('start_game', async ({ gameId, hostToken }) => {
    const result = await getGame(gameId);
    if (!result) return socket.emit('error', 'Game not found');
    const { ref, game } = result;

    if (game.hostToken !== hostToken) return socket.emit('error', 'Not authorized');
    if (game.status !== 'lobby') return socket.emit('error', 'Game already started');

    await ref.update({ status: 'active' });
    emitLeaderboard(io, gameId, game); // initial standings (everyone at 0)
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
    if (match.tiebreak) return socket.emit('error', 'Voting closed — host is breaking a tie');
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
  socket.on('skip_match', async ({ gameId, hostToken }) => {
    const result = await getGame(gameId);
    if (!result) return socket.emit('error', 'Game not found');
    const { game } = result;
    if (game.hostToken !== hostToken) return socket.emit('error', 'Not authorized');
    if (game.status !== 'active') return;
    const match = game.matches[game.currentMatchIndex];
    if (!match || match.winner) return; // nothing to skip
    await resolveMatchById(io, gameId, match.matchId);
  });

  // Host breaks a tie by choosing the winner of a parked match
  socket.on('break_tie', async ({ gameId, hostToken, matchId, choice }) => {
    await breakTie(io, gameId, matchId, choice, hostToken);
  });

  // Any client can request the current standings (the match view does this on mount)
  socket.on('get_leaderboard', async ({ gameId }) => {
    const result = await getGame(gameId);
    if (!result) return;
    socket.emit('leaderboard_update', { top: topFive(result.game) });
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

// Close a SPECIFIC match by id, idempotently. If the vote is tied (and neither
// side is a bye), the match is parked in a 'tiebreak' state for the host to
// decide instead of resolving. Resolving by id (not the live currentMatchIndex)
// means a duplicate/stale trigger for an already-decided match is a harmless no-op.
async function resolveMatchById(io, gameId, matchId) {
  clearTimer(gameId); // cancel any pending timer so a match closes only once
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
      if (match.winner || match.tiebreak) return null; // already decided/awaiting host

      const votes = (game.voteMap && game.voteMap[matchId]) || {};
      const winner = decideWinner(match, votes);

      if (winner === null) {
        // Genuine tie — park the match and let the host choose
        const { a, b } = tallyMatch(match, votes);
        matches[idx] = { ...match, tiebreak: true };
        tx.update(ref, { matches });
        return { tie: true, matchId, itemA: match.itemA, itemB: match.itemB, votesA: a, votesB: b };
      }

      const players = applyScores(game.players, votes, winner, match.round);
      matches[idx] = { ...match, winner };
      tx.update(ref, { matches, players });
      return { winner, matchId, round: match.round, matchIndex: idx };
    });
  } catch {
    return;
  }
  if (!result) return;

  if (result.tie) {
    io.to(gameId).emit('tiebreak_needed', {
      matchId: result.matchId, itemA: result.itemA, itemB: result.itemB,
      votesA: result.votesA, votesB: result.votesB,
    });
    return; // wait for the host to break the tie
  }

  await afterResolved(io, gameId, result);
}

// Host breaks a tie by choosing the winner of a parked match.
async function breakTie(io, gameId, matchId, choice, hostToken) {
  const ref = db.collection('games').doc(gameId);
  let result;
  try {
    result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return null;
      const game = doc.data();
      if (game.hostToken !== hostToken) return null; // only the host may decide
      const matches = asArray(game.matches);
      const idx = matches.findIndex(m => m.matchId === matchId);
      if (idx === -1) return null;
      const match = matches[idx];
      if (match.winner || !match.tiebreak) return null; // not awaiting a tiebreak
      if (choice !== match.itemA && choice !== match.itemB) return null;

      const votes = (game.voteMap && game.voteMap[matchId]) || {};
      const players = applyScores(game.players, votes, choice, match.round);
      matches[idx] = { ...match, winner: choice, tiebreak: false };
      tx.update(ref, { matches, players });
      return { winner: choice, matchId, round: match.round, matchIndex: idx };
    });
  } catch {
    return;
  }
  if (!result) return;
  await afterResolved(io, gameId, result);
}

// Shared post-resolution path: announce the winner, push standings, advance.
async function afterResolved(io, gameId, result) {
  io.to(gameId).emit('match_resolved', { matchId: result.matchId, winner: result.winner });

  const updatedResult = await getGame(gameId);
  if (updatedResult) {
    emitLeaderboard(io, gameId, updatedResult.game);
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
