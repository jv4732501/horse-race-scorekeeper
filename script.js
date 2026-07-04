(function () {
  const SCRATCH_TIERS = [5, 10, 15, 20]; // cents per matching card, by scratch order (1st..4th)
  const MAX_CARDS_PER_NUMBER = 4; // only 4 cards of any given number exist in the deck
  const HORSES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q'];
  const ORDER_NAMES = ['1st', '2nd', '3rd', '4th'];

  let state = null;
  let nextPlayerId = 1;
  let setupPlayers = [];

  const setupScreen = document.getElementById('setup-screen');
  const gameScreen = document.getElementById('game-screen');
  const addPlayerForm = document.getElementById('add-player-form');
  const playerNameInput = document.getElementById('player-name-input');
  const chipList = document.getElementById('player-chip-list');
  const startBtn = document.getElementById('start-session-btn');

  const roundNumberEl = document.getElementById('round-number');
  const potValueEl = document.getElementById('pot-value');
  const undoBtn = document.getElementById('undo-btn');
  const balancesBody = document.getElementById('balances-body');
  const phaseBannerEl = document.getElementById('phase-banner');
  const actionPanel = document.getElementById('action-panel');
  const roundLogList = document.getElementById('round-log-list');
  const historyList = document.getElementById('history-list');

  // ---------------- SETUP SCREEN ----------------

  addPlayerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = playerNameInput.value.trim();
    if (!name) return;
    setupPlayers.push({ id: nextPlayerId++, name });
    playerNameInput.value = '';
    playerNameInput.focus();
    renderSetup();
  });

  startBtn.addEventListener('click', () => {
    state = {
      players: setupPlayers.map((p) => ({ id: p.id, name: p.name, total: 0 })),
      round: 1,
      pot: 0,
      scratches: [], // { number, order, costPerCard, entries: {playerId: count} }
      raceHits: [], // { number, costPerCard, entries: {playerId: count} } -- horse re-hit during the race
      winner: null, // { number, entries: {playerId: count}, payouts: {playerId: cents} }
      activeColumn: null, // { number, mode: 'scratch' | 'race-hit' | 'winner', costPerCard? }
      pendingEntries: {}, // playerId -> count, for the currently active picker
      history: [], // completed rounds
      undoStack: []
    };
    setupScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    render();
  });

  function renderSetup() {
    chipList.innerHTML = '';
    setupPlayers.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'chip';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove player';
      removeBtn.addEventListener('click', () => {
        setupPlayers = setupPlayers.filter((sp) => sp.id !== p.id);
        renderSetup();
      });
      li.appendChild(nameSpan);
      li.appendChild(removeBtn);
      chipList.appendChild(li);
    });
    startBtn.disabled = setupPlayers.length < 2;
  }

  // ---------------- GAME LOGIC (data only, no DOM) ----------------

  function formatCents(cents, withSign) {
    const rounded = Math.round(cents || 0);
    const sign = rounded < 0 ? '-' : withSign && rounded > 0 ? '+' : '';
    const abs = Math.abs(rounded);
    return `${sign}$${(abs / 100).toFixed(2)}`;
  }

  function pushUndo() {
    const { undoStack, ...rest } = state;
    state.undoStack.push(JSON.parse(JSON.stringify(rest)));
  }

  function undo() {
    if (!state || state.undoStack.length === 0) return;
    const prev = state.undoStack.pop();
    const undoStack = state.undoStack;
    state = { ...prev, undoStack };
    render();
  }

  function scratchedNumbers() {
    return new Set(state.scratches.map((s) => s.number));
  }

  function isRacingPhase() {
    return state.scratches.length >= 4 && !state.winner;
  }

  function currentScratchTier() {
    return SCRATCH_TIERS[Math.min(state.scratches.length, SCRATCH_TIERS.length - 1)];
  }

  function totalPendingCount() {
    return Object.values(state.pendingEntries).reduce((a, b) => a + b, 0);
  }

  function selectColumn(number) {
    if (state.winner) return; // round is resolved, must start next round first
    const scratched = scratchedNumbers();
    const racing = isRacingPhase();

    if (scratched.has(number)) {
      if (!racing) return; // already scratched pre-race, locked until racing begins
      const scratchInfo = state.scratches.find((s) => s.number === number);
      state.activeColumn = { number, mode: 'race-hit', costPerCard: scratchInfo.costPerCard };
    } else {
      state.activeColumn = { number, mode: racing ? 'winner' : 'scratch' };
    }
    state.pendingEntries = {};
    render();
  }

  function cancelActiveColumn() {
    state.activeColumn = null;
    state.pendingEntries = {};
    render();
  }

  function cycleCellCount(playerId) {
    if (!state.activeColumn) return;
    const current = state.pendingEntries[playerId] || 0;
    const otherTotal = totalPendingCount() - current;
    let next = current + 1;
    if (next > MAX_CARDS_PER_NUMBER || otherTotal + next > MAX_CARDS_PER_NUMBER) {
      next = 0;
    }
    if (next === 0) {
      delete state.pendingEntries[playerId];
    } else {
      state.pendingEntries[playerId] = next;
    }
    render();
  }

  function confirmActiveColumn() {
    if (!state.activeColumn) return;
    pushUndo();
    const { number, mode, costPerCard } = state.activeColumn;
    const entries = { ...state.pendingEntries };

    if (mode === 'winner') {
      const payouts = {};
      Object.entries(entries).forEach(([playerId, count]) => {
        payouts[playerId] = Math.round((state.pot * count) / MAX_CARDS_PER_NUMBER);
      });
      state.winner = { number, entries, payouts };
    } else {
      // 'scratch' (pre-race) or 'race-hit' (horse rolled again mid-race): both charge
      // a per-card fee into the pot at that horse's standing scratch rate.
      const cost = mode === 'scratch' ? currentScratchTier() : costPerCard;
      let potAdd = 0;
      Object.values(entries).forEach((count) => {
        potAdd += cost * count;
      });
      state.pot += potAdd;
      if (mode === 'scratch') {
        state.scratches.push({ number, order: state.scratches.length + 1, costPerCard: cost, entries });
      } else {
        state.raceHits.push({ number, costPerCard: cost, entries });
      }
    }

    state.activeColumn = null;
    state.pendingEntries = {};
    render();
  }

  function startNextRound() {
    if (!state.winner) return;
    pushUndo();
    finalizeRound();
    render();
  }

  function finalizeRound() {
    const deltas = {};
    state.players.forEach((p) => {
      deltas[p.id] = roundNetForPlayer(p.id);
    });
    state.players.forEach((p) => {
      p.total += deltas[p.id];
    });
    state.history.unshift({
      round: state.round,
      pot: state.pot,
      scratches: state.scratches,
      raceHits: state.raceHits,
      winner: state.winner,
      deltas
    });
    state.round += 1;
    state.pot = 0;
    state.scratches = [];
    state.raceHits = [];
    state.winner = null;
  }

  // Net effect of the CURRENT (uncommitted) round only, not counting player.total.
  function roundNetForPlayer(playerId) {
    let net = 0;
    state.scratches.forEach((s) => {
      const count = s.entries[playerId];
      if (count) net -= s.costPerCard * count;
    });
    state.raceHits.forEach((h) => {
      const count = h.entries[playerId];
      if (count) net -= h.costPerCard * count;
    });
    if (state.winner) {
      const payout = state.winner.payouts[playerId];
      if (payout) net += payout;
    }
    return net;
  }

  // Magnitude (always positive) of what tapping `count` cards would cost/pay
  // under the currently active picker's mode.
  function activeCardCost(count) {
    if (!state.activeColumn || !count) return 0;
    const { mode, costPerCard } = state.activeColumn;
    if (mode === 'scratch') return currentScratchTier() * count;
    if (mode === 'race-hit') return costPerCard * count;
    return Math.round((state.pot * count) / MAX_CARDS_PER_NUMBER); // winner
  }

  function activeColumnPreview(playerId) {
    if (!state.activeColumn) return 0;
    const count = state.pendingEntries[playerId] || 0;
    if (!count) return 0;
    const amount = activeCardCost(count);
    return state.activeColumn.mode === 'winner' ? amount : -amount;
  }

  function describeEntries(entries, costPerCard, payouts) {
    const parts = Object.entries(entries).map(([playerId, count]) => {
      const player = state.players.find((p) => p.id === Number(playerId));
      const name = player ? player.name : '?';
      if (payouts) {
        return `${name} x${count} (${formatCents(payouts[playerId] || 0, true)})`;
      }
      return `${name} x${count} (${formatCents(-(costPerCard * count))})`;
    });
    return parts.length ? parts.join(', ') : 'no cards held';
  }

  // ---------------- RENDER ----------------

  undoBtn.addEventListener('click', undo);

  function render() {
    if (!state) return;
    roundNumberEl.textContent = state.round;
    potValueEl.textContent = formatCents(state.pot);
    phaseBannerEl.textContent = phaseText();

    renderBalances();
    renderActionPanel();
    renderRoundLog();
    renderHistory();

    undoBtn.disabled = state.undoStack.length === 0;
  }

  function phaseText() {
    if (state.winner) {
      return `Winner: ${state.winner.number} — payouts shown below. Tap "Start Next Round" to continue.`;
    }
    if (state.activeColumn) {
      const { number, mode } = state.activeColumn;
      if (mode === 'scratch') {
        return `Scratching ${number} — ${currentScratchTier()}¢/card — tap players holding it, then Confirm`;
      }
      if (mode === 'race-hit') {
        return `Race hit on ${number} — ${state.activeColumn.costPerCard}¢/card — tap players holding it, then Confirm`;
      }
      return `Winner: ${number} — tap players holding it, then Confirm Payout`;
    }
    if (isRacingPhase()) {
      return 'Race underway — tap the winning horse below, or tap a scratched horse if it comes up again';
    }
    const n = state.scratches.length + 1;
    return `Scratch ${n} of 4 — tap the horse that was scratched (${SCRATCH_TIERS[n - 1]}¢/card)`;
  }

  function renderBalances() {
    balancesBody.innerHTML = '';
    state.players.forEach((player) => {
      const net = roundNetForPlayer(player.id) + activeColumnPreview(player.id);
      const balance = player.total + net;

      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.className = 'bp-name-cell';
      nameTd.textContent = player.name;

      const netTd = document.createElement('td');
      netTd.className = 'net-cell ' + (net > 0 ? 'positive' : net < 0 ? 'negative' : '');
      netTd.textContent = formatCents(net, true);

      const balTd = document.createElement('td');
      balTd.className = 'balance-cell ' + (balance > 0 ? 'positive' : balance < 0 ? 'negative' : '');
      balTd.textContent = formatCents(balance, true);

      tr.appendChild(nameTd);
      tr.appendChild(netTd);
      tr.appendChild(balTd);
      balancesBody.appendChild(tr);
    });
  }

  function makeHorseChip(number, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'horse-chip' + (extraClass ? ' ' + extraClass : '');
    if (state.activeColumn && state.activeColumn.number === number) btn.classList.add('active');
    const span = document.createElement('span');
    span.textContent = number;
    btn.appendChild(span);
    return btn;
  }

  function renderActionPanel() {
    actionPanel.innerHTML = '';

    if (state.winner) {
      renderPayoutSummary();
      return;
    }
    if (state.activeColumn) {
      renderPlayerPicker();
      return;
    }
    if (isRacingPhase()) {
      renderRacingChips();
      return;
    }
    renderScratchChips();
  }

  function renderScratchChips() {
    const scratched = scratchedNumbers();
    const remaining = HORSES.filter((n) => !scratched.has(n));
    const row = document.createElement('div');
    row.className = 'chip-row';
    remaining.forEach((number) => {
      const btn = makeHorseChip(number);
      btn.addEventListener('click', () => selectColumn(number));
      row.appendChild(btn);
    });
    actionPanel.appendChild(row);
  }

  function renderRacingChips() {
    const scratched = scratchedNumbers();
    const remaining = HORSES.filter((n) => !scratched.has(n));

    const winnerGroup = document.createElement('div');
    winnerGroup.className = 'chip-group';
    const winnerLabel = document.createElement('div');
    winnerLabel.className = 'chip-group-label';
    winnerLabel.textContent = 'Pick the winner';
    winnerGroup.appendChild(winnerLabel);
    const winnerRow = document.createElement('div');
    winnerRow.className = 'chip-row';
    remaining.forEach((number) => {
      const btn = makeHorseChip(number, 'winner-chip');
      btn.addEventListener('click', () => selectColumn(number));
      winnerRow.appendChild(btn);
    });
    winnerGroup.appendChild(winnerRow);
    actionPanel.appendChild(winnerGroup);

    const hitGroup = document.createElement('div');
    hitGroup.className = 'chip-group';
    const hitLabel = document.createElement('div');
    hitLabel.className = 'chip-group-label';
    hitLabel.textContent = 'Re-scratch (rolled a dead horse)';
    hitGroup.appendChild(hitLabel);
    const hitRow = document.createElement('div');
    hitRow.className = 'chip-row';
    state.scratches
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((s) => {
        const btn = makeHorseChip(s.number, 'hit-chip');
        const hitCount = state.raceHits.filter((h) => h.number === s.number).length;
        const badge = document.createElement('span');
        badge.className = 'chip-badge';
        badge.textContent = ORDER_NAMES[s.order - 1] + (hitCount ? ` • x${hitCount}` : '');
        btn.appendChild(badge);
        btn.addEventListener('click', () => selectColumn(s.number));
        hitRow.appendChild(btn);
      });
    hitGroup.appendChild(hitRow);
    actionPanel.appendChild(hitGroup);
  }

  function renderPlayerPicker() {
    const list = document.createElement('ul');
    list.className = 'player-picker-list';

    state.players.forEach((player) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'player-picker-row';
      const count = state.pendingEntries[player.id] || 0;
      if (count > 0) btn.classList.add('has-count');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'ppr-name';
      nameSpan.textContent = player.name;

      const countSpan = document.createElement('span');
      countSpan.className = 'ppr-count';
      countSpan.textContent =
        count > 0 ? `${count} card${count > 1 ? 's' : ''} — ${formatCents(activeCardCost(count))}` : 'tap to add';

      btn.appendChild(nameSpan);
      btn.appendChild(countSpan);
      btn.addEventListener('click', () => cycleCellCount(player.id));
      li.appendChild(btn);
      list.appendChild(li);
    });

    actionPanel.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'picker-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'secondary-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', cancelActiveColumn);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'primary-btn';
    confirmBtn.textContent =
      state.activeColumn.mode === 'scratch'
        ? 'Confirm Scratch'
        : state.activeColumn.mode === 'race-hit'
        ? 'Confirm Race Hit'
        : 'Confirm Payout';
    confirmBtn.addEventListener('click', confirmActiveColumn);

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    actionPanel.appendChild(actions);
  }

  function renderPayoutSummary() {
    const summary = document.createElement('div');
    summary.className = 'payout-summary';
    let any = false;
    state.players.forEach((player) => {
      const count = state.winner.entries[player.id];
      if (!count) return;
      any = true;
      const amount = state.winner.payouts[player.id];
      const line = document.createElement('div');
      line.className = 'delta-pos';
      line.textContent = `${player.name}: ${count} card${count > 1 ? 's' : ''} → ${formatCents(amount, true)}`;
      summary.appendChild(line);
    });
    if (!any) {
      const line = document.createElement('div');
      line.textContent = 'No one held a matching card for this horse.';
      summary.appendChild(line);
    }
    actionPanel.appendChild(summary);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'primary-btn next-round-btn';
    nextBtn.textContent = 'Start Next Round';
    nextBtn.addEventListener('click', startNextRound);
    actionPanel.appendChild(nextBtn);
  }

  function renderRoundLog() {
    roundLogList.innerHTML = '';
    const entries = [];

    state.scratches.forEach((s) => {
      entries.push({
        cls: 'delta-neg',
        text: `Scratch ${ORDER_NAMES[s.order - 1]} (${s.costPerCard}¢/card): horse ${s.number} — ${describeEntries(s.entries, s.costPerCard)}`
      });
    });
    state.raceHits.forEach((h) => {
      entries.push({
        cls: 'delta-neg',
        text: `Race hit (${h.costPerCard}¢/card): horse ${h.number} — ${describeEntries(h.entries, h.costPerCard)}`
      });
    });
    if (state.winner) {
      entries.push({
        cls: 'delta-pos',
        text: `Winner: horse ${state.winner.number} — ${describeEntries(state.winner.entries, null, state.winner.payouts)}`
      });
    }

    if (entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'history-entry';
      li.textContent = 'No scratches logged yet this round.';
      roundLogList.appendChild(li);
      return;
    }

    entries.forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'history-entry';
      const span = document.createElement('span');
      span.className = entry.cls;
      span.textContent = entry.text;
      li.appendChild(span);
      roundLogList.appendChild(li);
    });
  }

  function renderHistory() {
    historyList.innerHTML = '';
    if (state.history.length === 0) {
      const li = document.createElement('li');
      li.className = 'history-entry';
      li.textContent = 'No completed rounds yet.';
      historyList.appendChild(li);
      return;
    }
    state.history.forEach((h) => {
      const li = document.createElement('li');
      li.className = 'history-entry';

      const title = document.createElement('div');
      title.className = 'round-title';
      title.textContent = `Round ${h.round} — Pot ${formatCents(h.pot)} — Winner: ${h.winner.number}`;
      li.appendChild(title);

      const deltasDiv = document.createElement('div');
      deltasDiv.className = 'deltas';
      state.players.forEach((p) => {
        const d = h.deltas[p.id] || 0;
        const span = document.createElement('span');
        span.className = d >= 0 ? 'delta-pos' : 'delta-neg';
        span.textContent = `${p.name}: ${formatCents(d, true)}`;
        deltasDiv.appendChild(span);
      });
      li.appendChild(deltasDiv);

      if (h.raceHits && h.raceHits.length) {
        const hitsDiv = document.createElement('div');
        hitsDiv.className = 'deltas race-hits-summary';
        h.raceHits.forEach((hit) => {
          const span = document.createElement('span');
          span.className = 'delta-neg';
          span.textContent = `Race hit on ${hit.number}: ${describeEntries(hit.entries, hit.costPerCard)}`;
          hitsDiv.appendChild(span);
        });
        li.appendChild(hitsDiv);
      }

      historyList.appendChild(li);
    });
  }

  renderSetup();
})();
