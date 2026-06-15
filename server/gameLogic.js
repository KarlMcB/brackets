// Seeds items into first-round matches. items.length must be a power of 2.
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
      votes: {},
      deadline: null,
    });
  }
  return matches;
}

// Points double each round: round 1 = 1pt, round 2 = 2pt, etc.
function pointsForRound(round) {
  return Math.pow(2, round - 1);
}

// Tally votes and return the winning item (most votes wins; itemA wins ties).
function resolveMatch(match) {
  const tally = {};
  for (const vote of Object.values(match.votes)) {
    tally[vote] = (tally[vote] || 0) + 1;
  }
  const countA = tally[match.itemA] || 0;
  const countB = tally[match.itemB] || 0;
  return countB > countA ? match.itemB : match.itemA;
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
      votes: {},
      deadline: null,
    });
  }
  return matches;
}

module.exports = { buildBracket, pointsForRound, resolveMatch, advanceRound };
