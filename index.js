const fs = require('fs-extra');
const axios = require('axios');
const ethers = require('ethers');
const chalk = require('chalk');
const { HttpsProxyAgent } = require('https-proxy-agent');
const moment = require('moment');
const Groq = require('groq-sdk');

const config = {
    baseUrl: "https://fckqnmehuebqmevkicgz.supabase.co",
    origin: "https://liquicore.finance",
    referer: "https://liquicore.finance/",
    apiKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZja3FubWVodWVicW1ldmtpY2d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NzQ3NDksImV4cCI6MjA4NDQ1MDc0OX0.ryCrP8GkL68ORKerfisZ6kfmFjTcyl3UJx7S6cfHhmk",
    maxRetries: 5,
    retryDelay: 3000,
    dailyHour: 8,
    dailyMinute: 0,
    discordInterval: 30 * 60 * 1000,
    duelInterval: 5 * 60 * 60 * 1000,
    discordGuildId: "1460573383518322770",
    discordAppId: "1463169413485428747",
    faucets: [
        { name: "BNB",  channelId: "1463389834239414415", customId: "claim_bnb" },
        { name: "USDC", channelId: "1471443448933519370", customId: "claim_s1tusdc" },
        { name: "USDT", channelId: "1471443514490490892", customId: "claim_s1tusdt" }
    ],
    useGroq: true,
    groqModel: "llama-3.3-70b-versatile",

    autoWithdrawVault: true,
    autoDuelMatch: true,
    autoClaimRewards: true,
    dynamicGas: true,
    walletRotation: true,
    rpcHealthMonitor: true,
    activitySimulation: true,
    advancedQuizCache: true,
    flowWars: true,
    badgeAutoVerify: true,
    capsuleClaim: true,
    referralProcess: true,
    ogSync: true,
    leaderboardTrack: true,
    socialVerify: true,
    govSync: true,
    setAcceptedAt: true,
    resolveExpiredDuels: true,
    wavePoints: true,
    liqRewardLog: true,
    govVote: true,

    vaultWithdrawReserve: 50,
    activitySimInterval: 15 * 60 * 1000,
    rpcPingInterval: 5 * 60 * 1000,
    flowWarsInterval: 30 * 60 * 1000,
    badgeVerifyInterval: 4 * 60 * 60 * 1000,
    capsuleCheckInterval: 2 * 60 * 60 * 1000,
    leaderboardInterval: 60 * 60 * 1000,
    govVoteInterval: 2 * 60 * 60 * 1000,
    
    jitterMin: 0.8,
    jitterMax: 1.3,
};

const antiDetect = {
    minActionDelay: 2000,
    maxActionDelay: 8000,
    requestJitter: () => Math.floor(Math.random() * 2000) + 500,
    interactionDelay: () => Math.floor(Math.random() * 3000) + 1000,
    userAgents: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
    ],
    getRandomUA() { return this.userAgents[Math.floor(Math.random() * this.userAgents.length)]; },
    generateSessionId() {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let r = '';
        for (let i = 0; i < 32; i++) r += chars[Math.floor(Math.random() * chars.length)];
        return r;
    }
};

let accounts = [];
let configData = {};
try {
    accounts = require('./accounts.json');
    try {
        configData = require('./config.json');
        if (configData.grokApiKey) config.grokApiKey = configData.grokApiKey;
    } catch (_) {}
} catch (_) {
    console.log(chalk.red('❌ Error loading accounts.json'));
    process.exit(1);
}

let groqClient = null;
if (config.useGroq && config.grokApiKey) {
    try { groqClient = new Groq({ apiKey: config.grokApiKey }); console.log(chalk.green('✅ Groq AI initialized')); }
    catch (_) {}
}

const RPC_URLS = [
    'https://data-seed-prebsc-1-s1.bnbchain.org:8545/',
    'https://data-seed-prebsc-2-s1.bnbchain.org:8545/',
    'https://bsc-testnet-rpc.publicnode.com'
];
const rpcHealth = RPC_URLS.map(url => ({ url, latency: Infinity, ok: true }));
let currentRpcIndex = 0;
let provider = new ethers.providers.JsonRpcProvider(RPC_URLS[0]);

function rotateRpc() {
    currentRpcIndex = (currentRpcIndex + 1) % RPC_URLS.length;
    provider = new ethers.providers.JsonRpcProvider(RPC_URLS[currentRpcIndex]);
    console.log(chalk.gray(`🔄 RPC rotated → ${RPC_URLS[currentRpcIndex]}`));
}

async function monitorRpcHealth() {
    for (let i = 0; i < RPC_URLS.length; i++) {
        const t0 = Date.now();
        try {
            const p = new ethers.providers.JsonRpcProvider(RPC_URLS[i]);
            await p.getBlockNumber();
            rpcHealth[i] = { url: RPC_URLS[i], latency: Date.now() - t0, ok: true };
        } catch { rpcHealth[i] = { url: RPC_URLS[i], latency: Infinity, ok: false }; }
    }
    const best = rpcHealth.map((r, i) => ({ ...r, index: i })).filter(r => r.ok).sort((a, b) => a.latency - b.latency)[0];
    if (best && best.index !== currentRpcIndex) {
        console.log(chalk.cyan(`⚡ RPC switching to fastest [${best.latency}ms] → ${best.url}`));
        currentRpcIndex = best.index;
        provider = new ethers.providers.JsonRpcProvider(RPC_URLS[currentRpcIndex]);
    }
}

function addJitter(intervalMs) {
    const jitterFactor = config.jitterMin + Math.random() * (config.jitterMax - config.jitterMin);
    return Math.floor(intervalMs * jitterFactor);
}

async function getDynamicGasPrice() {
    try {
        const feeData = await provider.getFeeData();
        if (feeData.maxFeePerGas) return {
            maxFeePerGas: feeData.maxFeePerGas.mul(110).div(100),
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
                ? feeData.maxPriorityFeePerGas.mul(110).div(100)
                : ethers.utils.parseUnits('2', 'gwei')
        };
    } catch {}
    return { gasPrice: (await provider.getGasPrice()).mul(110).div(100) };
}

const USDC_ADDR       = '0xaD88B079712CC38a8D33E072CB6434E652556441';
const USDT_ADDR       = '0x5c0d9bb86b99168Aa8A36fad84d068d258c259a5';
const VAULT_ADDR      = '0xC044428E4f0b46C9897730fc9137806Ed8deBB9d';
const LAAS_VAULT_ADDR = '0xB8332cfE7DddD45CEcAADA6C0e564b09AbBb5744';
const DUEL_ADDR       = '0xFbB6a304e361AE93B33A87a3700CC1CF1b2bAc8c';
const PAYOUT_ADDR     = '0x1721EbeA050E33f6c581dE6bc231354aa38E5361';
const GOV_ADDR        = '0xd53868E4b0c16ED332f37f005d4851D3EB547deB';

const DAILY_DUEL_LIMIT    = 1;
const SAME_OPPONENT_LIMIT = 3;
const RATE_LIMIT_DUELS    = 3;
const RATE_LIMIT_WINDOW   = 2 * 60 * 1000;

const DUEL_ABI = [
    'function createDuel(uint256 wagerAmount, address wagerToken, uint8 duelType) returns (uint256)',
    'function acceptDuel(uint256 duelId)',
    'function cancelDuel(uint256 duelId)',
    'function claimAllPrizes()',
    'function claimAllRefunds()',
    'function getOpenDuels() view returns (tuple(uint256 id, address challenger, address opponent, uint256 wagerAmount, address wagerToken, uint8 duelType, uint8 status, uint256 createdAt, uint256 expiresAt, address winner, bool prizeClaimed)[])',
    'function getUserDuels(address user) view returns (uint256[])',
    'function getDuel(uint256 duelId) view returns (tuple(uint256 id, address challenger, address opponent, uint256 wagerAmount, address wagerToken, uint8 duelType, uint8 status, uint256 createdAt, uint256 expiresAt, address winner, bool prizeClaimed))'
];
const DUEL_STATUS = { PENDING: 0, ACTIVE: 1, RESOLVED: 2, CLAIMED: 3, CANCELLED: 4 };

const GOV_ABI = ['function vote(uint256 roundId, uint256 poolId, uint256 voteCount)'];

const VAULT_ABI = [
    'function deposit(uint8 assetIdx, uint256 amount, uint8 tierIndex)',
    'function withdraw(uint8 assetIdx, uint256 amount)',
    'function getUserBalance(address user, uint8 assetIdx) view returns (uint256)',
    'function balanceOf(address user, uint8 assetIdx) view returns (uint256)'
];
const LAAS_ABI = [
    'function deposit(uint8 assetIdx, uint256 amount)',
    'function withdraw(uint8 assetIdx, uint256 amount)',
    'function balanceOf(address user, uint8 assetIdx) view returns (uint256)'
];

const PAYOUT_ABI = [
    'function getClaimable(address user, uint256[] duelIds) view returns (uint256 totalAmount, uint256 claimableCount, uint256[] claimableDuelIds)',
    'function getDuelPayout(uint256 duelId) view returns (address winner, address token, uint256 payoutAmount, bool alreadyClaimed, bool isCompleted)',
    'function claimed(uint256) view returns (bool)',
    'function claimMultiple(uint256[] duelIds) returns (uint256 totalAmount, uint256 successCount)',
    'function claimPrize(uint256 duelId) returns (uint256 payout)',
];

const errorLogs = [];
const MAX_ERROR_LOGS = 10;
const state = {};

const QUIZ_CACHE = { date: '', answers: null, quizData: null, perfectAnswers: null, walletResults: {} };

const createState = (i) => ({
    name: `Acc ${i + 1}`,
    points: '-', streak: '-', rank: '-',
    discordFaucet: '⏳', webFaucet: '⏳',
    dailyTask: '⏳', dailyQuiz: '⏳',
    govVote: '⏳',
    duelStatus: '⏳',
    vaultWithdraw: '⏳',
    claimStatus: '⏳',
    flowWarsStatus: '⏳',
    badgeStatus: '⏳',
    capsuleStatus: '⏳',
    referralStatus: '⏳',
    nextDaily: null, nextDuel: null, nextDiscord: null,
    nextFlowWars: null,
    nextBadgeVerify: null,
    nextCapsuleCheck: null,
    nextLeaderboard: null,
    nextGovVote: null,
    lastDiscord: 0, lastDaily: 0, lastDuel: 0,
    isProcessing: false,
    duelHistory: [], dailyDuelCount: 0, duelFailures: 0,
    earnedBadges: [],
    capsuleSlots: [],
    govSync: false,
    wavePoints: '-',
    liqLog: [],
    flowWarsCooldown: null,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomSleep = () => sleep(randomDelay(antiDetect.minActionDelay, antiDetect.maxActionDelay));

function formatTime(ms) {
    if (ms <= 0) return chalk.green("Ready");
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

function getNextDailySchedule() {
    const now = new Date(), next = new Date(now);
    next.setHours(config.dailyHour, config.dailyMinute, 0, 0);
    if (now >= next) next.setDate(next.getDate() + 1);
    return next;
}

function getNextDiscordSchedule() { 
    return new Date(Date.now() + addJitter(config.discordInterval)); 
}

function logError(idx, msg, err = null) {
    const t = moment().format('HH:mm:ss');
    errorLogs.push(`[${t}] [Acc ${idx + 1}] ❌ ${msg}`);
    if (errorLogs.length > MAX_ERROR_LOGS) errorLogs.shift();
    if (err) console.log(chalk.red(`[Acc ${idx + 1}] Error:`), err.message || err);
}

function getRotatedWalletOrder() {
    if (!config.walletRotation || accounts.length <= 1) return [...Array(accounts.length).keys()];
    const idx = [...Array(accounts.length).keys()];
    for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
}

async function withRetry(fn, idx, actionName, maxRetries = config.maxRetries) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await sleep(antiDetect.requestJitter());
            return { success: true, result: await fn() };
        } catch (error) {
            lastError = error;
            const msg = error.message || '';
            if (msg.includes('429') || msg.includes('rate limit')) {
                if (state[idx]) state[idx][actionName] = `⏳RL${attempt}`;
                await sleep(30000 + attempt * 10000); continue;
            }
            if (msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('proxy')) {
                rotateRpc();
                if (state[idx]) state[idx][actionName] = `⏳R${attempt}`;
                await sleep(config.retryDelay * attempt); continue;
            }
            if (msg.includes('already') || msg.includes('cooldown')) return { success: true, result: 'already_done' };
            if (attempt < maxRetries) {
                if (state[idx]) state[idx][actionName] = `⏳R${attempt}`;
                await sleep(config.retryDelay * attempt);
            }
        }
    }
    logError(idx, `${actionName}: ${(lastError?.reason || lastError?.message || 'failed').slice(0, 200)}`, lastError);
    return { success: false, error: lastError };
}

