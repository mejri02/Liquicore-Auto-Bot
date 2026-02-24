# 🔷 Liquicore Auto Bot

> Automated bot for [Liquicore Finance](https://liquicore.finance?ref=FB239416) — handles daily tasks, faucet claims, vault deposits, and duels across multiple accounts.

---

## 🔗 Register First

> 👉 **[https://liquicore.finance?ref=FB239416](https://liquicore.finance?ref=FB239416)**

Register using the referral link above before getting started.

---

## ✨ Features

- 📅 **Daily Tasks** — Auto check-in, deposit verification for RLP Vault & LaaS Vault
- 🌐 **Web Faucet** — Auto-claim tUSDC and tUSDT testnet tokens
- 💬 **Discord Faucet** — Auto-click faucet buttons (BNB, USDC, USDT) in Discord channels every 30 minutes
- ❓ **Daily Quiz** — AI-powered answers via Groq (llama-3.3-70b) with shared answer memory across accounts
- ⚔️ **Duel System** — Try to join open duels (up to 3 attempts), fallback to creating new ones (1 duel/day limit)
- 🏦 **Vault Deposits** — RLP Vault (1000 tUSDC / 1000 tUSDT) + LaaS Vault (500 tUSDC / 500 tUSDT)
- 🗳️ **Governance Voting** — Auto-vote up to 5 times per day across random pools
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
├── config.json       # Optional: Groq API key and overrides
└── README.md
```

---

## ⚙️ Configuration

### `accounts.json`

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

### `config.json` (Optional)

To enable Groq AI for the daily quiz, create a `config.json`:

```json
{
  "grokApiKey": "YOUR_GROQ_API_KEY"
}
```

Without this file the bot runs normally but will fall back to a default answer (`1`) for quiz questions.

---

## 🚀 Usage

```bash
node index.js
```

The bot will:
1. Load all accounts from `accounts.json`
2. Initialize Groq AI (if API key is configured)
3. Sync current duel history from the blockchain
4. Launch the live dashboard
5. Run all tasks automatically on schedule

**Stop the bot:** Press `Ctrl+C`

---

## ⏰ Schedule

| Task | Frequency |
|---|---|
| Daily Tasks (check-in, deposits, quiz, governance) | Once daily at 08:00 (WIB) |
| Discord Faucet | Every 30 minutes |
| Duels | Next run scheduled after each attempt; resets daily |

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
| ⛔ Off | Feature disabled for this account |

---

## 🔗 Contract Addresses (BSC Testnet — S1 Season)

| Contract | Address |
|---|---|
| S1-tUSDC (6 decimals) | `0xaD88B079712CC38a8D33E072CB6434E652556441` |
| S1-tUSDT (18 decimals) | `0x5c0d9bb86b99168Aa8A36fad84d068d258c259a5` |
| S1 RLP Vault | `0xC044428E4f0b46C9897730fc9137806Ed8deBB9d` |
| S1 LaaS Vault | `0xB8332cfE7DddD45CEcAADA6C0e564b09AbBb5744` |
| S1 Duel | `0xFbB6a304e361AE93B33A87a3700CC1CF1b2bAc8c` |
| S1 Governance | `0xd53868E4b0c16ED332f37f005d4851D3EB547deB` |

---

## ⚠️ Disclaimer

This bot is for educational and personal use only. Use at your own risk. The author is not responsible for any loss of funds or account bans. Never use this with real funds on mainnet.

---

## 🙏 Credits

- **Author:** [mejri02](https://github.com/mejri02)
- **Platform:** [Liquicore Finance](https://liquicore.finance?ref=FB239416)
- **Network:** BSC Testnet
