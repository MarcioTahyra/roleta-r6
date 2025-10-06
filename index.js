const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 5000;

// --- Configuração de Senhas e Arquivos ---
const APP_PASSWORD = process.env.APP_PASSWORD;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.use(express.static('public'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

// --- Carregamento dos Operadores ---
const attackersPath = path.join(__dirname, 'public/imgs/atk');
const defendersPath = path.join(__dirname, 'public/imgs/def');
const attackers = fs.readdirSync(attackersPath).map(file => file.replace('.svg', ''));
const defenders = fs.readdirSync(defendersPath).map(file => file.replace('.svg', ''));
const shieldOperators = new Set(['blitz', 'montagne', 'osa', 'blackbeard', 'clash']);

console.log(`Operadores carregados: ${attackers.length} Atacantes, ${defenders.length} Defensores.`);

// --- Configurações Globais ---
const COOLDOWN_SECONDS = 30;
let isIpLockEnabled = true;
let isCooldownEnabled = true;

// --- Dados em Memória ---
let connectedUsers = {};
let playerSelections = {};
let usedAttackers = new Set();
let usedDefenders = new Set();
let swapOffers = {};

// --- Funções Auxiliares ---
const updateAdminUserList = () => {
    const safeUsers = Object.values(connectedUsers).map(user => ({ id: user.id, nickname: user.nickname, ip: user.ip }));
    io.to('admin_room').emit('updateUserList', safeUsers);
};

const clearSwapOffersInvolving = (userId) => {
    if (swapOffers[userId]) {
        const offererId = swapOffers[userId];
        io.to(offererId).emit('actionFailed', { message: 'A oferta de troca foi cancelada.' });
        delete swapOffers[userId];
    }
    for (const targetId in swapOffers) {
        if (swapOffers[targetId] === userId) {
            delete swapOffers[targetId];
        }
    }
};

const resetAllUserCooldowns = () => {
    for (const user of Object.values(connectedUsers)) {
        clearInterval(user.intervals.atk);
        clearInterval(user.intervals.def);
        user.cooldowns = { atk: 0, def: 0 };
        io.to(user.id).emit('cooldownReset');
    }
};

// --- Conexão ---
io.on('connection', (socket) => {

  socket.on('loginAttempt', (data) => {
    const forwardedFor = socket.handshake.headers['x-forwarded-for'];
    let userIp;
    
    if (forwardedFor) {
      userIp = forwardedFor.split(',')[0].trim();
    } else {
      userIp = socket.handshake.address;
    }
    if (isIpLockEnabled && Object.values(connectedUsers).some(user => user.ip === userIp)) return socket.emit('loginFail', 'Este endereço de IP já está conectado!');
    if (data.password !== APP_PASSWORD) return socket.emit('loginFail', 'Senha incorreta!');
    if (Object.values(connectedUsers).some(user => user.nickname === data.nickname)) return socket.emit('loginFail', 'Este apelido já está em uso!');

    connectedUsers[socket.id] = { id: socket.id, nickname: data.nickname, ip: userIp, cooldowns: { atk: 0, def: 0 }, bans: { atk: null, def: null }, wantsShields: true, intervals: { atk: null, def: null } };

    socket.emit('loginSuccess', { 
        selections: playerSelections,
        allAttackers: attackers,
        allDefenders: defenders
    });
    updateAdminUserList();
  });

  socket.on('getOperator', (operatorType) => {
    const user = connectedUsers[socket.id];
    if (!user) return;
    if (isCooldownEnabled && (Date.now() < user.cooldowns[operatorType] + COOLDOWN_SECONDS * 1000)) return;

    clearSwapOffersInvolving(socket.id);
    const isAttack = operatorType === 'atk';
    const mainOperatorList = isAttack ? attackers : defenders;
    const usedOperatorSet = isAttack ? usedAttackers : usedDefenders;
    const userBan = user.bans[operatorType];
    let availableOperators = mainOperatorList.filter(op => (user.wantsShields || !shieldOperators.has(op.toLowerCase())) && (op.toLowerCase() !== userBan?.toLowerCase()) && !usedOperatorSet.has(op));
    if (availableOperators.length === 0) return;

    const selectedOperator = availableOperators[Math.floor(Math.random() * availableOperators.length)];
    const oldSelection = playerSelections[socket.id];
    if (oldSelection) { if (oldSelection.type === 'atk') usedAttackers.delete(oldSelection.operator); else usedDefenders.delete(oldSelection.operator); }

    usedOperatorSet.add(selectedOperator);
    user.cooldowns[operatorType] = Date.now();
    playerSelections[socket.id] = { operator: selectedOperator, type: operatorType, nickname: user.nickname };
    io.emit('updateAllSelections', { selections: playerSelections });

    if (isCooldownEnabled) {
        let secondsLeft = COOLDOWN_SECONDS;
        clearInterval(user.intervals[operatorType]);
        socket.emit('cooldownTick', { type: operatorType, seconds: secondsLeft });
        user.intervals[operatorType] = setInterval(() => {
            secondsLeft--;
            if (secondsLeft > 0) { socket.emit('cooldownTick', { type: operatorType, seconds: secondsLeft }); } 
            else { clearInterval(user.intervals[operatorType]); socket.emit('cooldownEnded', { type: operatorType }); }
        }, 1000);
    }
    updateAdminUserList();
  });

  // Habilidades
  socket.on('updateBans', (data) => { const user = connectedUsers[socket.id]; if (user) user.bans[data.type] = data.operatorName || null; console.log(`${user.nickname} baniu ${data.operatorName}`); });
  socket.on('toggleShieldOperators', (data) => { const user = connectedUsers[socket.id]; if (user) user.wantsShields = data.wantsShields; });
  socket.on('offerSwap', (data) => { const offerer = connectedUsers[socket.id]; const target = connectedUsers[data.targetId]; const offererSelection = playerSelections[socket.id]; const targetSelection = playerSelections[data.targetId]; if (!offerer || !target || !offererSelection || !targetSelection) { return socket.emit('actionFailed', { message: "Troca inválida. Ambos os jogadores precisam ter um operador sorteado." }); } clearSwapOffersInvolving(socket.id); clearSwapOffersInvolving(data.targetId); swapOffers[data.targetId] = socket.id; io.to(data.targetId).emit('swapOfferReceived', { offererId: socket.id, offererNickname: offerer.nickname, offererOperator: offererSelection, targetOperator: targetSelection }); });
  socket.on('acceptSwap', (data) => { const acceptorId = socket.id; const offererId = data.offererId; if (swapOffers[acceptorId] !== offererId) return; const sel1 = playerSelections[offererId]; const sel2 = playerSelections[acceptorId]; if (!sel1 || !sel2) return; const tempOperator = sel1.operator; const tempType = sel1.type; sel1.operator = sel2.operator; sel1.type = sel2.type; sel2.operator = tempOperator; sel2.type = tempType; delete swapOffers[acceptorId]; io.emit('updateAllSelections', { selections: playerSelections }); });
  socket.on('declineSwap', (data) => { const decliner = connectedUsers[socket.id]; const offererId = data.offererId; if(!decliner) return; if (swapOffers[socket.id] === offererId) { delete swapOffers[socket.id]; } io.to(offererId).emit('actionFailed', { message: `Sua oferta de troca foi recusada por ${decliner.nickname}.` }); });

  // Lógica do Admin
  socket.on('adminLogin', (password) => { if (password === ADMIN_PASSWORD) { socket.join('admin_room'); socket.emit('adminLoginSuccess', { isIpLockEnabled: isIpLockEnabled, isCooldownEnabled: isCooldownEnabled }); updateAdminUserList(); } else { socket.emit('adminLoginFail', 'Senha do admin incorreta!'); } });
  socket.on('adminToggleIpLock', (newState) => { isIpLockEnabled = !!newState; console.log(`[ADMIN] Bloqueio de IP: ${isIpLockEnabled}`); io.to('admin_room').emit('ipLockStateChanged', isIpLockEnabled); });
  socket.on('adminToggleCooldown', (newState) => { isCooldownEnabled = !!newState; console.log(`[ADMIN] Cooldown Ativado: ${isCooldownEnabled}`); io.to('admin_room').emit('cooldownStateChanged', isCooldownEnabled); if (!isCooldownEnabled) { console.log(`[ADMIN] Cooldown desativado. Resetando todos os timers ativos.`); resetAllUserCooldowns(); } });
  socket.on('adminResetAllCooldowns', () => { console.log('[ADMIN] Resetando cooldown de todos os usuários por comando.'); resetAllUserCooldowns(); });
  socket.on('kickUser', (userIdToKick) => { const userSocket = io.sockets.sockets.get(userIdToKick); if (userSocket) { userSocket.emit('kicked'); userSocket.disconnect(true); } });
  socket.on('adminResetUserCooldown', (userIdToReset) => { const user = connectedUsers[userIdToReset]; if (user) { clearInterval(user.intervals.atk); clearInterval(user.intervals.def); user.cooldowns = { atk: 0, def: 0 }; io.to(userIdToReset).emit('cooldownReset'); console.log(`[ADMIN] Cooldown resetado para ${user.nickname}`); } });

  // Desconexão
  socket.on('disconnect', () => {
    const user = connectedUsers[socket.id];
    if (user) {
      console.log(`Usuário desconectado: ${user.nickname}`);
      clearInterval(user.intervals.atk); clearInterval(user.intervals.def);
      clearSwapOffersInvolving(socket.id);
      const selection = playerSelections[socket.id];
      if (selection) { if (selection.type === 'atk') usedAttackers.delete(selection.operator); else usedDefenders.delete(selection.operator); }
      delete connectedUsers[socket.id];
      delete playerSelections[socket.id];
      io.emit('updateAllSelections', { selections: playerSelections });
      updateAdminUserList();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}! Painel do admin em /admin`);
});
