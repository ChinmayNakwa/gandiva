# Gandiva: Technical Details

The deeper parts of the project. For the overview and live links, see the [README](../README.md).

- [Local setup in detail](#local-setup-in-detail)
- [Verify the claims](#verify-the-claims)
- [Credibility without KYC](#credibility-without-kyc)
- [Seller comparison](#seller-comparison-why-one-seller-is-picked)
- [Priority scheduling for simultaneous payments](#priority-scheduling-for-simultaneous-payments)
- [Deploying (Render API + Vercel UI)](#deploying-render-api--vercel-ui)

## Local setup in detail

**Requirements:** Node.js 20+, a tunnel ([ngrok](https://ngrok.com/download) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)), and an LLM via [Ollama](https://ollama.com) (local `ollama pull qwen2.5:7b`, or Ollama cloud with `OLLAMA_API_KEY`).

```bash
# 1. Install
npm install
cd client && npm install && cd ..

# 2. Configure
cp .env.example .env          # add NGROK_AUTHTOKEN and your Ollama settings
npm run wallets:new           # generates testnet wallets into .env

# 3. Fund the buyer wallet with testnet USDC (no ETH needed)
#    https://faucet.circle.com  ->  Base Sepolia

# 4. Start everything (tunnel + API + web app)
npm start
```

Open the public URL printed in the terminal (or `http://localhost:3000` with `TUNNEL=none`), go to **/run**, and try:

> *From pages 1 to 4 of books.toscrape.com, find the three cheapest 5-star books, give their prices in rupees, and summarise each description in Hindi.* Budget: `0.05`

Or from the CLI:

```bash
npm run task -- "<task>" 0.05 3     # task, budget in USDC, max_concurrency
```

> ⚠️ Testnet only. Never put mainnet keys in `.env`.

## Verify the claims

| Command | What it checks |
|---|---|
| `npm test` | 300+ offline unit tests (no network, no money) |
| `npm run reconcile` | Paid ledger rows equal the USDC transfers out of the buyer wallet, to the unit |
| `npm run judge:budget` | A too-small budget is never exceeded, at concurrency 1 and 5 |
| `npm run judge:price` | A 402 asking more than listed, or naming another payTo, is refused |
| `npm run judge:replay` | One signed payment unlocks one response, serial or 5x parallel |
| `npm run judge:failure` | A seller that fails is not paid |
| `npm run judge:junk` | Schema-breaking output is recorded "paid, output rejected" and the seller loses reputation |
| `npm run judge:interop` | Our buyer pays an unmodified `@x402/express` seller |

## Credibility without KYC

Each listing gets a score out of 100 from proofs a seller can give with code, keys or money, never identity documents. `GET /registry/services/:id/credibility` returns the breakdown.

| Check | Points | How it is proven |
|---|---|---|
| x402 conformance | 20 | A live probe of the endpoint returns a 402 that matches the listing |
| Controls its payout wallet | 15 | A signature from the payTo key: `POST /registry/services/:id/proof` or a wallet sign-in on the Sell tab |
| Track record | 25 | Valid-output rate from the buyer's ledger; full credit from 10 calls |
| Stake | 20 | Reserved for USDC bonded behind a listing; staking is not enabled on the live deploy, so this scores 0 there |
| On-chain wallet history | 10 | The payTo has sent transactions or holds USDC on Base Sepolia |
| HTTPS | 5 | The endpoint uses TLS |
| Listing age | 5 | Listed for at least an hour |

Credibility breaks ties in ranking: after reputation and price, before latency. The built-in sellers' proofs are signed at boot with their keys from `.env`.

## Seller comparison: why one seller is picked

On the Marketplace, **Compare** on any card opens a dashboard of the sellers the buyer treats as substitutes for that job (same input and output schema). It shows:

- the ranking ladder, with the rule that decided each step (402 check, reputation, price, credibility or latency);
- a radar chart of every parameter (reputation, success rate, cheapness, speed, credibility, stake);
- per-parameter bars across all candidates;
- the last calls to each seller (latency and outcome);
- the selected seller's credibility checks.

The API is `GET /registry/compare?category=data&selected=fx-rates`. The explanation code follows `rankCompare` step by step, and a unit test keeps the two in sync.

## Priority scheduling for simultaneous payments

All paid calls go through one scheduler (`src/x402/scheduler.ts`):

- **Limits:** at most 5 run at once per paying wallet (`PAY_SLOTS_PER_WALLET`) and 4 per seller (`PAY_SLOTS_PER_SELLER`).
- **Choosing who goes next:** when more calls want to start, the highest priority goes first. Priority is a weighted sum:
  - 0.30 for a settlement retry (money is already in motion);
  - 0.25 for time waited (ageing, so nothing starves);
  - 0.20 for run progress (the share of its budget already spent);
  - 0.15 for the seller's reputation;
  - 0.10 for a smaller payment.
- **Ties and waiting:** equal priority keeps arrival order, and no call waits more than 30 s.
- **Where to see it:** the Run page shows queued calls and recent contention decisions, and `GET /buyer/queue` returns the same data.
- **Budgets:** these rules decide the order of payments. The guarantee that spending never passes the budget still comes from the per-run budget reservations.

## Deploying (Render API + Vercel UI)

The API (registry, sellers, buyer, ledger) is one Docker service; the Next.js UI is a separate Vercel project that proxies to it.

1. **Render**: New > Blueprint, pick this repo (`render.yaml`). Fill the secret env vars (see `.env.example`: `BUYER_PRIVATE_KEY`, `SECRETS_KEY`, `PAYTO_*`, `OLLAMA_API_KEY`, `ADMIN_TOKEN`, `BUYER_TOKEN`). Set `PUBLIC_BASE_URL` to the service's own URL (e.g. `https://gandiva-api.onrender.com`) and redeploy once it is known.
2. **Vercel**: import the repo, set the root directory to `client/`, and set `API_URL` to the Render URL. Nothing else is needed; the client reads no other env vars.
3. **Check**: `<render-url>/healthz`, `<render-url>/registry/services`, then sign in and run a task from the Vercel URL.

Things to know:

- **The free Render plan has no disk, so the database is replicated with Litestream.** `deploy/start.sh` restores `data/gandiva.db` (ledger, registry, users, agent wallets) from an S3-compatible bucket on start, then runs the server under `litestream replicate`, which copies every change to the bucket about once a second. Set `LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT` (with `https://`), `LITESTREAM_REGION`, `LITESTREAM_ACCESS_KEY_ID` and `LITESTREAM_SECRET_ACCESS_KEY` on Render (Backblaze B2 works; set the bucket to keep only the last file version). Without `LITESTREAM_BUCKET` the server starts without replication and the data is wiped on every restart or deploy.
- **Litestream limits:** a hard crash can lose the last second or two of writes; one server instance only; keep the bucket private (it holds the whole database, including encrypted keys) and never change `SECRETS_KEY`, or the restored wallets cannot be decrypted.
- **Deploys:** auto-deploy is off, so deploy by hand.
- **The free plan sleeps after 15 idle minutes.** Point an uptime pinger (e.g. UptimeRobot) at `/healthz` every 5 minutes.
- Every registry listing and 402 `resource.url` is built from `PUBLIC_BASE_URL`, so sellers are reached on the Render URL directly, not through Vercel.
- Local image check: `docker build -t gandiva-api .`