const BANNER = () => {
    const now = moment().format('HH:mm:ss');
    const date = moment().format('ddd DD MMM YYYY');
    return (
        chalk.bold.magenta('  ╔══════════════════════════════════════════════════════════╗\n') +
        chalk.bold.magenta('  ║') + chalk.bold.white('  ⬡  LIQUICORE BOT') + chalk.bold.cyan('  ✦  by mejri02') + chalk.bold.gray('                          ') + chalk.bold.magenta('║\n') +
        chalk.bold.magenta('  ║') + chalk.bold.gray(`  v9.1  │  ${date}  │  ${now}`) + chalk.bold.gray('                    ') + chalk.bold.magenta('║\n') +
        chalk.bold.magenta('  ╚══════════════════════════════════════════════════════════╝')
    );
};

function clearScreen() { process.stdout.write('\x1B[2J\x1B[0f'); }

function renderDashboard() {
    clearScreen(); process.stdout.write('\x1B[1;1H');
    console.log(BANNER());
    const now = Date.now();
    const bestRpc = rpcHealth.filter(r => r.ok).sort((a, b) => a.latency - b.latency)[0];
    const rpcLabel = RPC_URLS[currentRpcIndex].replace('https://', '').split('/')[0];
    const rpcMs = bestRpc?.latency !== Infinity ? chalk.green(`${bestRpc?.latency}ms`) : chalk.red('dead');

    const LINE = chalk.gray('  ' + '─'.repeat(74));

    Object.keys(state).sort((a, b) => +a - +b).forEach(idx => {
        const s = state[idx];

        const td  = formatTime((s.nextDaily      ? s.nextDaily.getTime()       : now) - now);
        const tdu = formatTime((s.nextDuel       ? s.nextDuel.getTime()        : now) - now);
        const tdi = formatTime((s.nextDiscord    ? s.nextDiscord.getTime()     : now) - now);
        const tfw = formatTime((s.nextFlowWars   ? s.nextFlowWars.getTime()    : now) - now);
        const tbv = formatTime((s.nextBadgeVerify? s.nextBadgeVerify.getTime() : now) - now);
        const tgv = formatTime((s.nextGovVote    ? s.nextGovVote.getTime()     : now) - now);

        const tag = v => {
            if (!v) return chalk.gray('──');
            if (v.startsWith('✅')) return chalk.greenBright(v);
            if (v.startsWith('❌')) return chalk.redBright(v);
            if (v.startsWith('⏳')) return chalk.yellowBright(v);
            if (v.startsWith('🔄')) return chalk.cyanBright(v);
            if (v.startsWith('⛔')) return chalk.red(v);
            if (v.startsWith('🟡')) return chalk.yellow(v);
            return chalk.white(v);
        };

        const pts  = String(s.points).padStart(6);
        const strk = String(s.streak).padStart(3);
        const rank = String(s.rank).padStart(5);
        const wave = String(s.wavePoints).padStart(5);
        const waveStatus = s.govSync ? chalk.green('✦') : chalk.gray('·');

        console.log('');
        console.log(
            chalk.bold.magenta(`  ┌─ ${s.name} `) +
            chalk.gray('─'.repeat(Math.max(0, 70 - s.name.length))) +
            chalk.bold.magenta('┐')
        );
        console.log(
            chalk.magenta('  │ ') +
            chalk.cyan('💎 LIQ') + chalk.white(` ${pts}  `) +
            chalk.yellow('🔥 Streak') + chalk.white(` ${strk}d  `) +
            chalk.green('🏆 Rank') + chalk.white(` #${rank}  `) +
            chalk.blue('🌊 Wave') + chalk.white(` ${wave}  `) +
            waveStatus + chalk.gray(' GovSync') +
            chalk.magenta(`  │`)
        );
        console.log(LINE);
        console.log(
            chalk.magenta('  │ ') +
            chalk.blue('🔔 Discord') + ` ${tag(s.discordFaucet)}` + chalk.gray('  │  ') +
            chalk.green('🌐 Faucet ') + ` ${tag(s.webFaucet)}` + chalk.gray('  │  ') +
            chalk.cyan('📅 Daily  ') + ` ${tag(s.dailyTask)}` +
            chalk.magenta('  │')
        );
        console.log(
            chalk.magenta('  │ ') +
            chalk.yellow('❓ Quiz   ') + ` ${tag(s.dailyQuiz)}` + chalk.gray('  │  ') +
            chalk.magenta('🗳  Gov    ') + ` ${tag(s.govVote)}` + chalk.gray('  │  ') +
            chalk.red('⚔  Duel   ') + ` ${tag(s.duelStatus)}` +
            chalk.magenta('  │')
        );
        console.log(
            chalk.magenta('  │ ') +
            chalk.green('🏦 Vault  ') + ` ${tag(s.vaultWithdraw)}` + chalk.gray('  │  ') +
            chalk.cyan('🎁 Claims ') + ` ${tag(s.claimStatus)}` + chalk.gray('  │  ') +
            chalk.yellow('⚡ FlowWar') + ` ${tag(s.flowWarsStatus)}` +
            chalk.magenta('  │')
        );
        console.log(
            chalk.magenta('  │ ') +
            chalk.magenta('🏅 Badges ') + ` ${tag(s.badgeStatus)}` + chalk.gray('  │  ') +
            chalk.blue('💊 Capsule') + ` ${tag(s.capsuleStatus)}` + chalk.gray('  │  ') +
            chalk.green('👥 Refer  ') + ` ${tag(s.referralStatus)}` +
            chalk.magenta('  │')
        );
        console.log(LINE);
        console.log(
            chalk.magenta('  │ ') +
            chalk.gray('Next → ') +
            chalk.white('Daily:') + chalk.cyan(` ${td}  `) +
            chalk.white('Duel:')  + chalk.cyan(` ${tdu}  `) +
            chalk.white('DC:')    + chalk.cyan(` ${tdi}  `) +
            chalk.white('FW:')    + chalk.cyan(` ${tfw}  `) +
            chalk.white('Gov:')   + chalk.cyan(` ${tgv}  `) +
            chalk.white('Badge:') + chalk.cyan(` ${tbv}`) +
            chalk.magenta('  │')
        );
        console.log(chalk.bold.magenta('  └' + '─'.repeat(74) + '┘'));
    });

    if (errorLogs.length > 0) {
        console.log('');
        console.log(chalk.red.bold('  ⚠  Errors:'));
        errorLogs.slice(-3).forEach(l => console.log(chalk.red(`    ${l}`)));
    }

    console.log('');
    console.log(
        chalk.gray('  ') +
        chalk.bold.magenta('✦ mejri02') +
        chalk.gray('  │  ') +
        chalk.gray(`🕒 ${moment().format('HH:mm:ss')}`) +
        chalk.gray('  │  ') +
        chalk.gray('AI:') + (groqClient ? chalk.green(' ✅ Groq') : chalk.red(' ❌')) +
        chalk.gray('  │  ') +
        chalk.gray('RPC: ') + chalk.cyan(rpcLabel) + chalk.gray(' [') + rpcMs + chalk.gray(']') +
        chalk.gray('  │  ') +
        chalk.gray(`Wallets: ${accounts.length}`) +
        chalk.gray('  │  Ctrl+C to stop')
    );
    console.log('');
}

function createClient(proxy) {
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    return axios.create({
        baseURL: config.baseUrl, httpsAgent: agent, timeout: 30000,
        headers: {
            'apikey': config.apiKey, 'content-type': 'application/json',
            'origin': config.origin, 'referer': config.referer,
            'user-agent': antiDetect.getRandomUA(),
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9',
            'sec-ch-ua': '"Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'cross-site',
            'cache-control': 'no-cache', 'pragma': 'no-cache'
        }
    });
}

function createDiscordClient(token, proxy) {
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
    const sessionId = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    const launchId  = [8, 4, 4, 4, 12].map(n => [...Array(n)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')).join('-');
    return axios.create({
        timeout: 30000, httpsAgent: agent,
        headers: {
            'Authorization': token, 'Content-Type': 'application/json', 'User-Agent': ua,
            'Origin': 'https://discord.com',
            'Referer': 'https://discord.com/channels/1460573383518322770/1471443514490490892',
            'X-Debug-Options': 'bugReporterEnabled', 'X-Discord-Locale': 'en-US',
            'X-Discord-Timezone': 'Asia/Jakarta',
            'X-Super-Properties': Buffer.from(JSON.stringify({
                os: 'Mac OS X', browser: 'Chrome', device: '', system_locale: 'en-US',
                has_client_mods: false, browser_user_agent: ua, browser_version: '145.0.0.0',
                os_version: '10.15.7', referrer: '', referring_domain: '',
                referrer_current: '', referring_domain_current: '',
                release_channel: 'stable', client_build_number: 500462,
                client_event_source: null, client_launch_id: launchId,
                client_heartbeat_session_id: sessionId, client_app_state: 'focused'
            })).toString('base64')
        }
    });
}

async function getTokenBalance(wallet, tokenAddress) {
    try {
        return await new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], wallet).balanceOf(wallet.address);
    } catch { return ethers.BigNumber.from(0); }
}

async function getAllowance(wallet, tokenAddress, spender) {
    try {
        return await new ethers.Contract(tokenAddress, ['function allowance(address, address) view returns (uint256)'], wallet).allowance(wallet.address, spender);
    } catch { return ethers.BigNumber.from(0); }
}

async function ensureApproval(wallet, tokenAddress, spender) {
    const minAllowance = ethers.utils.parseUnits("100000", 18);
    if ((await getAllowance(wallet, tokenAddress, spender)).gte(minAllowance)) return true;
    try {
        const data = '0x095ea7b3' + '000000000000000000000000' + spender.slice(2).toLowerCase() + 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
        const gasOpts = await getDynamicGasPrice();
        const tx = await wallet.sendTransaction({ to: tokenAddress, data, gasLimit: 200000, ...gasOpts });
        await tx.wait();
        return true;
    } catch (e) { console.log(chalk.red(`⚠️ Approval Error: ${e.reason || e.message}`)); return false; }
}

