/**
 * ArcFlip — Web3 Entegrasyonu
 * Arc Testnet · Chain 5042002 · USDC 6 decimal
 * ethers.js v6 gerektirir
 */

// ── NETWORK ───────────────────────────────────────────────────────
const ARC_TESTNET = {
  chainId:           '0x4CE512',  // 5042002
  chainName:         'Arc Testnet',
  nativeCurrency:    { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls:           ['https://rpc.testnet.arc.network'],
  blockExplorerUrls: ['https://testnet.arcscan.app'],
};

// ── ADRESLER ──────────────────────────────────────────────────────
const ARCFLIP_ADDRESS = '0xBf370CaA4A6FE8D7348e2a9600644eE06D25A9e4';
const USDC_ADDRESS    = '0x3600000000000000000000000000000000000000';
const USDC_DECIMALS   = 6;

// ── ABI ───────────────────────────────────────────────────────────
const ARCFLIP_ABI = [
  // createGame
  { name:'createGame', type:'function', stateMutability:'nonpayable',
    inputs:[
      {name:'seedHash',  type:'bytes32'},
      {name:'side',      type:'uint8'},
      {name:'betAmount', type:'uint256'},
    ],
    outputs:[{name:'gameId', type:'bytes32'}]
  },
  // resolveGame (owner)
  { name:'resolveGame', type:'function', stateMutability:'nonpayable',
    inputs:[{name:'gameId',type:'bytes32'},{name:'revealedSeed',type:'string'}],
    outputs:[]
  },
  // cancelExpiredGame
  { name:'cancelExpiredGame', type:'function', stateMutability:'nonpayable',
    inputs:[{name:'gameId',type:'bytes32'}], outputs:[]
  },
  // views
  { name:'getPlayerInfo', type:'function', stateMutability:'view',
    inputs:[{name:'player',type:'address'}],
    outputs:[
      {name:'streak',type:'uint8'},
      {name:'points',type:'uint256'},
      {name:'multiplierX1000',type:'uint256'},
      {name:'won',type:'uint256'},
    ]
  },
  { name:'houseBalance',  type:'function', stateMutability:'view',
    inputs:[], outputs:[{type:'uint256'}]
  },
  { name:'canAffordBet', type:'function', stateMutability:'view',
    inputs:[{name:'betAmount',type:'uint256'},{name:'player',type:'address'}],
    outputs:[{type:'bool'}]
  },
  { name:'getMultiplier', type:'function', stateMutability:'view',
    inputs:[{name:'streak',type:'uint8'}], outputs:[{type:'uint256'}]
  },
  { name:'paused', type:'function', stateMutability:'view',
    inputs:[], outputs:[{type:'bool'}]
  },
  // events
  { name:'GameCreated', type:'event',
    inputs:[
      {name:'gameId',    type:'bytes32', indexed:true},
      {name:'player',    type:'address', indexed:true},
      {name:'betAmount', type:'uint256'},
      {name:'side',      type:'uint8'},
      {name:'seedHash',  type:'bytes32'},
      {name:'streak',    type:'uint8'},
    ]
  },
  { name:'GameResolved', type:'event',
    inputs:[
      {name:'gameId',    type:'bytes32', indexed:true},
      {name:'player',    type:'address', indexed:true},
      {name:'playerWon', type:'bool'},
      {name:'payout',    type:'uint256'},
      {name:'newStreak', type:'uint8'},
    ]
  },
];

const USDC_ABI = [
  { name:'approve',   type:'function', stateMutability:'nonpayable',
    inputs:[{name:'spender',type:'address'},{name:'amount',type:'uint256'}],
    outputs:[{type:'bool'}]
  },
  { name:'allowance', type:'function', stateMutability:'view',
    inputs:[{name:'owner',type:'address'},{name:'spender',type:'address'}],
    outputs:[{type:'uint256'}]
  },
  { name:'balanceOf', type:'function', stateMutability:'view',
    inputs:[{name:'account',type:'address'}],
    outputs:[{type:'uint256'}]
  },
];

// ── STATE ─────────────────────────────────────────────────────────
let provider     = null;
let signer       = null;
let flipContract = null;
let usdcContract = null;
let walletAddress= null;

// ── YARDIMCI ──────────────────────────────────────────────────────
// USDC 6 decimal → insan okunur string
function formatUSDC(raw) {
  return (Number(raw) / 1e6).toFixed(2);
}
// İnsan okunur → 6 decimal bigint
function parseUSDC(human) {
  return BigInt(Math.round(parseFloat(human) * 1e6));
}

// ── CÜZDAN BAĞLANTISI ─────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) {
    alert('MetaMask veya Rabby Wallet bulunamadı!');
    return null;
  }
  try {
    const accounts = await window.ethereum.request({ method:'eth_requestAccounts' });
    walletAddress  = accounts[0];

    await _switchToArc();

    provider     = new ethers.BrowserProvider(window.ethereum);
    signer       = await provider.getSigner();
    flipContract = new ethers.Contract(ARCFLIP_ADDRESS, ARCFLIP_ABI, signer);
    usdcContract = new ethers.Contract(USDC_ADDRESS,    USDC_ABI,   signer);

    _onConnected(walletAddress);

    window.ethereum.on('accountsChanged', (accs) => {
      walletAddress = accs[0] || null;
      walletAddress ? _onConnected(walletAddress) : _onDisconnected();
    });
    window.ethereum.on('chainChanged', () => window.location.reload());

    return walletAddress;
  } catch (err) {
    _showErr(err.reason || err.message || 'Bağlantı başarısız');
    return null;
  }
}

