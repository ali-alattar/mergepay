# MergePay

Attach an ETH bounty to a GitHub issue. When the developer's pull request is merged, MergePay shows the evidence and lets the project owner request the payment. The owner approves it in the Tangem app, and MergePay shows a receipt linked to Etherscan.

The MergePay backend is itself an **MCP client**. It has no LLM inside:

- **GitHub MCP** (`https://api.githubcopilot.com/mcp/`) reads the issue, the linked PR, its author and its merge status. It authenticates with `GITHUB_TOKEN` from `.env`.
- **Tangem MCP** (`https://mcp.tangem.org/mcp`) reads the wallet and its balance, creates the transfer request (`send_transaction`) and reads its status. It uses OAuth, so MergePay appears as its own connected agent in the Tangem app. MergePay never signs anything, and no ETH moves until you approve the request in Tangem.

The confirmation shown on the receipt is read from Ethereum through a public RPC.

## Run

```bash
npm install
cp .env.example .env              # then set GITHUB_TOKEN (e.g. $(gh auth token))
npm start                          # http://localhost:3000
```

## Configure

Version 1 handles one repo, one issue, one developer and ETH on Ethereum. Change them in `.env` (see `.env.example`) or in `src/config.js`:

| Setting | Default |
| --- | --- |
| `BOUNTY_REPO_OWNER` / `BOUNTY_REPO_NAME` | `ali-alattar/tangem-mcp-demo` |
| `BOUNTY_ISSUE_NUMBER` | `1` |
| `BOUNTY_AMOUNT_ETH` | `0.0006` (about $1) |
| `DEVELOPER_PAYOUT_ADDRESS` | `0xDFD5…513d` |

MergePay finds the linked PR through GitHub's "closed by" link on the issue, or through a PR body that says `Closes #N`.

## Tangem OAuth

Tangem's authorization server has no dynamic client registration. It uses a **Client ID Metadata Document**: the `client_id` is the public HTTPS URL of [`docs/client-metadata.json`](docs/client-metadata.json), which GitHub Pages serves at `https://ali-alattar.github.io/mergepay/client-metadata.json`. If you run MergePay on another host or port, add that redirect URI to the document (or host your own copy and set `TANGEM_CLIENT_METADATA_URL`).

Tokens and payment state are stored in `data/`, which is gitignored. Delete `data/` to start over.
