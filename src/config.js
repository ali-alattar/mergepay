import 'dotenv/config';

// Everything you might want to change for another bounty lives here (or in .env).
const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 3000}`,

  github: {
    token: env.GITHUB_TOKEN,
    mcpUrl: env.GITHUB_MCP_URL || 'https://api.githubcopilot.com/mcp/',
  },

  tangem: {
    mcpUrl: env.TANGEM_MCP_URL || 'https://mcp.tangem.org/mcp',
    // Tangem has no dynamic client registration: the client_id is the public
    // HTTPS URL of a Client ID Metadata Document (see docs/client-metadata.json).
    clientMetadataUrl:
      env.TANGEM_CLIENT_METADATA_URL || 'https://ali-alattar.github.io/mergepay/client-metadata.json',
    // Optional: pick a specific sending address if the wallet has several ETH accounts.
    fromAddress: env.TANGEM_FROM_ADDRESS || '',
  },

  bounty: {
    owner: env.BOUNTY_REPO_OWNER || 'ali-alattar',
    repo: env.BOUNTY_REPO_NAME || 'tangem-mcp-demo',
    issueNumber: Number(env.BOUNTY_ISSUE_NUMBER || 1),
    amountEth: env.BOUNTY_AMOUNT_ETH || '0.0006', // about $1
    networkId: 'ethereum',
    tokenId: 'ethereum',
    payoutAddress: env.DEVELOPER_PAYOUT_ADDRESS || '0xDFD58eC735CFa8993A4bE5b66FA189e2DB35513d',
  },

  ethRpcUrl: env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com',
  explorerTxUrl: 'https://etherscan.io/tx/',
};

export const redirectUrl = `${config.baseUrl}/oauth/callback`;