async function _switchToArc() {
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARC_TESTNET.chainId }],
    });
  } catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [ARC_TESTNET],
      });
    } else throw e;
  }
}

// ── USDC APPROVE ──────────────────────────────────────────────────
async function ensureApproval(amountRaw) {
  const current = await usdcContract.allowance(walletAddress, ARCFLIP_ADDRESS);
  if (BigInt(current) >= BigInt(amountRaw)) return; // Zaten yeterli

  _showStatus('USDC onaylanıyor...');
  // Max approval — her bet için tekrar approve gerekmez
  const MAX = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  const tx  = await usdcContract.approve(ARCFLIP_ADDRESS, MAX);
  _showStatus('Onay bekleniyor...');
  await tx.wait();
  _showStatus('USDC onaylandı ✓');
}

// ── OYUN AKIŞı ────────────────────────────────────────────────────

/**
 * Tam oyun akışı:
 *   1. Backend'den seedHash al
 *   2. USDC approve (gerekirse)
 *   3. createGame on-chain
 *   4. GameResolved eventini dinle
 *
 * @param side      'heads' | 'tails'
 * @param betUSDC   Sayı, örn. 0.5 veya 1
 * @returns         { gameId, seed, txHash }
 */
async function startGame(side, betUSDC) {
  if (!flipContract) throw new Error('Cüzdan bağlı değil');

  const sideNum  = side === 'heads' ? 0 : 1;
  const betRaw   = parseUSDC(betUSDC);

  // Contract durdurulmuş mu?
  const isPaused = await flipContract.paused();
  if (isPaused) throw new Error('Contract şu an duraklatılmış');

  // House karşılayabilir mi?
  const canAfford = await flipContract.canAffordBet(betRaw, walletAddress);
  if (!canAfford) throw new Error('Yeterli house likidite yok');

  // Seed commitment al
  _showStatus('Seed hash alınıyor...');
  const { seedHash, seed } = await _fetchSeedHash();

  // USDC approve
  await ensureApproval(betRaw);

  // createGame
  _showStatus('İşlem gönderiliyor...');
  const tx      = await flipContract.createGame(seedHash, sideNum, betRaw);
  _showStatus('Onay bekleniyor...');
  const receipt = await tx.wait();

  // GameCreated eventinden gameId al
  const iface   = flipContract.interface;
  let   gameId  = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'GameCreated') {
        gameId = parsed.args.gameId;
        break;
      }
    } catch {}
  }
  if (!gameId) throw new Error('gameId alınamadı');

  _showStatus('Oyun başladı! Sonuç bekleniyor...');
  return { gameId, seed, txHash: receipt.hash };
}