async function autoWithdrawVault(wallet, idx) {
    if (!config.autoWithdrawVault) return;
    state[idx].vaultWithdraw = '🔄';
    const vaultContract = new ethers.Contract(VAULT_ADDR, VAULT_ABI, wallet);

    for (const [assetIdx, tokenName, decimals] of [[0, 'tUSDT', 18], [1, 'tUSDC', 6]]) {
        try {
            let vaultBal = ethers.BigNumber.from(0);
            try { vaultBal = await vaultContract.getUserBalance(wallet.address, assetIdx); }
            catch { try { vaultBal = await vaultContract.balanceOf(wallet.address, assetIdx); } catch {} }
            if (vaultBal.isZero()) continue;

            const reserve = ethers.utils.parseUnits(config.vaultWithdrawReserve.toString(), decimals);
            if (vaultBal.lte(reserve)) continue;

            const withdrawAmt = vaultBal.sub(reserve);
            console.log(chalk.cyan(`[Acc ${idx + 1}] 🏦 Withdrawing ${ethers.utils.formatUnits(withdrawAmt, decimals)} ${tokenName} from RLP Vault...`));

            await withRetry(async () => {
                try { await vaultContract.callStatic.withdraw(assetIdx, withdrawAmt); }
                catch (sim) { console.log(chalk.yellow(`[Acc ${idx + 1}] Vault withdraw sim failed: ${sim.reason || sim.message}`)); return 'skip'; }
                const gasOpts = await getDynamicGasPrice();
                const tx = await vaultContract.withdraw(assetIdx, withdrawAmt, { gasLimit: 500000, ...gasOpts });
                const r = await tx.wait();
                console.log(chalk.green(`[Acc ${idx + 1}] ✅ ${tokenName} Vault Withdraw! Block: ${r.blockNumber}`));
            }, idx, 'vaultWithdraw');
            await sleep(3000);
        } catch (e) { console.log(chalk.yellow(`[Acc ${idx + 1}] VaultWithdraw ${tokenName}: ${e.message?.slice(0, 60)}`)); }
    }
    state[idx].vaultWithdraw = '✅';
}

async function autoClaimAllRewards(wallet, idx, client) {
    if (!config.autoClaimRewards) return;
    state[idx].claimStatus = '🔄';
    const addr = wallet.address.toLowerCase();

    try {
        const dbRes = await client.get(
            `/rest/v1/duel_records?select=duel_id` +
            `&winner_address=eq.${addr}` +
            `&prize_claimed=eq.false` +
            `&contract_version=eq.s1` +
            `&status=eq.resolved`
        );
        const unclaimedIds = (dbRes.data || []).map(r => Number(r.duel_id));

        if (unclaimedIds.length === 0) {
            console.log(chalk.gray(`[Acc ${idx + 1}] 🎁 No unclaimed prizes in DB`));
            state[idx].claimStatus = '✅0';
            return;
        }

        console.log(chalk.cyan(`[Acc ${idx + 1}] 🎁 ${unclaimedIds.length} potential prize(s) — verifying on-chain...`));

        const payoutContract = new ethers.Contract(PAYOUT_ADDR, PAYOUT_ABI, wallet);
        let claimableIds;
        try {
            const result = await payoutContract.getClaimable(
                wallet.address,
                unclaimedIds.map(id => ethers.BigNumber.from(id))
            );
            const claimableCount = Number(result.claimableCount);
            if (claimableCount === 0) {
                console.log(chalk.gray(`[Acc ${idx + 1}] 🎁 Already claimed on-chain — syncing DB...`));
                await Promise.all(unclaimedIds.map(id =>
                    client.patch(
                        `/rest/v1/duel_records?duel_id=eq.${id}&contract_version=eq.s1`,
                        { prize_claimed: true }
                    ).catch(() => {})
                ));
                state[idx].claimStatus = '✅Sync';
                return;
            }
            claimableIds = result.claimableDuelIds.map(id => id);
            console.log(chalk.cyan(`[Acc ${idx + 1}] 🎁 ${claimableCount} prize(s) claimable — sending tx...`));
        } catch (e) {
            console.log(chalk.yellow(`[Acc ${idx + 1}] 🎁 getClaimable failed, skipping claim to avoid revert: ${e.message?.slice(0, 60)}`));
            state[idx].claimStatus = '⏳';
            return;
        }

        const gasOpts = await getDynamicGasPrice();
        const gasLimit = 150000n + 200000n * BigInt(claimableIds.length);
        const tx = await payoutContract.claimMultiple(claimableIds, {
            gasLimit: gasLimit.toString(),
            ...gasOpts
        });
        const receipt = await tx.wait();

        if (receipt.status === 0) {
            console.log(chalk.red(`[Acc ${idx + 1}] 🎁 claimMultiple reverted on-chain`));
            state[idx].claimStatus = '❌';
            return;
        }

        console.log(chalk.green(`[Acc ${idx + 1}] ✅ Prizes claimed! TX: ${tx.hash.slice(0, 20)}...`));

        for (const idBN of claimableIds) {
            const duelId = Number(idBN);
            client.post('/functions/v1/sync-prize-claimed',
                { duel_id: duelId, contract_version: 's1' },
                { headers: { 'x-wallet-address': addr } }
            ).catch(() => {});
        }

        state[idx].claimStatus = `✅${claimableIds.length}`;

    } catch (e) {
        const msg = e.message || '';
        if (msg.includes('already claimed') || msg.includes('nothing')) {
            console.log(chalk.gray(`[Acc ${idx + 1}] 🎁 Nothing to claim`));
            state[idx].claimStatus = '✅0';
        } else {
            console.log(chalk.yellow(`[Acc ${idx + 1}] 🎁 Claim error: ${msg.slice(0, 80)}`));
            state[idx].claimStatus = '❌';
        }
    }

    try {
        const duelContract = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
        await duelContract.callStatic.claimAllRefunds();
        const gasOpts = await getDynamicGasPrice();
        const tx = await duelContract.claimAllRefunds({ gasLimit: 400000, ...gasOpts });
        await tx.wait();
        console.log(chalk.green(`[Acc ${idx + 1}] 🎁 Refunds claimed!`));
    } catch (e) {
        const r = e.reason || e.message || '';
        if (!r.includes('nothing') && !r.includes('no refund') && !r.includes('CALL_EXCEPTION')) {
            console.log(chalk.gray(`[Acc ${idx + 1}] 🎁 No refunds: ${r.slice(0, 50)}`));
        }
    }
}

async function simulateActivity(client, wallet, idx) {
    if (!config.activitySimulation) return;
    const addr = wallet.address.toLowerCase();
    const pages = [
        `/rest/v1/user_profiles_public?select=total_liq_earned,s1_liq_earned&wallet_address=eq.${addr}`,
        `/rest/v1/s1_checkins?select=checkin_date&wallet_address=eq.${addr}&order=checkin_date.desc&limit=7`,
        `/rest/v1/s1_governance_votes?wallet_address=eq.${addr}&select=id&limit=5`,
        `/rest/v1/s1_daily_quiz_attempts?wallet_address=eq.${addr}&select=score_percent&order=created_at.desc&limit=3`,
        `/rest/v1/s1_duel_stats?wallet_address=eq.${addr}&select=*`,
    ];
    console.log(chalk.gray(`[Acc ${idx + 1}] 🖥️ Simulating dashboard activity...`));
    for (const p of pages) { try { await sleep(antiDetect.interactionDelay()); await client.get(p); } catch {} }
    state[idx].nextActivity = new Date(Date.now() + addJitter(config.activitySimInterval));
}

async function processFlowWars(account, idx) {
    if (!config.flowWars) return;
    state[idx].flowWarsStatus = '🔄';
    renderDashboard();

    const client = createClient(account.proxy);
    const addr = new ethers.Wallet(account.privateKey, provider).address.toLowerCase();

    try {
        console.log(chalk.cyan(`[Acc ${idx + 1}] ⚡ Flow Wars: Finding match...`));

        if (state[idx].flowWarsCooldown && Date.now() < state[idx].flowWarsCooldown) {
            const remaining = state[idx].flowWarsCooldown - Date.now();
            console.log(chalk.yellow(`[Acc ${idx + 1}] Flow Wars: Cooldown active, ${formatTime(remaining)} remaining`));
            state[idx].flowWarsStatus = '⏳CD';
            state[idx].nextFlowWars = new Date(state[idx].flowWarsCooldown + randomDelay(1000, 30000));
            return;
        }

        const matchRes = await withRetry(async () => {
            const { data } = await client.post('/functions/v1/flow-wars-matchmake',
                { wallet_address: addr, action: 'create' },
                { headers: { 'x-wallet-address': addr } }
            );
            return data;
        }, idx, 'flowWarsStatus');

        if (!matchRes.success) {
            const err = matchRes.result?.error || matchRes.error?.message || '';
            
            if (err.includes('cooldown') || err.includes('try again later')) {
                let cooldownMs = config.flowWarsInterval;
                
                const cooldownMatch = err.match(/(\d+)\s*(min|hour|second|sec|minute)/i);
                if (cooldownMatch) {
                    const value = parseInt(cooldownMatch[1]);
                    const unit = cooldownMatch[2].toLowerCase();
                    if (unit.includes('min')) cooldownMs = value * 60 * 1000;
                    else if (unit.includes('hour')) cooldownMs = value * 60 * 60 * 1000;
                    else if (unit.includes('sec')) cooldownMs = value * 1000;
                }
                
                cooldownMs = addJitter(cooldownMs);
                
                state[idx].flowWarsCooldown = Date.now() + cooldownMs;
                state[idx].flowWarsStatus = '⏳CD';
                state[idx].nextFlowWars = new Date(state[idx].flowWarsCooldown);
                console.log(chalk.yellow(`[Acc ${idx + 1}] Flow Wars: Cooldown detected, waiting ${formatTime(cooldownMs)}`));
                return;
            }
            
            if (err === 'insufficient_badges') {
                console.log(chalk.yellow(`[Acc ${idx + 1}] Flow Wars: Need more badges (minted: ${matchRes.result?.minted_count ?? '?'})`));
            } else {
                console.log(chalk.yellow(`[Acc ${idx + 1}] Flow Wars: No match found — ${err || 'unknown'}`));
            }
            state[idx].flowWarsStatus = '⏳Wait';
            state[idx].nextFlowWars = new Date(Date.now() + addJitter(10 * 60 * 1000));
            return;
        }

        const match = matchRes.result?.match || matchRes.result;
        if (!match || !match.id) {
            console.log(chalk.gray(`[Acc ${idx + 1}] Flow Wars: Waiting for opponent...`));
            state[idx].flowWarsStatus = '⏳Wait';
            state[idx].nextFlowWars = new Date(Date.now() + addJitter(10 * 60 * 1000));
            return;
        }

        console.log(chalk.cyan(`[Acc ${idx + 1}] ⚡ Flow Wars: Match found #${match.id}! Solving...`));

        const routes = buildFlowWarsRoutes(match);
        const timeSeconds = randomDelay(4, 12);
        await sleep(randomDelay(800, 2500));

        const submitRes = await withRetry(async () => {
            const { data } = await client.post('/functions/v1/flow-wars-submit',
                { wallet_address: addr, match_id: match.id, routes, time_seconds: timeSeconds },
                { headers: { 'x-wallet-address': addr } }
            );
            return data;
        }, idx, 'flowWarsStatus');

        if (submitRes.success || submitRes.result?.success) {
            console.log(chalk.green(`[Acc ${idx + 1}] ✅ Flow Wars submitted! ${submitRes.result?.message || ''}`));
            state[idx].flowWarsStatus = '✅';
            
            if (submitRes.result?.cooldown_until || submitRes.result?.next_available) {
                const nextAvailable = new Date(submitRes.result?.cooldown_until || submitRes.result?.next_available).getTime();
                if (!isNaN(nextAvailable) && nextAvailable > Date.now()) {
                    state[idx].flowWarsCooldown = nextAvailable;
                    console.log(chalk.cyan(`[Acc ${idx + 1}] Flow Wars: Server cooldown until ${new Date(nextAvailable).toLocaleTimeString()}`));
                }
            } else {
                const cooldownMs = addJitter(config.flowWarsInterval);
                state[idx].flowWarsCooldown = Date.now() + cooldownMs;
            }
        } else {
            console.log(chalk.yellow(`[Acc ${idx + 1}] Flow Wars submit: ${submitRes.result?.error || 'unknown result'}`));
            state[idx].flowWarsStatus = '❌';
            
            if (submitRes.result?.error?.includes('cooldown')) {
                const cooldownMs = addJitter(config.flowWarsInterval);
                state[idx].flowWarsCooldown = Date.now() + cooldownMs;
            }
        }

    } catch (e) {
        console.log(chalk.red(`[Acc ${idx + 1}] Flow Wars error: ${e.message?.slice(0, 80)}`));
        state[idx].flowWarsStatus = '❌';
        
        if (e.message?.includes('cooldown') || e.response?.data?.error?.includes('cooldown')) {
            const cooldownMs = addJitter(config.flowWarsInterval);
            state[idx].flowWarsCooldown = Date.now() + cooldownMs;
        }
    }

    if (state[idx].flowWarsCooldown) {
        state[idx].nextFlowWars = new Date(state[idx].flowWarsCooldown);
    } else {
        state[idx].nextFlowWars = new Date(Date.now() + addJitter(config.flowWarsInterval));
    }
}

