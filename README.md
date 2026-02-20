# 🔷 Liquicore Auto Bot

> Automated bot for [Liquicore Finance](https://liquicore.finance?ref=FB239416) — handles daily tasks, faucet claims, vault deposits, and duels across multiple accounts.

**By [mejri02](https://github.com/mejri02) | File: `index.js` | Repo: `Liquicore-Auto-Bot`**

---

## 🔗 Register First

> 👉 **[https://liquicore.finance?ref=FB239416](https://liquicore.finance?ref=FB239416)**

Register using the referral link above before getting started.

---

## ✨ Features

- 📅 **Daily Tasks** — Auto check-in, deposit verification for RLP Vault & LaaS Vault
- 🌐 **Web Faucet** — Auto-claim tUSDC and tUSDT testnet tokens
- 💬 **Discord Faucet** — Auto-click faucet buttons in Discord channels every 30 minutes
- ❓ **Daily Quiz** — Smart answer system with shared memory across all accounts
- ⚔️ **Duel System** — Join open duels or create new ones with fallback logic (1 duel/day limit)
- 🏦 **Vault Deposits** — RLP Vault (1000 tUSDC / 1000 tUSDT) + LaaS Vault (500 tUSDC / 500 tUSDT)
- 🔄 **Multi-Account** — Manage unlimited accounts from `accounts.json`
- 🛡️ **Anti-Detection** — Random delays, rotating user agents, session ID spoofing
- 🔁 **RPC Rotation** — Automatically rotates BSC Testnet RPC on failures
- 📊 **Live Dashboard** — Real-time terminal UI with status per account

---

## 📋 Requirements

- Node.js v18+

---

## 📥 Installation

```bash
git clone https://github.com/mejri02/Liquicore-Auto-Bot.git
cd Liquicore-Auto-Bot
npm install
```

---

## 📁 File Structure

```
Liquicore-Auto-Bot/
├── index.js          # Main bot file
├── accounts.json     # Account configuration (see below)
└── README.md
```

---

## ⚙️ Configuration

Create an `accounts.json` file in the same directory as `index.js`:

```json
[
  {
    "privateKey": "0xYOUR_PRIVATE_KEY",
    "discordToken": "YOUR_DISCORD_TOKEN",
    "proxy": "http://user:pass@host:port",
    "duelEnabled": true
  },
  {
    "privateKey": "0xSECOND_PRIVATE_KEY",
    "discordToken": "SECOND_DISCORD_TOKEN",
    "proxy": null,
    "duelEnabled": true
  }
]
```

| Field | Required | Description |
|---|---|---|
| `privateKey` | ✅ | EVM wallet private key (BSC Testnet) |
| `discordToken` | ⚠️ Optional | Discord user token for faucet claims |
| `proxy` | ⚠️ Optional | HTTP/HTTPS proxy URL (`null` to disable) |
| `duelEnabled` | ⚠️ Optional | Set to `false` to disable duels for this account |

---

## 🚀 Usage

```bash
node index.js
```

The bot will:
1. Load all accounts from `accounts.json`
2. Sync current duel history from the blockchain
3. Launch the live dashboard
4. Run all tasks automatically on schedule

**Stop the bot:** Press `Ctrl+C`

---

## ⏰ Schedule

| Task | Frequency |
|---|---|
| Daily Tasks (check-in, deposits, quiz) | Once daily at 21:00 |
| Discord Faucet | Every 30 minutes |
| Duels | Every 5 hours (or next day if limit reached) |

---

## 📊 Dashboard

The live terminal dashboard shows per-account status:

| Icon | Meaning |
|---|---|
| ✅ | Task completed successfully |
| ❌ | Task failed |
| 🔄 | Task in progress |
| ⏳ | Waiting / not yet run |
| ✅Limit | Daily limit reached |

---

## 🔗 Contract Addresses (BSC Testnet)

| Contract | Address |
|---|---|
| tUSDC | `0xe4da02B0188D98A10244c1bD265Ea0aF36be205a` |
| tUSDT | `0x29565d182bF1796a3836a68D22D833d92795725A` |
| RLP Vault | `0x11e4e6cD5D9E60646219098d99CfaFd130cdcE93` |
| LaaS Vault | `0x4FC31E7199ccC0e756c640D65c418d62c1898D12` |
| Duel | `0xe85a13581bFa506F4A1E903312E13842f1863c1f` |

---

## ⚠️ Disclaimer

This bot is for educational and personal use only. Use at your own risk. The author is not responsible for any loss of funds or account bans. Never use this with real funds on mainnet.

---

## 🙏 Credits

- **Author:** [mejri02](https://github.com/mejri02)
- **Platform:** [Liquicore Finance](https://liquicore.finance?ref=FB239416)
- **Network:** BSC Testnet

