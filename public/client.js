// client.js - VERSÃO COM LÓGICA VISUAL DE BAN

const socket = io();

// --- Captura de Elementos ---
const loginScreen = document.getElementById('login-screen');
const nicknameInput = document.getElementById('nickname-input');
const passwordInput = document.getElementById('password-input');
const loginBtn = document.getElementById('login-btn');
const errorMessage = document.getElementById('error-message');
const appScreen = document.getElementById('app');
const getAttackerBtn = document.getElementById('get-attacker-btn');
const getDefenderBtn = document.getElementById('get-defender-btn');
const resultsContainer = document.getElementById('results-container');
const shieldToggle = document.getElementById('shield-toggle');
const swapNotification = document.getElementById('swap-notification');
const swapMessage = document.getElementById('swap-message');
const swapDetails = document.getElementById('swap-details');
const acceptSwapBtn = document.getElementById('accept-swap-btn');
const declineSwapBtn = document.getElementById('decline-swap-btn');
const openBanAtkModalBtn = document.getElementById('open-ban-atk-modal');
const openBanDefModalBtn = document.getElementById('open-ban-def-modal');
const banModal = document.getElementById('ban-modal');
const banModalTitle = document.getElementById('ban-modal-title');
const banIconGrid = document.getElementById('ban-icon-grid');
const confirmBanBtn = document.getElementById('confirm-ban-btn');
const cancelBanBtn = document.getElementById('cancel-ban-btn');

// --- Variáveis de Estado do Cliente ---
let currentOffer = null;
let allAttackers = [];
let allDefenders = [];
let myBans = { atk: null, def: null };
let banModalState = { type: null, selectedOperator: null };
// NOVO: Lista de operadores de escudo para a lógica visual
const shieldOperators = new Set(['blitz', 'montagne', 'osa', 'blackbeard', 'clash']);

// --- Funções ---
function resetAllCooldowns() { getAttackerBtn.disabled = false; getDefenderBtn.disabled = false; getAttackerBtn.textContent = 'Sortear Atacante'; getDefenderBtn.textContent = 'Sortear Defensor'; }
function updateSelectionsDisplay(selections) {
  resultsContainer.innerHTML = '';
  const playerEntries = Object.entries(selections);
  const totalSlots = 5;
  for (let i = 0; i < totalSlots; i++) {
    const entry = playerEntries[i];
    if (entry) {
      const [playerId, selection] = entry;
      const card = document.createElement('div');
      card.classList.add('player-card'); card.dataset.socketId = playerId;
      if (playerId === socket.id) card.classList.add('is-you');
      else card.classList.add('is-other');
      card.innerHTML = `<img src="/imgs/${selection.type}/${selection.operator}.svg" alt="${selection.operator}"><div class="operator-name">${selection.operator}</div><div class="player-nickname">${selection.nickname}</div>`;
      resultsContainer.appendChild(card);
    } else {
      const emptyCard = document.createElement('div');
      emptyCard.classList.add('empty-slot'); emptyCard.textContent = 'Aguardando jogador...';
      resultsContainer.appendChild(emptyCard);
    }
  }
}

// MODIFICADO: Função que abre o modal de ban agora tem a lógica visual
function openBanModal(type) {
    const isAttack = type === 'atk';
    banModalState.type = type;
    banModalState.selectedOperator = myBans[type];

    banModalTitle.textContent = `Escolha um ${isAttack ? 'Atacante' : 'Defensor'} para Banir`;
    banIconGrid.innerHTML = '';

    const operatorList = isAttack ? allAttackers : allDefenders;
    const shieldsAreDisabled = !shieldToggle.checked;

    operatorList.forEach(op => {
        const icon = document.createElement('img');
        icon.src = `/imgs/${type}/${op}.svg`;
        icon.classList.add('ban-icon');
        icon.dataset.operatorName = op;

        // Lógica para desabilitar visualmente operadores de escudo
        if (shieldsAreDisabled && shieldOperators.has(op.toLowerCase())) {
            icon.classList.add('icon-disabled');
        }

        if (op === banModalState.selectedOperator) {
            icon.classList.add('icon-selected');
        }
        banIconGrid.appendChild(icon);
    });
    banModal.classList.remove('hidden');
}

