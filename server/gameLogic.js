// Seeds items into first-round matches. items.length must be a power of 2.
// Votes are NOT stored on the match — they live in the game's voteMap (keyed by
// matchId) so they can be written atomically without contending on this array.
function buildBracket(items) {
  const matches = [];
  for (let i = 0; i < items.length; i += 2) {
    matches.push({
      matchId: `r1_m${i / 2}`,
      round: 1,
      position: i / 2,
      itemA: items[i],
      itemB: items[i + 1],
      winner: null,
      deadline: null,
    });
  }
  return matches;
}

// Points double each round: round 1 = 1pt, round 2 = 2pt, etc.
function pointsForRound(round) {
  return Math.pow(2, round - 1);
}

// Count votes for each side of a match.
function tallyMatch(match, votes) {
  let a = 0, b = 0;
  for (const vote of Object.values(votes || {})) {
    if (vote === match.itemA) a++;
    else if (vote === match.itemB) b++;
  }
  return { a, b };
}

// Decide a match winner from its votes, or return null for a genuine tie that
// the host must break. Byes always auto-resolve to the real item (never a tie).
function decideWinner(match, votes) {
  if (match.itemA.startsWith('BYE_')) return match.itemB;
  if (match.itemB.startsWith('BYE_')) return match.itemA;
  const { a, b } = tallyMatch(match, votes);
  if (a === b) return null; // tie — needs the host
  return a > b ? match.itemA : match.itemB;
}

// Build the next round's matches from the winners of the current round.
function advanceRound(winners, nextRound) {
  const matches = [];
  for (let i = 0; i < winners.length; i += 2) {
    matches.push({
      matchId: `r${nextRound}_m${i / 2}`,
      round: nextRound,
      position: i / 2,
      itemA: winners[i],
      itemB: winners[i + 1],
      winner: null,
      deadline: null,
    });
  }
  return matches;
}

module.exports = { buildBracket, pointsForRound, tallyMatch, decideWinner, advanceRound };