function buildFlowWarsRoutes(match) {
    const routes = [];
    try {
        const nodes = match.puzzle_nodes || match.nodes || match.pools || [];
        if (nodes.length >= 2) {
            for (let i = 0; i < nodes.length - 1; i++) {
                routes.push({ from: nodes[i], to: nodes[i + 1], amount: randomDelay(100, 1000) });
            }
        } else {
            routes.push({ from: 'pool_a', to: 'pool_b', amount: 500 });
            routes.push({ from: 'pool_b', to: 'pool_c', amount: 300 });
        }
    } catch {}
    return routes;
}

async function autoBadgeVerify(account, idx) {
    if (!config.badgeAutoVerify) return;
    state[idx].badgeStatus = '🔄';
    renderDashboard();

    const client = createClient(account.proxy);
    const addr = new ethers.Wallet(account.privateKey, provider).address.toLowerCase();

    const ALL_BADGE_IDS = [
        'early-bird', 'genesis-member',
        'first-deposit', 'vault-guardian', 'diamond-vault', 'lock-master', 'long-term-holder',
        'laas-initiate', 'lp-holder', 'lp-guardian', 'lp-whale', 'laas-diamond',
        'duel-creator', 'duel-acceptor', 'duel-master', 'winning-streak', 'arena-champion',
        'first-vote', 'active-voter', 'voting-streak', 'governance-master', 'multi-voter',
        'triple-voter', 'daily-activist', 'voting-spree', 'round-participant', 'governance-whale',
        'quiz-starter', 'quiz-streak', 'knowledge-seeker', 'quiz-master',
        'week-warrior', 'bi-weekly-hero', 'streak-legend',
        'social-pioneer', 'social-linker', 'discord-active',
        'wave-1-holder', 'referral-champion',
        'century-earner', 'half-k-club', 'thousand-club', 'liq-elite', 'liq-legend',
        'defi-explorer', 'all-rounder', 'dual-champion', 'season-veteran', 'ultimate-defi-master', 'mythic-master'
    ];

    let alreadyEarned = new Set(state[idx].earnedBadges || []);
    try {
        const { data } = await client.get(`/rest/v1/user_badges?select=badge_id&wallet_address=eq.${addr}`);
        if (data) data.forEach(b => alreadyEarned.add(b.badge_id));
        state[idx].earnedBadges = [...alreadyEarned];
    } catch {}

    const toVerify = ALL_BADGE_IDS.filter(id => !alreadyEarned.has(id));
    console.log(chalk.cyan(`[Acc ${idx + 1}] 🏅 Badge verify: checking ${toVerify.length} unearned badges...`));

    let newlyEarned = 0;
    for (const badgeId of toVerify) {
        try {
            await sleep(antiDetect.requestJitter());
            const res = await withRetry(async () => {
                const { data } = await client.post('/functions/v1/verify-s1-badge',
                    { wallet_address: addr, badge_id: badgeId },
                    { headers: { 'x-wallet-address': addr } }
                );
                return data;
            }, idx, 'badgeStatus');

            if (res.success && res.result?.verified) {
                if (!res.result?.already_earned) {
                    console.log(chalk.green(`[Acc ${idx + 1}] 🏅 Badge earned: ${badgeId} (+${res.result?.reward || 0} LIQ)`));
                    newlyEarned++;
                }
                alreadyEarned.add(badgeId);
                state[idx].earnedBadges = [...alreadyEarned];

                if (config.ogSync) {
                    try {
                        await client.post('/functions/v1/s1-og-sync',
                            { minted_count: alreadyEarned.size },
                            { headers: { 'x-wallet-address': addr } }
                        );
                    } catch {}
                }
            }
        } catch {}
        await sleep(500);
    }

    state[idx].badgeStatus = `✅${alreadyEarned.size}`;
    console.log(chalk.green(`[Acc ${idx + 1}] ✅ Badge verify done: ${newlyEarned} new, ${alreadyEarned.size} total`));
    state[idx].nextBadgeVerify = new Date(Date.now() + addJitter(config.badgeVerifyInterval));
}

async function processCapsuleClaim(account, idx) {
    if (!config.capsuleClaim) return;
    state[idx].capsuleStatus = '🔄';
    renderDashboard();

    const client = createClient(account.proxy);
    const addr = new ethers.Wallet(account.privateKey, provider).address.toLowerCase();

    try {
        const [badgesRes, capsulesRes] = await Promise.all([
            client.get(`/rest/v1/user_badges?select=badge_id&wallet_address=eq.${addr}`),
            client.get(`/rest/v1/user_capsules?select=*&wallet_address=eq.${addr}&order=capsule_number`)
        ]);

        const badgeCount = badgesRes.data?.length || 0;
        const ownedCapsules = capsulesRes.data || [];
        const ownedNumbers = new Set(ownedCapsules.map(c => c.capsule_number));

        const eligibleCapsuleNumber = Math.floor(badgeCount / 10);
        const claimableSlots = [];
        for (let i = 1; i <= Math.min(eligibleCapsuleNumber, 5); i++) {
            if (!ownedNumbers.has(i)) claimableSlots.push(i);
        }

        if (claimableSlots.length === 0) {
            console.log(chalk.gray(`[Acc ${idx + 1}] 💊 Capsules: No claimable slots (badges: ${badgeCount}, owned: ${ownedCapsules.length}/5)`));
            state[idx].capsuleStatus = `✅${ownedCapsules.length}/5`;
            state[idx].nextCapsuleCheck = new Date(Date.now() + addJitter(config.capsuleCheckInterval));
            return;
        }

        console.log(chalk.cyan(`[Acc ${idx + 1}] 💊 Capsule: ${claimableSlots.length} claimable slot(s)! Claiming...`));

        const claimRes = await withRetry(async () => {
            const { data } = await client.post('/functions/v1/claim-capsule',
                { action: 'claim' },
                { headers: { 'x-wallet-address': addr } }
            );
            return data;
        }, idx, 'capsuleStatus');

        if (!claimRes.success || !claimRes.result?.signature) {
            console.log(chalk.yellow(`[Acc ${idx + 1}] 💊 Capsule claim signature failed: ${claimRes.result?.error || 'no sig'}`));
            state[idx].capsuleStatus = '❌';
            state[idx].nextCapsuleCheck = new Date(Date.now() + addJitter(config.capsuleCheckInterval));
            return;
        }

        console.log(chalk.green(`[Acc ${idx + 1}] ✅ Capsule claim initiated! Signature obtained.`));
        state[idx].capsuleStatus = `🟡Ready(${claimableSlots.length})`;

    } catch (e) {
        console.log(chalk.red(`[Acc ${idx + 1}] Capsule error: ${e.message?.slice(0, 80)}`));
        state[idx].capsuleStatus = '❌';
    }

    state[idx].nextCapsuleCheck = new Date(Date.now() + addJitter(config.capsuleCheckInterval));
}

async function processReferral(account, idx) {
    if (!config.referralProcess || !account.referralCode) return;
    state[idx].referralStatus = '🔄';

    const client = createClient(account.proxy);
    const addr = new ethers.Wallet(account.privateKey, provider).address.toLowerCase();

    try {
        const checkRes = await client.get(`/rest/v1/s1_referrals?select=id&referred_wallet=eq.${addr}&limit=1`);
        if (checkRes.data && checkRes.data.length > 0) {
            console.log(chalk.green(`[Acc ${idx + 1}] 👥 Referral already applied`));
            state[idx].referralStatus = '✅Done';
            return;
        }

        const res = await withRetry(async () => {
            const { data } = await client.post('/functions/v1/process-s1-referral',
                { wallet_address: addr, referral_code: account.referralCode },
                { headers: { 'x-wallet-address': addr } }
            );
            return data;
        }, idx, 'referralStatus');

        if (res.success || res.result?.success) {
            console.log(chalk.green(`[Acc ${idx + 1}] ✅ Referral processed!`));
            state[idx].referralStatus = '✅';
        } else {
            console.log(chalk.gray(`[Acc ${idx + 1}] Referral: ${res.result?.error || 'already used or invalid'}`));
            state[idx].referralStatus = '⏳';
        }
    } catch (e) {
        console.log(chalk.gray(`[Acc ${idx + 1}] Referral: ${e.message?.slice(0, 60)}`));
        state[idx].referralStatus = '❌';
    }
}

async function updateLeaderboardRank(account, idx) {
    if (!config.leaderboardTrack) return;
    const client = createClient(account.proxy);
    const addr = new ethers.Wallet(account.privateKey, provider).address.toLowerCase();
    try {
        const res = await client.get(`/rest/v1/s1_liq_badge_leaderboard?select=rank,total_s1_liq,wallet_address&wallet_address=eq.${addr}&limit=1`);
        if (res.data && res.data.length > 0) {
            state[idx].rank = res.data[0].rank || '-';
            state[idx].points = res.data[0].total_s1_liq || state[idx].points;
            console.log(chalk.cyan(`[Acc ${idx + 1}] 🏆 Leaderboard rank: #${state[idx].rank} | ${state[idx].points} LIQ`));
        }
    } catch {}
    state[idx].nextLeaderboard = new Date(Date.now() + addJitter(config.leaderboardInterval));
}

async function verifyDiscordLink(account, idx) {
    if (!config.socialVerify || !account.discordToken) return;
    const client = createClient(account.proxy);
    const addr = new ethers.Wallet(account.privateKey, provider).address.toLowerCase();
    try {
        const res = await withRetry(async () => {
            const { data } = await client.post('/functions/v1/verify-discord-link',
                { wallet_address: addr },
                { headers: { 'x-wallet-address': addr } }
            );
            return data;
        }, idx, 'badgeStatus');
        if (res.success && (res.result?.verified || res.result?.already_completed)) {
            console.log(chalk.green(`[Acc ${idx + 1}] 💬 Discord link verified: @${res.result?.username || 'linked'}`));
        }
    } catch {}
}