// --- Listeners de Eventos da UI ---
loginBtn.addEventListener('click', () => { const nickname = nicknameInput.value; const password = passwordInput.value; if (!nickname || !password) { errorMessage.textContent = 'Preencha todos os campos!'; return; } socket.emit('loginAttempt', { nickname, password }); });
getAttackerBtn.addEventListener('click', () => socket.emit('getOperator', 'atk'));
getDefenderBtn.addEventListener('click', () => socket.emit('getOperator', 'def'));
shieldToggle.addEventListener('change', () => socket.emit('toggleShieldOperators', { wantsShields: shieldToggle.checked }));
resultsContainer.addEventListener('click', (event) => { const card = event.target.closest('.player-card.is-other'); if (card) { socket.emit('offerSwap', { targetId: card.dataset.socketId }); } });
banIconGrid.addEventListener('click', (event) => { const targetIcon = event.target; if (!targetIcon.classList.contains('ban-icon')) return; const opName = targetIcon.dataset.operatorName; document.querySelectorAll('.ban-icon').forEach(icon => icon.classList.remove('icon-selected')); if (banModalState.selectedOperator === opName) { banModalState.selectedOperator = null; } else { targetIcon.classList.add('icon-selected'); banModalState.selectedOperator = opName; } });
confirmBanBtn.addEventListener('click', () => { const { type, selectedOperator } = banModalState; socket.emit('updateBans', { type, operatorName: selectedOperator }); myBans[type] = selectedOperator; alert(`Ban de ${type === 'atk' ? 'atacante' : 'defensor'} atualizado para: ${selectedOperator || 'Nenhum'}`); banModal.classList.add('hidden'); });
cancelBanBtn.addEventListener('click', () => banModal.classList.add('hidden'));
openBanAtkModalBtn.addEventListener('click', () => openBanModal('atk'));
openBanDefModalBtn.addEventListener('click', () => openBanModal('def'));
acceptSwapBtn.addEventListener('click', () => { if (currentOffer) { socket.emit('acceptSwap', { offererId: currentOffer.offererId }); swapNotification.classList.add('hidden'); currentOffer = null; } });
declineSwapBtn.addEventListener('click', () => { if (currentOffer) { socket.emit('declineSwap', { offererId: currentOffer.offererId }); swapNotification.classList.add('hidden'); currentOffer = null; } });

// --- Listeners do Socket ---
socket.on('loginSuccess', (initialData) => { loginScreen.classList.add('hidden'); appScreen.classList.remove('hidden'); updateSelectionsDisplay(initialData.selections); allAttackers = initialData.allAttackers.sort(); allDefenders = initialData.allDefenders.sort(); });
socket.on('loginFail', (message) => { errorMessage.textContent = message; });
socket.on('kicked', () => { alert('Você foi removido da sala pelo dono.'); document.body.innerHTML = '<h1>Você foi desconectado.</h1>'; });
socket.on('updateAllSelections', (data) => updateSelectionsDisplay(data.selections));
socket.on('cooldownTick', (data) => { const button = data.type === 'atk' ? getAttackerBtn : getDefenderBtn; button.textContent = `Aguarde ${data.seconds}s...`; button.disabled = true; });
socket.on('cooldownEnded', (data) => { const button = data.type === 'atk' ? getAttackerBtn : getDefenderBtn; button.textContent = data.type === 'atk' ? 'Sortear Atacante' : 'Sortear Defensor'; button.disabled = false; });
socket.on('cooldownReset', () => { resetAllCooldowns(); alert('Seu cooldown foi resetado pelo admin!'); });
socket.on('swapOfferReceived', (data) => { currentOffer = data; swapMessage.textContent = `${data.offererNickname} propõe uma troca:`; swapDetails.innerHTML = `<div class="swap-player"><img src="/imgs/${data.offererOperator.type}/${data.offererOperator.operator}.svg"><span>${data.offererOperator.operator}</span></div><span>↔️</span><div class="swap-player"><img src="/imgs/${data.targetOperator.type}/${data.targetOperator.operator}.svg"><span>(Seu) ${data.targetOperator.operator}</span></div>`; swapNotification.classList.remove('hidden'); });
socket.on('actionFailed', (data) => alert(data.message));
socket.on('actionSuccess', (data) => alert(data.message));