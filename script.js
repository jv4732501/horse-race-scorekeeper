(function () {
  const SCRATCH_TIERS = [5, 10, 15, 20]; // cents per matching card, by scratch order (1st..4th)
  const MAX_CARDS_PER_NUMBER = 4; // only 4 cards of any given number exist in the deck
  const HORSES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q'];

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
  const phaseBannerEl = document.getElementById('phase-banner');
  const gridHeaderRow = document.getElementById('grid-header-row');
  const gridBody = document.getElementById('grid-body');
  const cancelBtn = document.getElementById('cancel-btn');
  const confirmBtn = document.getElementById('confirm-btn');
  const nextRoundBtn = document.getElementById('next-round-btn');
  const undoBtn = document.getElementById('undo-btn');
  const historyList = document.getElementById('history-list');
  const roundNetHeader = document.querySelector('.round-net-header');

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
      activeColumn: null, // { number, mode: 'scratch' | 'race-hit' | 'winner' }
      pendingEntries: {}, // playerId -> count, for the currently active column
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

  // ---------------- GAME LOGIC ----------------

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
  // under the currently active column's mode.
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

  // ---------------- RENDER ----------------

  cancelBtn.addEventListener('click', cancelActiveColumn);
  confirmBtn.addEventListener('click', confirmActiveColumn);
  nextRoundBtn.addEventListener('click', startNextRound);
  undoBtn.addEventListener('click', undo);

  function render() {
    if (!state) return;
    roundNumberEl.textContent = state.round;
    potValueEl.textContent = formatCents(state.pot);
    phaseBannerEl.textContent = phaseText();

    renderHeader();
    renderBody();
    renderActionBar();
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
      return 'Race underway — tap the winning horse, or tap a scratched horse if it comes up again';
    }
    const n = state.scratches.length + 1;
    return `Scratch ${n} of 4 — tap a horse (${SCRATCH_TIERS[n - 1]}¢/card), then tap players holding it`;
  }

  function renderHeader() {
    gridHeaderRow.querySelectorAll('.horse-header-cell').forEach((c) => c.remove());

    const scratched = scratchedNumbers();
    const racing = isRacingPhase();
    const roundOver = !!state.winner;

    HORSES.forEach((number) => {
      const th = document.createElement('th');
      th.className = 'horse-header-cell';
      const btn = document.createElement('button');
      btn.className = 'horse-header-btn';
      btn.type = 'button';

      const isScratched = scratched.has(number);
      const scratchInfo = state.scratches.find((s) => s.number === number);
      const isActive = state.activeColumn && state.activeColumn.number === number;
      const isWinnerNumber = state.winner && state.winner.number === number;
      const hitCount = state.raceHits.filter((h) => h.number === number).length;

      let badgeText = '';
      let clickable = false;

      if (isWinnerNumber) {
        badgeText = 'WINNER';
        btn.classList.add('winner-pick');
      } else if (isScratched) {
        const orderNames = ['1st', '2nd', '3rd', '4th'];
        badgeText = `scratched ${orderNames[scratchInfo.order - 1]}` + (hitCount ? ` • hit x${hitCount}` : '');
        btn.classList.add('scratched');
        if (racing && !roundOver) {
          // Race is underway: this dead horse can still be rolled again, charging
          // whoever holds it — distinct from picking the race winner below.
          btn.classList.add('hittable');
          clickable = true;
        }
      } else if (racing) {
        btn.classList.add('winner-pick');
        clickable = !roundOver;
      } else {
        clickable = true; // pre-race, unscratched horse — tap to run the next scratch
      }

      if (isActive) btn.classList.add('active');

      btn.innerHTML = `<span>${number}</span>` + (badgeText ? `<span class="order-badge">${badgeText}</span>` : '');

      btn.disabled = !clickable;
      if (clickable) btn.addEventListener('click', () => selectColumn(number));

      th.appendChild(btn);
      gridHeaderRow.insertBefore(th, roundNetHeader);
    });
  }

  function renderBody() {
    gridBody.innerHTML = '';

    state.players.forEach((player) => {
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.className = 'player-name-cell';
      nameTd.textContent = player.name;
      tr.appendChild(nameTd);

      HORSES.forEach((number) => {
        const td = document.createElement('td');
        const btn = document.createElement('button');
        btn.className = 'card-cell-btn';
        btn.type = 'button';

        const isActiveColumn = state.activeColumn && state.activeColumn.number === number;
        const scratchInfo = state.scratches.find((s) => s.number === number);
        const isWinnerColumn = state.winner && state.winner.number === number;

        if (isActiveColumn) {
          const count = state.pendingEntries[player.id] || 0;
          btn.classList.add('enabled');
          if (count > 0) {
            btn.classList.add('has-count');
            const amount = activeCardCost(count);
            btn.innerHTML = `<span class="count-badge">${count} card${count > 1 ? 's' : ''}</span><span class="amount-badge">${formatCents(amount)}</span>`;
          } else {
            btn.innerHTML = `<span class="count-badge">tap</span>`;
          }
          btn.addEventListener('click', () => cycleCellCount(player.id));
        } else if (isWinnerColumn && state.winner.entries[player.id]) {
          const count = state.winner.entries[player.id];
          const amount = state.winner.payouts[player.id];
          btn.disabled = true;
          btn.classList.add('has-count');
          btn.innerHTML = `<span class="count-badge">${count}</span><span class="amount-badge">${formatCents(amount, true)}</span>`;
        } else {
          // Combine the original pre-race scratch charge with any later race-hit
          // charges on the same horse -- both bill at that horse's standing rate.
          const scratchCount = (scratchInfo && scratchInfo.entries[player.id]) || 0;
          const raceHitCount = state.raceHits.reduce(
            (sum, h) => (h.number === number ? sum + (h.entries[player.id] || 0) : sum),
            0
          );
          const totalCount = scratchCount + raceHitCount;
          if (totalCount > 0) {
            const cost = scratchInfo.costPerCard;
            btn.disabled = true;
            btn.innerHTML = `<span class="count-badge">${totalCount}</span><span class="amount-badge">${formatCents(-(cost * totalCount))}</span>`;
          } else {
            btn.disabled = true;
            btn.innerHTML = `<span class="count-badge">–</span>`;
          }
        }

        td.appendChild(btn);
        tr.appendChild(td);
      });

      const net = roundNetForPlayer(player.id) + activeColumnPreview(player.id);
      const netTd = document.createElement('td');
      netTd.className = 'net-cell ' + (net > 0 ? 'positive' : net < 0 ? 'negative' : '');
      netTd.textContent = formatCents(net, true);
      tr.appendChild(netTd);

      const balance = player.total + net;
      const balTd = document.createElement('td');
      balTd.className = 'balance-cell ' + (balance > 0 ? 'positive' : balance < 0 ? 'negative' : '');
      balTd.textContent = formatCents(balance, true);
      tr.appendChild(balTd);

      gridBody.appendChild(tr);
    });
  }

  function renderActionBar() {
    const roundOver = !!state.winner;
    cancelBtn.classList.add('hidden');
    confirmBtn.classList.add('hidden');
    nextRoundBtn.classList.add('hidden');

    if (roundOver) {
      nextRoundBtn.classList.remove('hidden');
    } else if (state.activeColumn) {
      cancelBtn.classList.remove('hidden');
      confirmBtn.classList.remove('hidden');
      confirmBtn.textContent =
        state.activeColumn.mode === 'scratch'
          ? 'Confirm Scratch'
          : state.activeColumn.mode === 'race-hit'
          ? 'Confirm Race Hit'
          : 'Confirm Payout';
    }
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
          const names =
            Object.entries(hit.entries)
              .map(([pid, count]) => {
                const player = state.players.find((p) => p.id === Number(pid));
                return `${player ? player.name : '?'} x${count}`;
              })
              .join(', ') || 'no cards held';
          const span = document.createElement('span');
          span.className = 'delta-neg';
          span.textContent = `Race hit on ${hit.number}: ${names} (${formatCents(hit.costPerCard)}/card)`;
          hitsDiv.appendChild(span);
        });
        li.appendChild(hitsDiv);
      }

      historyList.appendChild(li);
    });
  }

  renderSetup();
})();