async function syncGovernanceVotes(account, idx) {
    if (!config.govSync) return;
    const client = createClient(account.proxy);
    const addr = new ethers.Wallet(account.privateKey, provider).address.toLowerCase();
    try {
        await client.post('/functions/v1/sync-governance-votes',
            { wallet_address: addr },
            { headers: { 'x-wallet-address': addr } }
        );
        state[idx].govSync = true;
        console.log(chalk.green(`[Acc ${idx + 1}] 🗳  Gov votes synced`));
    } catch (e) {
        console.log(chalk.gray(`[Acc ${idx + 1}] Gov sync: ${e.message?.slice(0, 50)}`));
    }
}

async function setDuelAcceptedAt(account, idx, duelId) {
    if (!config.setAcceptedAt) return;
    const client = createClient(account.proxy);
    const addr = new ethers.Wallet(account.privateKey, provider).address.toLowerCase();
    try {
        await client.post('/functions/v1/set-s1-accepted-at',
            { duel_id: duelId, wallet_address: addr },
            { headers: { 'x-wallet-address': addr } }
        );
        console.log(chalk.green(`[Acc ${idx + 1}] ⚔  Duel #${duelId} accepted_at timestamped`));
    } catch (e) {
        console.log(chalk.gray(`[Acc ${idx + 1}] set-accepted-at: ${e.message?.slice(0, 50)}`));
    }
}

async function resolveExpiredDuels(account, idx) {
    if (!config.resolveExpiredDuels) return;
    const client = createClient(account.proxy);
    const addr = new ethers.Wallet(account.privateKey, provider).address.toLowerCase();
    try {
        const { data } = await client.get(
            `/rest/v1/duel_records?select=duel_id,created_at,status` +
            `&or=(challenger_address.eq.${addr},opponent_address.eq.${addr})` +
            `&status=eq.active` +
            `&contract_version=eq.s1` +
            `&order=created_at.asc&limit=10`
        );
        if (!data || data.length === 0) return;

        const now = Date.now();
        const expiredDuels = data.filter(d => {
            const createdMs = new Date(d.created_at).getTime();
            return now - createdMs > 24 * 60 * 60 * 1000;
        });

        if (expiredDuels.length === 0) return;

        console.log(chalk.cyan(`[Acc ${idx + 1}] 🔁 Resolving ${expiredDuels.length} expired duel(s)...`));

        for (const d of expiredDuels) {
            try {
                await sleep(randomDelay(500, 1500));
                await client.post('/functions/v1/resolve-s1-duel',
                    { duel_id: d.duel_id, wallet_address: addr },
                    { headers: { 'x-wallet-address': addr } }
                );
                console.log(chalk.green(`[Acc ${idx + 1}] ✅ Duel #${d.duel_id} resolved`));
            } catch (e) {
                console.log(chalk.gray(`[Acc ${idx + 1}] resolve duel #${d.duel_id}: ${e.message?.slice(0, 50)}`));
            }
        }
    } catch (e) {
        console.log(chalk.gray(`[Acc ${idx + 1}] resolveExpired: ${e.message?.slice(0, 50)}`));
    }
}

async function fetchWavePoints(account, idx) {
    if (!config.wavePoints) return;
    const client = createClient(account.proxy);
    const addr = new ethers.Wallet(account.privateKey, provider).address.toLowerCase();
    try {
        const { data } = await client.get(
            `/rest/v1/og_wave_points_log?select=total_og_wave_points&wallet_address=eq.${addr}&limit=1`
        );
        if (data && data.length > 0) {
            state[idx].wavePoints = data[0].total_og_wave_points || 0;
            console.log(chalk.cyan(`[Acc ${idx + 1}] 🌊 Wave points: ${state[idx].wavePoints}`));
        }

        await client.post('/functions/v1/og-wave-points',
            { wallet_address: addr },
            { headers: { 'x-wallet-address': addr } }
        ).catch(() => {});
    } catch (e) {
        console.log(chalk.gray(`[Acc ${idx + 1}] wave points: ${e.message?.slice(0, 40)}`));
    }
}

async function fetchLiqRewardLog(account, idx) {
    if (!config.liqRewardLog) return;
    const client = createClient(account.proxy);
    const addr = new ethers.Wallet(account.privateKey, provider).address.toLowerCase();
    try {
        const today = new Date().toISOString().split('T')[0];
        const { data } = await client.get(
            `/rest/v1/liq_reward_log_public?select=action_type,liq_amount,created_at` +
            `&wallet_address=eq.${addr}` +
            `&created_at=gte.${today}T00:00:00` +
            `&order=liq_amount.desc&limit=20`
        );
        if (data && data.length > 0) {
            state[idx].liqLog = data;
            const totalToday = data.reduce((s, r) => s + (r.liq_amount || 0), 0);
            const topAction = data[0]?.action_type || '-';
            console.log(chalk.cyan(`[Acc ${idx + 1}] 📊 LIQ today: +${totalToday} | top action: ${topAction}`));
        }
    } catch (e) {
        console.log(chalk.gray(`[Acc ${idx + 1}] liq log: ${e.message?.slice(0, 40)}`));
    }
}

async function processGovernanceVote(account, idx) {
    if (!config.govVote) return;
    state[idx].govVote = '🔄';
    renderDashboard();

    const wallet = new ethers.Wallet(account.privateKey, provider);
    const client = createClient(account.proxy);
    const addr = wallet.address.toLowerCase();

    try {
        console.log(chalk.cyan(`[Acc ${idx + 1}] 🗳  Processing governance vote...`));

        await syncGovernanceVotes(account, idx);
        await randomSleep();

        const today = new Date().toISOString().split('T')[0];
        const voteCheck = await client.get(
            `/rest/v1/s1_governance_votes?wallet_address=eq.${addr}&created_at=gte.${today}T00:00:00&select=id`
        ).catch(() => ({ data: [] }));

        if (voteCheck.data && voteCheck.data.length >= 5) {
            console.log(chalk.green(`[Acc ${idx + 1}] ✅ Already voted 5 times today`));
            state[idx].govVote = '✅';
            state[idx].nextGovVote = new Date(Date.now() + addJitter(config.govVoteInterval));
            return;
        }

        const roundRes = await client.get('/rest/v1/governance_rounds?select=id,status&status=eq.active&limit=1').catch(() => ({ data: [] }));
        const roundId = roundRes.data?.[0]?.id || 1;

        const poolsRes = await client.get('/rest/v1/governance_pools?select=id&round_id=eq.' + roundId).catch(() => ({ data: [] }));
        const pools = poolsRes.data || [];
        
        if (pools.length === 0) {
            console.log(chalk.yellow(`[Acc ${idx + 1}] No active governance pools found`));
            state[idx].govVote = '⏳';
            state[idx].nextGovVote = new Date(Date.now() + addJitter(60 * 60 * 1000));
            return;
        }

        const vaultContract = new ethers.Contract(VAULT_ADDR, VAULT_ABI, wallet);
        let totalPower = ethers.BigNumber.from(0);
        
        for (const assetIdx of [0, 1]) {
            try {
                const balance = await vaultContract.getUserBalance(wallet.address, assetIdx);
                totalPower = totalPower.add(balance);
            } catch {}
        }

        if (totalPower.isZero()) {
            console.log(chalk.yellow(`[Acc ${idx + 1}] No vault balance for voting`));
            
            for (const [assetIdx, tokenAddr, decimals] of [[0, USDT_ADDR, 18], [1, USDC_ADDR, 6]]) {
                const balance = await getTokenBalance(wallet, tokenAddr);
                if (balance.gt(ethers.utils.parseUnits("10", decimals))) {
                    console.log(chalk.cyan(`[Acc ${idx + 1}] Depositing to vault for voting power...`));
                    await ensureApproval(wallet, tokenAddr, VAULT_ADDR);
                    const vaultContract = new ethers.Contract(VAULT_ADDR, VAULT_ABI, wallet);
                    const depositAmount = balance.div(2);
                    const gasOpts = await getDynamicGasPrice();
                    await vaultContract.deposit(assetIdx, depositAmount, 0, { gasLimit: 500000, ...gasOpts });
                    await sleep(5000);
                    break;
                }
            }
        }

        let votesCast = 0;
        const poolsToVote = pools.slice(0, 5);

        for (const pool of poolsToVote) {
            try {
                const checkVote = await client.get(
                    `/rest/v1/s1_governance_votes?wallet_address=eq.${addr}&pool_id=eq.${pool.id}&limit=1`
                ).catch(() => ({ data: [] }));

                if (checkVote.data && checkVote.data.length > 0) {
                    console.log(chalk.gray(`[Acc ${idx + 1}] Already voted on pool ${pool.id}`));
                    continue;
                }

                const govContract = new ethers.Contract(GOV_ADDR, GOV_ABI, wallet);
                try {
                    await govContract.callStatic.vote(roundId, pool.id, 1);
                } catch (simError) {
                    if (simError.message.includes('already voted')) {
                        console.log(chalk.gray(`[Acc ${idx + 1}] Already voted on pool ${pool.id} (on-chain)`));
                        continue;
                    }
                    if (simError.message.includes('insufficient power')) {
                        console.log(chalk.yellow(`[Acc ${idx + 1}] Insufficient voting power for pool ${pool.id}`));
                        break;
                    }
                    throw simError;
                }

                const gasOpts = await getDynamicGasPrice();
                const tx = await govContract.vote(roundId, pool.id, 1, { gasLimit: 300000, ...gasOpts });
                await tx.wait();
                
                votesCast++;
                console.log(chalk.green(`[Acc ${idx + 1}] ✅ Voted on pool ${pool.id} (${votesCast}/5)`));
                
                await client.post('/functions/v1/verify-onchain-task', 
                    { wallet_address: addr, task_id: 'onchain-vote' }
                ).catch(() => {});

                await randomSleep();

            } catch (e) {
                console.log(chalk.yellow(`[Acc ${idx + 1}] Vote error on pool ${pool.id}: ${e.message?.slice(0, 50)}`));
            }
        }

        if (votesCast > 0) {
            console.log(chalk.green(`[Acc ${idx + 1}] ✅ Governance voting complete: ${votesCast} votes cast`));
            state[idx].govVote = '✅';
            
            const badgeIds = ['first-vote', 'active-voter', 'multi-voter', 'voting-streak'];
            for (const badgeId of badgeIds) {
                try {
                    await client.post('/functions/v1/verify-s1-badge', 
                        { wallet_address: addr, badge_id: badgeId },
                        { headers: { 'x-wallet-address': addr } }
                    );
                } catch {}
                await sleep(300);
            }
        } else {
            console.log(chalk.yellow(`[Acc ${idx + 1}] No votes cast`));
            state[idx].govVote = '⏳';
        }

    } catch (e) {
        console.log(chalk.red(`[Acc ${idx + 1}] Governance vote error: ${e.message?.slice(0, 80)}`));
        state[idx].govVote = '❌';
    }

    state[idx].nextGovVote = new Date(Date.now() + addJitter(config.govVoteInterval));
}

