const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../firebase');
const { buildBracket } = require('../gameLogic');

const router = express.Router();

// POST /api/games — host creates a new game
router.post('/', async (req, res) => {
  const { title, items, timeLimitSeconds } = req.body;

  if (!title || !Array.isArray(items) || items.length < 2) {
    return res.status(400).json({ error: 'title and at least 2 items required' });
  }

  // Enforce power-of-2 size
  const size = nextPowerOfTwo(items.length);
  const padded = [...items];
  while (padded.length < size) padded.push(`BYE_${padded.length}`);

  const gameId = uuidv4().slice(0, 8).toUpperCase();
  const firstRoundMatches = buildBracket(padded);

  const game = {
    gameId,
    title,
    timeLimitSeconds: timeLimitSeconds || 0,
    status: 'lobby',       // lobby | active | complete
    currentMatchIndex: 0,
    totalRounds: Math.log2(size),
    players: {},
    matches: firstRoundMatches,
    voteMap: {},            // matchId -> { sessionToken: choice }
    createdAt: Date.now(),
  };

  await db.collection('games').doc(gameId).set(game);
  res.json({ gameId });
});

// GET /api/games/:gameId — fetch current game state
router.get('/:gameId', async (req, res) => {
  const doc = await db.collection('games').doc(req.params.gameId).get();
  if (!doc.exists) return res.status(404).json({ error: 'Game not found' });
  res.json(doc.data());
});

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

module.exports = router;
