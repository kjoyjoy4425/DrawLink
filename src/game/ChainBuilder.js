// Chain rotation formula: player at seat i, round r → chain index (i - r + N) % N

function initChains(players) {
  return players.map(p => ({
    ownerNickname: p.nickname,
    entries: []
  }));
}

function processSubmissions(chains, submissions, round, players) {
  const N = players.length;
  const type = round === 0 ? 'word' : round % 2 === 1 ? 'drawing' : 'guess';

  for (const [playerId, content] of submissions) {
    const player = players.find(p => p.id === playerId);
    if (!player) continue;
    const chainIdx = (player.order - round + N) % N;
    chains[chainIdx].entries.push({
      type,
      authorNickname: player.nickname,
      content
    });
  }
}

function computeAssignments(chains, round, players) {
  const N = players.length;
  const assignments = new Map();

  for (const player of players) {
    const chainIdx = (player.order - round + N) % N;
    const chain = chains[chainIdx];
    const lastEntry = chain.entries[chain.entries.length - 1];
    assignments.set(player.id, {
      chainIndex: chainIdx,
      content: lastEntry ? lastEntry.content : '???'
    });
  }

  return assignments;
}

module.exports = { initChains, processSubmissions, computeAssignments };