async function claimWebFaucet(wallet, tokenAddress, idx) {
    const ABI = [
        'function claimFaucet() external', 'function canClaim(address) view returns (bool)',
        'function faucetAmount() view returns (uint256)', 'function lastClaim(address) view returns (uint256)',
        'function nextResetTimestamp() view returns (uint256)'
    ];
    return await withRetry(async () => {
        const contract = new ethers.Contract(tokenAddress, ABI, wallet);
        try {
            if (!await contract.canClaim(wallet.address)) {
                console.log(chalk.yellow(`[Acc ${idx + 1}] Faucet cooldown ${tokenAddress.slice(0, 10)}...`));
                try {
                    const nr = await contract.nextResetTimestamp();
                    const rem = nr.toNumber() - Math.floor(Date.now() / 1000);
                    if (rem > 0) console.log(chalk.gray(`[Acc ${idx + 1}] Resets in: ${Math.floor(rem / 3600)}h ${Math.floor((rem % 3600) / 60)}m`));
                } catch {}
                return 'cooldown';
            }
        } catch {}
        const gasOpts = await getDynamicGasPrice();
        const tx = await contract.claimFaucet({ gasLimit: 200000, ...gasOpts });
        const r = await tx.wait();
        console.log(chalk.green(`[Acc ${idx + 1}] ✅ Faucet claimed! TX: ${tx.hash.slice(0, 20)}... Block: ${r.blockNumber}`));
        return true;
    }, idx, 'webFaucet');
}

async function depositVault(wallet, type, idx, amount = 550, isFixed = false) {
    const tokenAddr = type === 1 ? USDC_ADDR : USDT_ADDR;
    const tokenName = type === 1 ? 'tUSDC' : 'tUSDT';
    const decimals  = type === 1 ? 6 : 18;
    const bal = await getTokenBalance(wallet, tokenAddr);
    let depositAmount;
    if (isFixed) {
        depositAmount = ethers.utils.parseUnits(amount.toString(), decimals);
        if (bal.lt(depositAmount)) {
            console.log(chalk.yellow(`[Acc ${idx + 1}] Insufficient ${tokenName}: need ${amount}, have ${ethers.utils.formatUnits(bal, decimals)}`));
            return { success: true, result: 'skip_insufficient' };
        }
    } else {
        const reserve = ethers.utils.parseUnits(amount.toString(), decimals);
        if (bal.lte(reserve)) return { success: true, result: 'skip' };
        depositAmount = bal.sub(reserve);
    }
    console.log(chalk.cyan(`[Acc ${idx + 1}] Depositing ${ethers.utils.formatUnits(depositAmount, decimals)} ${tokenName} to RLP Vault...`));
    return await withRetry(async () => {
        if (!await ensureApproval(wallet, tokenAddr, VAULT_ADDR)) throw new Error('Approval failed');
        const vaultContract = new ethers.Contract(VAULT_ADDR, VAULT_ABI, wallet);
        const gasOpts = await getDynamicGasPrice();
        const tx = await vaultContract.deposit(type, depositAmount, 0, { gasLimit: 500000, ...gasOpts });
        const r = await tx.wait();
        console.log(chalk.green(`[Acc ${idx + 1}] ${tokenName} RLP Vault Deposit! Block: ${r.blockNumber}`));
        return true;
    }, idx, 'dailyTask');
}

async function depositLaaSVault(wallet, assetIdx, idx, amount, isFixed = true) {
    const tokenAddr = assetIdx === 1 ? USDC_ADDR : USDT_ADDR;
    const tokenName = assetIdx === 1 ? 'tUSDC' : 'tUSDT';
    const decimals  = assetIdx === 1 ? 6 : 18;
    const bal = await getTokenBalance(wallet, tokenAddr);
    let depositAmount;
    if (isFixed) {
        depositAmount = ethers.utils.parseUnits(amount.toString(), decimals);
        if (bal.lt(depositAmount)) {
            console.log(chalk.yellow(`[Acc ${idx + 1}] Insufficient ${tokenName} for LaaS`));
            return { success: true, result: 'skip_insufficient' };
        }
    } else { depositAmount = bal; }
    console.log(chalk.cyan(`[Acc ${idx + 1}] Depositing ${ethers.utils.formatUnits(depositAmount, decimals)} ${tokenName} to LaaS Vault...`));
    return await withRetry(async () => {
        if (!await ensureApproval(wallet, tokenAddr, LAAS_VAULT_ADDR)) throw new Error('LaaS Approval failed');
        const laasContract = new ethers.Contract(LAAS_VAULT_ADDR, LAAS_ABI, wallet);
        const gasOpts = await getDynamicGasPrice();
        const tx = await laasContract.deposit(assetIdx, depositAmount, { gasLimit: 500000, ...gasOpts });
        const r = await tx.wait();
        console.log(chalk.green(`[Acc ${idx + 1}] ${tokenName} LaaS Vault Deposit! Block: ${r.blockNumber}`));
        return true;
    }, idx, 'dailyTask');
}

async function claimDiscordFaucet(account, idx) {
    if (!account.discordToken) { state[idx].discordFaucet = '❌NoTkn'; state[idx].nextDiscord = getNextDiscordSchedule(); return false; }
    state[idx].discordFaucet = '🔄'; renderDashboard();
    const client = createDiscordClient(account.discordToken, account.proxy);
    let claimed = 0;
    for (const faucet of config.faucets) {
        try {
            await sleep(antiDetect.interactionDelay());
            const res = await client.get(`https://discord.com/api/v9/channels/${faucet.channelId}/messages?limit=50`);
            if (res.status !== 200) continue;
            const msg = res.data.find(m => m.components?.some(row => row.components?.some(c => c.custom_id === faucet.customId)));
            if (!msg) continue;
            await sleep(antiDetect.interactionDelay());
            const clickRes = await client.post('https://discord.com/api/v9/interactions', {
                type: 3, nonce: ethers.BigNumber.from(Date.now()).mul(1000).toString(),
                guild_id: config.discordGuildId, channel_id: faucet.channelId,
                message_flags: 0, message_id: msg.id, application_id: config.discordAppId,
                session_id: antiDetect.generateSessionId(),
                data: { component_type: 2, custom_id: faucet.customId }
            });
            if (clickRes.status === 204) { claimed++; console.log(chalk.green(`[Acc ${idx + 1}] ✅ Discord ${faucet.name} claimed!`)); }
            else if (clickRes.status === 429) { await sleep((clickRes.data?.retry_after || 60) * 1000); }
        } catch (e) { console.log(chalk.yellow(`[Acc ${idx + 1}] Discord ${faucet.name}: ${e.response?.status === 403 ? 'forbidden' : e.message?.slice(0, 60)}`)); }
        await sleep(2000 + Math.random() * 3000);
    }
    state[idx].discordFaucet = claimed > 0 ? `✅${claimed}/${config.faucets.length}` : '❌';
    state[idx].lastDiscord = Date.now(); state[idx].nextDiscord = getNextDiscordSchedule();
    return claimed > 0;
}

function analyzeQuizQuestion(question, options) {
    const q = (question || '').toLowerCase();
    const opts = (options || []).map(o => (o || '').toLowerCase());
    const patterns = [
        { keywords: ['what does liquidity refer', 'liquidity refer'], answer: opts.findIndex(o => o.includes('easily') && o.includes('bought or sold')) },
        { keywords: ['highly liquid market'], answer: opts.findIndex(o => o.includes('tight') && o.includes('spread')) },
        { keywords: ['defi', 'who', 'provides liquidity', 'typically provides'], answer: opts.findIndex(o => o.includes('regular users') || o.includes('liquidity pools')) },
        { keywords: ['powers trading', 'without', 'order book'], answer: opts.findIndex(o => o.includes('automated market') || o.includes('amm')) },
        { keywords: ['impermanent loss'], answer: opts.findIndex(o => o.includes('temporary') || o.includes('diverge')) },
        { keywords: ['tvl', 'total value locked'], answer: opts.findIndex(o => o.includes('total') && o.includes('locked')) },
        { keywords: ['slippage'], answer: opts.findIndex(o => (o.includes('expected') && o.includes('actual')) || o.includes('difference')) },
        { keywords: ['yield farming'], answer: opts.findIndex(o => (o.includes('earn') && o.includes('reward')) || o.includes('staking')) },
    ];
    for (const p of patterns) { if (p.keywords.some(k => q.includes(k)) && p.answer >= 0) return p.answer; }
    let bestIdx = 0, bestLen = 0;
    opts.forEach((o, i) => { if (o.length > bestLen) { bestLen = o.length; bestIdx = i; } });
    return bestIdx;
}

async function processDailyQuiz(account, idx) {
    state[idx].dailyQuiz = '🔄'; renderDashboard();
    const client = createClient(account.proxy);
    const wallet = new ethers.Wallet(account.privateKey, provider);
    const addr = wallet.address.toLowerCase();
    const today = new Date().toISOString().split('T')[0];

    if (QUIZ_CACHE.date !== today) { QUIZ_CACHE.date = today; QUIZ_CACHE.answers = null; QUIZ_CACHE.quizData = null; QUIZ_CACHE.perfectAnswers = null; }

    try {
        const attempt = await client.get(`/rest/v1/s1_daily_quiz_attempts`, { params: { select: 'score_percent,liq_earned,correct_count,total_questions,answers', wallet_address: `eq.${addr}`, quiz_date: `eq.${today}` } });
        if (attempt.data?.length > 0) {
            const a = attempt.data[0];
            if (a.correct_count === a.total_questions && a.answers) { QUIZ_CACHE.perfectAnswers = a.answers; QUIZ_CACHE.answers = a.answers; }
            state[idx].dailyQuiz = '✅';
            return { success: true, result: 'already_done' };
        }
    } catch {}

    if (!QUIZ_CACHE.quizData) {
        try {
            const r = await client.get('/rest/v1/s1_daily_quiz_content_public', { params: { select: '*', quiz_date: `eq.${today}` } });
            QUIZ_CACHE.quizData = r.data?.[0] || null;
            if (!QUIZ_CACHE.quizData) {
                const fb = await client.get('/rest/v1/s1_daily_quiz_content_public?select=*&order=created_at.desc&limit=1');
                QUIZ_CACHE.quizData = fb.data?.[0] || null;
            }
        } catch {}
    }

    if (!QUIZ_CACHE.quizData?.questions) { state[idx].dailyQuiz = '❌'; return { success: false }; }
    const questions = QUIZ_CACHE.quizData.questions;
    let answers = [];

    if (QUIZ_CACHE.perfectAnswers) {
        answers = QUIZ_CACHE.perfectAnswers;
        console.log(chalk.green(`[Acc ${idx + 1}] 🏆 Using PERFECT cached answers: [${answers}]`));
    } else if (QUIZ_CACHE.answers) {
        answers = QUIZ_CACHE.answers;
    } else {
        for (const [qI, qi] of questions.entries()) {
            const opts = qi.options || [];
            console.log(chalk.cyan(`[Acc ${idx + 1}] Q${qI + 1}: ${qi.question}`));
            let ans;
            if (groqClient) {
                try {
                    const comp = await groqClient.chat.completions.create({
                        model: config.groqModel, temperature: 0.1, max_tokens: 5,
                        messages: [
                            { role: "system", content: "Answer DeFi quiz. Return ONLY the option number (0-3). No explanation." },
                            { role: "user", content: `Question: ${qi.question}\nOptions:\n${opts.map((o, i) => `${i}: ${o}`).join('\n')}\nReturn only the number.` }
                        ]
                    });
                    ans = parseInt(comp.choices[0].message.content.trim());
                    if (isNaN(ans) || ans < 0 || ans >= opts.length) ans = analyzeQuizQuestion(qi.question, opts);
                } catch { ans = analyzeQuizQuestion(qi.question, opts); }
            } else { ans = analyzeQuizQuestion(qi.question, opts); }
            answers.push(ans);
            await sleep(2000);
        }
        QUIZ_CACHE.answers = answers;
    }

    try {
        const res = await client.post('/functions/v1/submit-s1-quiz',
            { wallet_address: addr, answers },
            { headers: { 'x-wallet-address': addr } }
        );
        if (res.data?.correct_count === res.data?.total_questions) { QUIZ_CACHE.perfectAnswers = answers; }
        state[idx].dailyQuiz = (res.data?.correct_count > 0) ? '✅' : '❌';
        if (res.data?.correct_count > 0) console.log(chalk.green(`[Acc ${idx + 1}] ✅ Quiz ${res.data.correct_count}/${res.data.total_questions} (+${res.data.liq_earned} LIQ)`));
        return { success: res.data?.correct_count > 0 };
    } catch (e) {
        const msg = e.response?.data?.message || e.message || '';
        if (msg.includes('already') || e.response?.status === 400) { state[idx].dailyQuiz = '✅'; return { success: true, result: 'already_done' }; }
        state[idx].dailyQuiz = '❌'; return { success: false };
    }
}