/**
 * GameResolved eventini dinle.
 * House backend resolveGame() çağırdıktan sonra bu tetiklenir.
 *
 * @param gameId    startGame'den dönen gameId
 * @param onResult  ({ won, payout, newStreak }) => void
 * @param timeoutMs Timeout süresi (default 3dk)
 */
function waitForResult(gameId, onResult, timeoutMs = 180000) {
  if (!flipContract) return;

  const filter = flipContract.filters.GameResolved(gameId);

  let settled = false;

  flipContract.once(filter, (gid, player, playerWon, payout, newStreak) => {
    if (settled) return;
    settled = true;
    onResult({
      won:       playerWon,
      payout:    formatUSDC(payout),
      newStreak: Number(newStreak),
    });
  });

  setTimeout(() => {
    if (!settled) {
      settled = true;
      flipContract.off(filter);
      _showErr('Sonuç zaman aşımına uğradı — cancelExpiredGame çağırabilirsin');
    }
  }, timeoutMs);
}

// ── OYUNCU BİLGİSİ ────────────────────────────────────────────────
async function loadPlayerState() {
  if (!flipContract || !walletAddress) return null;
  try {
    const [info, usdcBal] = await Promise.all([
      flipContract.getPlayerInfo(walletAddress),
      usdcContract.balanceOf(walletAddress),
    ]);
    return {
      streak:     Number(info.streak),
      arcPoints:  Number(info.points),
      multX1000:  Number(info.multiplierX1000),
      mult:       Number(info.multiplierX1000) / 1000,
      won:        formatUSDC(info.won),
      balance:    formatUSDC(usdcBal),
    };
  } catch (e) {
    console.warn('loadPlayerState:', e);
    return null;
  }
}

// ── SEED HASH (backend simülasyonu) ───────────────────────────────
// Production'da bu bir backend API çağrısı olacak.
// Backend: seed üretir → sha256 hash'i frontend'e verir → seed'i saklar
// → resolveGame() çağırdığında seed'i açar
async function _fetchSeedHash() {
  // Simülasyon — production'da kaldır, backend endpoint'i koy:
  // const r = await fetch('/api/seed', { method:'POST' });
  // return r.json(); // { seedHash: '0x...', seed: '...' }

  const seed = crypto.randomUUID() + '-' + Date.now();
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  const hex  = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  return { seedHash: '0x' + hex, seed };
}

// ── UI CALLBACKS ──────────────────────────────────────────────────
function _onConnected(addr) {
  const short = addr.slice(0,6) + '...' + addr.slice(-4);
  const btn   = document.getElementById('btn-wallet');
  if (btn) {
    btn.textContent = short;
    btn.style.cssText = `
      background:rgba(42,90,191,0.2);
      border:1px solid rgba(74,138,239,0.4);
      color:#4a8aef;
      font-family:'Space Mono',monospace;
      font-size:10px;
      padding:8px 16px;
      border-radius:6px;
      cursor:pointer;
    `;
  }
  loadPlayerState().then(state => {
    if (!state) return;
    const b = document.getElementById('bal-disp');
    const a = document.getElementById('ap-value');
    const s = document.getElementById('streak-disp');
    if (b) b.textContent = state.balance + ' USDC';
    if (a) a.textContent = state.arcPoints.toLocaleString();
    if (s) s.textContent = state.streak;
  });
}

function _onDisconnected() {
  const btn = document.getElementById('btn-wallet');
  if (btn) { btn.textContent = 'Connect Wallet'; btn.style.cssText = ''; }
}

function _showStatus(msg) {
  const n = document.getElementById('notif');
  if (!n) return;
  n.textContent = msg;
  n.className   = 'notif show-ok';
}

function _showErr(msg) {
  const n = document.getElementById('notif');
  if (!n) return;
  n.textContent = '✗ ' + msg;
  n.className   = 'notif show-err';
  setTimeout(() => { if (n.className.includes('show-err')) n.className = 'notif'; }, 5000);
}

// ── PUBLIC API ────────────────────────────────────────────────────
window.ArcFlipWeb3 = {
  connectWallet,
  startGame,
  waitForResult,
  loadPlayerState,
  formatUSDC,
  parseUSDC,
  ARCFLIP_ADDRESS,
  USDC_ADDRESS,
};