async function processDailyTasks(account, idx) {
    state[idx].dailyTask = '🔄'; state[idx].webFaucet = '🔄'; renderDashboard();
    const wallet = new ethers.Wallet(account.privateKey, provider);
    const client = createClient(account.proxy);
    const addr = wallet.address.toLowerCase();

    try {
        const [profileRes, streakRes] = await Promise.all([
            client.get(`/rest/v1/user_profiles_public?select=total_liq_earned,s1_liq_earned&wallet_address=eq.${addr}`),
            client.get(`/rest/v1/s1_checkins?select=checkin_date&wallet_address=eq.${addr}&order=checkin_date.desc&limit=50`)
        ]);
        if (profileRes.data?.[0]) state[idx].points = profileRes.data[0].s1_liq_earned || 0;
        if (streakRes.data?.length > 0) {
            let streak = 1;
            const dates = streakRes.data.map(d => d.checkin_date);
            for (let i = 1; i < dates.length; i++) {
                if ((new Date(dates[i - 1]) - new Date(dates[i])) / 86400000 === 1) streak++; else break;
            }
            state[idx].streak = streak;
        }
    } catch {}
    renderDashboard();

    await simulateActivity(client, wallet, idx);
    await randomSleep();

    console.log(chalk.cyan(`\n[Acc ${idx + 1}] 💧 Web Faucets:`));
    const [ur, ut] = await Promise.all([claimWebFaucet(wallet, USDC_ADDR, idx), claimWebFaucet(wallet, USDT_ADDR, idx)]);
    state[idx].webFaucet = (ur.success || ut.success) ? '✅' : '⏳CD';
    renderDashboard(); await randomSleep();

    console.log(chalk.cyan(`\n[Acc ${idx + 1}] 📅 Daily Check-in:`));
    const checkinResult = await withRetry(async () => {
        const res = await client.post('/functions/v1/s1-checkin', {}, { headers: { 'x-wallet-address': addr } });
        if (res.data?.success || res.data?.checkin_date || res.data?.liq_awarded || res.data?.already_checked_in ||
            res.data?.message?.includes('already') || res.data?.error?.includes('already')) return true;
        throw new Error(res.data?.message || res.data?.error || 'Check-in failed');
    }, idx, 'dailyTask');
    await randomSleep();

    const usdcBal = await getTokenBalance(wallet, USDC_ADDR);
    const usdtBal = await getTokenBalance(wallet, USDT_ADDR);
    console.log(chalk.gray(`[Acc ${idx + 1}] tUSDC: ${ethers.utils.formatUnits(usdcBal, 6)} | tUSDT: ${ethers.utils.formatUnits(usdtBal, 18)}`));

    console.log(chalk.cyan(`\n[Acc ${idx + 1}] 🏦 Auto Vault Withdraw:`));
    await autoWithdrawVault(wallet, idx); await randomSleep();

    console.log(chalk.cyan(`\n[Acc ${idx + 1}] 🏦 RLP Vault Deposits:`));
    const udRes = await depositVault(wallet, 1, idx, 1000, true);
    if (udRes.success && udRes.result !== 'skip_insufficient') {
        await sleep(5000);
        await withRetry(async () => { const r = await client.post('/functions/v1/verify-deposit-task', { wallet_address: addr, task_id: 'daily-deposit-tusdc-1000', token_type: 'tusdc' }); if (r.data?.verified || r.data?.success || r.data?.message?.includes('already')) return true; throw new Error('USDC verify failed'); }, idx, 'dailyTask');
    }
    await randomSleep();
    const utRes = await depositVault(wallet, 0, idx, 1000, true);
    if (utRes.success && utRes.result !== 'skip_insufficient') {
        await sleep(5000);
        await withRetry(async () => { const r = await client.post('/functions/v1/verify-deposit-task', { wallet_address: addr, task_id: 'daily-deposit-tusdt-1000', token_type: 'tusdt' }); if (r.data?.verified || r.data?.success || r.data?.message?.includes('already')) return true; throw new Error('USDT verify failed'); }, idx, 'dailyTask');
    }
    await randomSleep();

    console.log(chalk.cyan(`\n[Acc ${idx + 1}] 🏛️ LaaS Vault Deposits:`));
    const luRes = await depositLaaSVault(wallet, 1, idx, 500, true);
    if (luRes.success && luRes.result !== 'skip_insufficient') {
        await sleep(5000);
        await withRetry(async () => { const r = await client.post('/functions/v1/verify-deposit-task', { wallet_address: addr, task_id: 'daily-laas-deposit-tusdc', token_type: 'tusdc' }); if (r.data?.verified || r.data?.success || r.data?.message?.includes('already')) return true; throw new Error('LaaS USDC verify failed'); }, idx, 'dailyTask');
    }
    await randomSleep();
    const ltRes = await depositLaaSVault(wallet, 0, idx, 500, true);
    if (ltRes.success && ltRes.result !== 'skip_insufficient') {
        await sleep(5000);
        await withRetry(async () => { const r = await client.post('/functions/v1/verify-deposit-task', { wallet_address: addr, task_id: 'daily-laas-deposit-tusdt', token_type: 'tusdt' }); if (r.data?.verified || r.data?.success || r.data?.message?.includes('already')) return true; throw new Error('LaaS USDT verify failed'); }, idx, 'dailyTask');
    }
    await randomSleep();

    await withRetry(async () => { const r = await client.post('/functions/v1/verify-onchain-task', { wallet_address: addr, task_id: 'daily-duel-create' }); return r.data?.verified; }, idx, 'dailyTask');
    await randomSleep();

    console.log(chalk.cyan(`\n[Acc ${idx + 1}] 🎁 Auto Claim Rewards:`));
    await autoClaimAllRewards(wallet, idx, client); await randomSleep();

    await processDailyQuiz(account, idx); await randomSleep();

    await verifyDiscordLink(account, idx); await randomSleep();

    await processReferral(account, idx); await randomSleep();

    const vaultBadges = ['first-deposit', 'vault-guardian', 'laas-initiate', 'duel-creator', 'quiz-starter', 'week-warrior'];
    for (const badgeId of vaultBadges) {
        try {
            await client.post('/functions/v1/verify-s1-badge', { wallet_address: addr, badge_id: badgeId }, { headers: { 'x-wallet-address': addr } });
        } catch {}
        await sleep(300);
    }

    await updateLeaderboardRank(account, idx);
    await fetchWavePoints(account, idx); await randomSleep();
    await fetchLiqRewardLog(account, idx);

    try {
        const [p2, s2] = await Promise.all([
            client.get(`/rest/v1/user_profiles_public?select=total_liq_earned,s1_liq_earned&wallet_address=eq.${addr}`),
            client.get(`/rest/v1/s1_checkins?select=checkin_date&wallet_address=eq.${addr}&order=checkin_date.desc&limit=50`)
        ]);
        if (p2.data?.[0]) state[idx].points = p2.data[0].s1_liq_earned || 0;
        if (s2.data?.length > 0) {
            let streak = 1;
            const dates = s2.data.map(d => d.checkin_date);
            for (let i = 1; i < dates.length; i++) {
                if ((new Date(dates[i - 1]) - new Date(dates[i])) / 86400000 === 1) streak++; else break;
            }
            state[idx].streak = streak;
        }
    } catch {}

    state[idx].dailyTask = checkinResult.success ? '✅' : '❌';
    state[idx].lastDaily = Date.now(); state[idx].nextDaily = getNextDailySchedule();
}

async function getOpenDuels(wallet) {
    try {
        const c = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
        return (await c.getOpenDuels())
            .filter(d => d.challenger.toLowerCase() !== wallet.address.toLowerCase())
            .map(d => ({ id: d.id.toNumber(), challenger: d.challenger, wagerAmount: d.wagerAmount, wagerToken: d.wagerToken }));
    } catch { return []; }
}

async function getDuelById(wallet, duelId) {
    try {
        const c = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
        const duel = await c.getDuel(duelId);
        if (!duel.challenger || duel.challenger === ethers.constants.AddressZero) return null;
        return { id: duel.id.toNumber(), challenger: duel.challenger, opponent: duel.opponent, wagerAmount: duel.wagerAmount, wagerToken: duel.wagerToken, status: duel.status, winner: duel.winner, prizeClaimed: duel.prizeClaimed, createdAt: duel.createdAt };
    } catch { return null; }
}

async function processDuel(account, idx) {
    state[idx].duelStatus = '🔄'; renderDashboard();
    const wallet = new ethers.Wallet(account.privateKey, provider);
    const client = createClient(account.proxy);
    const addr = wallet.address.toLowerCase();

    if (account.duelEnabled === false) { state[idx].duelStatus = '⛔Off'; state[idx].nextDuel = getNextDiscordSchedule(); return; }

    const now = Date.now(), today = new Date().setHours(0, 0, 0, 0);
    state[idx].duelHistory = state[idx].duelHistory.filter(h => h.timestamp > today);
    state[idx].dailyDuelCount = state[idx].duelHistory.length;

    if (state[idx].dailyDuelCount >= DAILY_DUEL_LIMIT) { state[idx].duelStatus = '✅Limit'; state[idx].nextDuel = getNextDailySchedule(); return; }
    if (state[idx].duelHistory.filter(h => now - h.timestamp < RATE_LIMIT_WINDOW).length >= RATE_LIMIT_DUELS) { state[idx].duelStatus = '⏳Rate'; state[idx].nextDuel = new Date(Date.now() + RATE_LIMIT_WINDOW); return; }

    await resolveExpiredDuels(account, idx); await randomSleep();

    await autoClaimAllRewards(wallet, idx, client); await randomSleep();

    console.log(chalk.cyan(`[Acc ${idx + 1}] ⚔️ Duel: Try Join 3x → Fallback Create`));

    let duelCompleted = false, joinAttempts = 0;
    const openDuels = await getOpenDuels(wallet);

    if (config.autoDuelMatch && accounts.length > 1) {
        const peers = getRotatedWalletOrder().filter(i => i !== idx).slice(0, 3);
        for (const peerIdx of peers) {
            try {
                const peerW = new ethers.Wallet(accounts[peerIdx].privateKey, provider);
                for (const pd of await getOpenDuels(peerW)) {
                    if (!openDuels.find(d => d.id === pd.id)) openDuels.push(pd);
                }
            } catch {}
        }
    }
    openDuels.sort((a, b) => {
        const da = a.wagerToken.toLowerCase() === USDC_ADDR.toLowerCase() ? 6 : 18;
        const db = b.wagerToken.toLowerCase() === USDC_ADDR.toLowerCase() ? 6 : 18;
        return parseFloat(ethers.utils.formatUnits(a.wagerAmount, da)) - parseFloat(ethers.utils.formatUnits(b.wagerAmount, db));
    });

    for (const duel of openDuels) {
        if (duelCompleted || joinAttempts >= 3) break;
        const isUSDC = duel.wagerToken.toLowerCase() === USDC_ADDR.toLowerCase();
        const tokenAddr = isUSDC ? USDC_ADDR : USDT_ADDR, decimals = isUSDC ? 6 : 18;
        const amount = parseFloat(ethers.utils.formatUnits(duel.wagerAmount, decimals));
        if (amount > 2000) continue;
        if ((await getTokenBalance(wallet, tokenAddr)).lt(duel.wagerAmount)) continue;
        if (state[idx].duelHistory.filter(h => h.opponent?.toLowerCase() === duel.challenger.toLowerCase()).length >= SAME_OPPONENT_LIMIT) continue;

        joinAttempts++;
        const result = await withRetry(async () => {
            if (!await ensureApproval(wallet, tokenAddr, DUEL_ADDR)) throw new Error('Approval failed');
            const contract = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
            try { await contract.callStatic.acceptDuel(duel.id); } catch { return false; }
            const gasOpts = await getDynamicGasPrice();
            const data = new ethers.utils.Interface(DUEL_ABI).encodeFunctionData('acceptDuel', [duel.id]);
            const tx = await wallet.sendTransaction({ to: DUEL_ADDR, data, gasLimit: 1000000, ...gasOpts });
            await tx.wait(); return true;
        }, idx, 'duelStatus');

        if (result.success && result.result === true) {
            duelCompleted = true;
            state[idx].duelHistory.push({ timestamp: now, opponent: duel.challenger, amount });
            console.log(chalk.green(`[Acc ${idx + 1}] ✅ Duel #${duel.id} accepted!`));
            await setDuelAcceptedAt(account, idx, duel.id);
        }
    }

    if (!duelCompleted) {
        const useUSDC = Math.random() < 0.5, tokenAddr = useUSDC ? USDC_ADDR : USDT_ADDR, decimals = useUSDC ? 6 : 18;
        const balance = await getTokenBalance(wallet, tokenAddr);
        if (balance.gte(ethers.utils.parseUnits("10", decimals))) {
            for (let attempt = 1; attempt <= 3 && !duelCompleted; attempt++) {
                const rawAmt = randomDelay(10, 100);
                const wagerAmount = ethers.utils.parseUnits(rawAmt.toString(), decimals);
                const result = await withRetry(async () => {
                    if (!await ensureApproval(wallet, tokenAddr, DUEL_ADDR)) throw new Error('Approval failed');
                    const contract = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
                    try { await contract.callStatic.createDuel(wagerAmount, tokenAddr, 0); }
                    catch { return 'SIMULATION_FAILED'; }
                    const gasOpts = await getDynamicGasPrice();
                    const data = new ethers.utils.Interface(DUEL_ABI).encodeFunctionData('createDuel', [wagerAmount, tokenAddr, 0]);
                    const tx = await wallet.sendTransaction({ to: DUEL_ADDR, data, gasLimit: 1000000, ...gasOpts });
                    await tx.wait(); return true;
                }, idx, 'duelStatus');
                if (result === 'SIMULATION_FAILED') { state[idx].duelStatus = '✅Limit'; break; }
                if (result?.success && result.result === true) { duelCompleted = true; state[idx].duelHistory.push({ timestamp: now, opponent: 'unknown_created', amount: rawAmt }); }
                else await sleep(3000);
            }
        }
    }

    if (!duelCompleted) { state[idx].duelFailures++; state[idx].duelStatus = '❌Fail'; state[idx].nextDuel = new Date(Date.now() + addJitter(4 * 60 * 60 * 1000)); return; }

    const reserve = randomDelay(100, 500);
    await depositVault(wallet, 1, idx, reserve);
    await depositVault(wallet, 0, idx, reserve);
    await withRetry(async () => { const r = await client.post('/functions/v1/verify-onchain-task', { wallet_address: addr, task_id: 'daily-duelist' }); return r.data?.verified; }, idx, 'duelStatus');

    for (const badgeId of ['duel-creator', 'duel-acceptor', 'duel-master', 'winning-streak']) {
        try { await client.post('/functions/v1/verify-s1-badge', { wallet_address: addr, badge_id: badgeId }, { headers: { 'x-wallet-address': addr } }); } catch {}
        await sleep(300);
    }

    state[idx].duelStatus = '✅'; state[idx].lastDuel = now; state[idx].nextDuel = new Date(now + randomDelay(10000, 30000));
}

async function syncDailyStats(account, idx) {
    state[idx].duelStatus = '🔄Sync'; renderDashboard();
    const wallet = new ethers.Wallet(account.privateKey, provider);
    const today = new Date().setHours(0, 0, 0, 0);
    try {
        const contract = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
        const ids = await contract.getUserDuels(wallet.address);
        const history = [];
        for (const idBN of ids.slice(-20)) {
            const duel = await getDuelById(wallet, idBN.toNumber());
            if (duel && duel.createdAt * 1000 > today) {
                const isUSDC = duel.wagerToken.toLowerCase() === USDC_ADDR.toLowerCase();
                const decimals = isUSDC ? 6 : 18;
                history.push({ timestamp: duel.createdAt * 1000, opponent: duel.opponent.toLowerCase() === wallet.address.toLowerCase() ? duel.challenger : duel.opponent, amount: parseFloat(ethers.utils.formatUnits(duel.wagerAmount, decimals)) });
            }
        }
        state[idx].duelHistory = history; state[idx].dailyDuelCount = history.length;
        state[idx].duelStatus = state[idx].dailyDuelCount >= DAILY_DUEL_LIMIT ? '✅Limit' : '⏳';
        if (state[idx].duelStatus.startsWith('✅')) state[idx].nextDuel = getNextDailySchedule();
        console.log(chalk.blue(`[Acc ${idx + 1}] 🔄 Synced: ${state[idx].dailyDuelCount} duels`));
    } catch (e) { console.log(chalk.red(`[Acc ${idx + 1}] ❌ Sync Failed: ${e.message}`)); }
}

async function main() {
    const startOrder = getRotatedWalletOrder();
    accounts.forEach((_, i) => {
        state[i] = createState(i);
        state[i].nextDaily       = new Date(Date.now() - 60000);
        state[i].nextDuel        = new Date(Date.now() + randomDelay(5000, 30000));
        state[i].nextDiscord     = new Date(Date.now() + randomDelay(5000, 30000));
        state[i].nextFlowWars    = new Date(Date.now() + randomDelay(2 * 60000, 10 * 60000));
        state[i].nextBadgeVerify = new Date(Date.now() + randomDelay(3 * 60000, 15 * 60000));
        state[i].nextCapsuleCheck= new Date(Date.now() + randomDelay(5 * 60000, 20 * 60000));
        state[i].nextLeaderboard = new Date(Date.now() + randomDelay(60000, 5 * 60000));
        state[i].nextGovVote     = new Date(Date.now() + randomDelay(2 * 60000, 10 * 60000));
    });

    renderDashboard();
    console.log(chalk.yellow('⚡ Initial RPC health check...'));
    await monitorRpcHealth();

    console.log(chalk.yellow('🔄 Syncing daily stats...'));
    for (const i of startOrder) await syncDailyStats(accounts[i], i);
    console.log(chalk.green('✅ Sync complete. Starting main loop...'));
    await sleep(2000);

    setInterval(async () => { try { await monitorRpcHealth(); } catch {} }, config.rpcPingInterval);

    renderDashboard();
    let loop = 0;

    while (true) {
        loop++;
        const now = Date.now();
        const order = loop % 10 === 0 ? getRotatedWalletOrder() : [...Array(accounts.length).keys()];

        for (const i of order) {
            const acc = accounts[i], s = state[i];
            if (s.isProcessing) continue;

            if (s.nextDaily && now >= s.nextDaily.getTime()) {
                s.isProcessing = true;
                try { await processDailyTasks(acc, i); }
                catch (e) { logError(i, `Daily: ${e.message?.slice(0, 50)}`); s.dailyTask = '❌'; }
                s.isProcessing = false; s.nextDaily = getNextDailySchedule(); renderDashboard();
            }

            const discordDue = s.lastDiscord === 0 || now - s.lastDiscord >= config.discordInterval;
            if (acc.discordToken && discordDue && !s.isProcessing) {
                s.isProcessing = true;
                try { await claimDiscordFaucet(acc, i); }
                catch (e) { logError(i, `Discord: ${e.message?.slice(0, 50)}`); s.discordFaucet = '❌'; }
                s.isProcessing = false; renderDashboard();
            }

            if (s.nextDuel && now >= s.nextDuel.getTime() && !s.isProcessing) {
                s.isProcessing = true;
                try { await processDuel(acc, i); }
                catch (e) { logError(i, `Duel: ${e.message?.slice(0, 50)}`); s.duelStatus = '❌'; }
                s.isProcessing = false; renderDashboard();
            }

            if (config.flowWars && s.nextFlowWars && now >= s.nextFlowWars.getTime() && !s.isProcessing) {
                s.isProcessing = true;
                try { await processFlowWars(acc, i); }
                catch (e) { logError(i, `FlowWars: ${e.message?.slice(0, 50)}`); s.flowWarsStatus = '❌'; }
                s.isProcessing = false; renderDashboard();
            }

            if (config.badgeAutoVerify && s.nextBadgeVerify && now >= s.nextBadgeVerify.getTime() && !s.isProcessing) {
                s.isProcessing = true;
                try { await autoBadgeVerify(acc, i); }
                catch (e) { logError(i, `BadgeVerify: ${e.message?.slice(0, 50)}`); s.badgeStatus = '❌'; s.nextBadgeVerify = new Date(now + addJitter(config.badgeVerifyInterval)); }
                s.isProcessing = false; renderDashboard();
            }

            if (config.capsuleClaim && s.nextCapsuleCheck && now >= s.nextCapsuleCheck.getTime() && !s.isProcessing) {
                s.isProcessing = true;
                try { await processCapsuleClaim(acc, i); }
                catch (e) { logError(i, `Capsule: ${e.message?.slice(0, 50)}`); s.capsuleStatus = '❌'; s.nextCapsuleCheck = new Date(now + addJitter(config.capsuleCheckInterval)); }
                s.isProcessing = false; renderDashboard();
            }

            if (config.leaderboardTrack && s.nextLeaderboard && now >= s.nextLeaderboard.getTime() && !s.isProcessing) {
                s.isProcessing = true;
                try { await updateLeaderboardRank(acc, i); }
                catch {}
                s.isProcessing = false; renderDashboard();
            }

            if (config.govVote && s.nextGovVote && now >= s.nextGovVote.getTime() && !s.isProcessing) {
                s.isProcessing = true;
                try { await processGovernanceVote(acc, i); }
                catch (e) { logError(i, `GovVote: ${e.message?.slice(0, 50)}`); s.govVote = '❌'; s.nextGovVote = new Date(now + addJitter(config.govVoteInterval)); }
                s.isProcessing = false; renderDashboard();
            }
        }

        renderDashboard();
        await sleep(1000);
    }
}

process.on('SIGINT', () => { clearScreen(); console.log(chalk.yellow('\n👋 Bot stopped. Goodbye!')); process.exit(0); });
main().catch(e => { console.error(chalk.red('Fatal error:'), e); process.exit(1); });
