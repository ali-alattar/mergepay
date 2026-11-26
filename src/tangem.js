import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { config, redirectUrl } from './config.js';
import { parseResult } from './mcp.js';

const AUTH_FILE = path.resolve('data/tangem-auth.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function save(patch) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ ...load(), ...patch }, null, 2), { mode: 0o600 });
}

// OAuth client provider for the MCP SDK. Tokens are kept in data/ (gitignored).
class TangemAuthProvider {
  pendingAuthUrl = null;
  get redirectUrl() {
    return redirectUrl;
  }
  get clientMetadataUrl() {
    return config.tangem.clientMetadataUrl;
  }
  get clientMetadata() {
    return {
      client_name: 'MergePay',
      redirect_uris: [redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  state() {
    const s = crypto.randomUUID();
    save({ oauthState: s });
    return s;
  }
  clientInformation() {
    return load().clientInformation;
  }
  saveClientInformation(info) {
    save({ clientInformation: info });
  }
  tokens() {
    return load().tokens;
  }
  saveTokens(tokens) {
    save({ tokens });
  }
  redirectToAuthorization(url) {
    this.pendingAuthUrl = url.toString();
  }
  saveCodeVerifier(v) {
    save({ codeVerifier: v });
  }
  codeVerifier() {
    const v = load().codeVerifier;
    if (!v) throw new Error('No PKCE code verifier saved');
    return v;
  }
  invalidateCredentials(scope) {
    const d = load();
    if (scope === 'all' || scope === 'tokens') delete d.tokens;
    if (scope === 'all' || scope === 'client') delete d.clientInformation;
    if (scope === 'all' || scope === 'verifier') delete d.codeVerifier;
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(d, null, 2), { mode: 0o600 });
  }
}

const provider = new TangemAuthProvider();
let client = null;
let pendingTransport = null;
let toolNames = {};

function newTransport() {
  return new StreamableHTTPClientTransport(new URL(config.tangem.mcpUrl), { authProvider: provider });
}

// Connect with saved tokens. Returns {connected:true} or {connected:false, authUrl}.
export async function connect() {
  if (client) return { connected: true };
  const transport = newTransport();
  const c = new Client({ name: 'MergePay', version: '1.0.0' });
  provider.pendingAuthUrl = null;
  try {
    await c.connect(transport);
  } catch (e) {
    if (e instanceof UnauthorizedError || provider.pendingAuthUrl) {
      pendingTransport = transport;
      return { connected: false, authUrl: provider.pendingAuthUrl };
    }
    throw e;
  }
  const { tools } = await c.listTools();
  // Map short names (get_tokens, ...) to whatever names the server uses.
  toolNames = {};
  for (const t of tools) {
    for (const short of ['get_tokens', 'get_balances', 'send_transaction', 'get_transaction_status']) {
      if (t.name === short || t.name.endsWith(short)) toolNames[short] ||= t.name;
    }
  }
  client = c;
  return { connected: true };
}

export async function finishAuth(code, state) {
  const expected = load().oauthState;
  if (expected && state !== expected) throw new Error('OAuth state mismatch. Start the connection again.');
  if (!pendingTransport) pendingTransport = newTransport();
  await pendingTransport.finishAuth(code);
  pendingTransport = null;
  return connect();
}

export function isConnected() {
  return !!client;
}

export async function disconnect() {
  try {
    await client?.close();
  } catch {}
  client = null;
  provider.invalidateCredentials('all');
}

async function call(short, args) {
  if (!client) {
    const r = await connect();
    if (!r.connected) throw new Error('Tangem is not connected. Connect Tangem first.');
  }
  const name = toolNames[short];
  if (!name) throw new Error(`The Tangem MCP server does not offer a ${short} tool.`);
  try {
    return parseResult(await client.callTool({ name, arguments: args }));
  } catch (e) {
    if (e instanceof UnauthorizedError) client = null;
    throw e;
  }
}

// Find the ETH coin on Ethereum in the approved wallet.
export async function getEthAccount() {
  const res = await call('get_tokens', {});
  const tokens = res.tokens || res.assets || (Array.isArray(res) ? res : []);
  const eth = tokens.filter(
    (t) => t.networkId === config.bounty.networkId && t.tokenId === config.bounty.tokenId && !t.contractAddress,
  );
  if (!eth.length) throw new Error('The approved Tangem wallet has no ETH on the Ethereum network.');
  const addresses = eth.flatMap((t) => (t.addresses || []).map((a) => (typeof a === 'string' ? a : a.address)));
  if (!addresses.length) throw new Error('The Tangem app has not shared the ETH address yet. Open the app and refresh.');
  const want = config.tangem.fromAddress.toLowerCase();
  const fromAddress = (want && addresses.find((a) => a.toLowerCase() === want)) || addresses[0];
  return { fromAddress, addresses };
}

export async function getEthBalance(walletAddress) {
  const res = await call('get_balances', { request: { networkId: config.bounty.networkId, walletAddress } });
  const list = res.balances || (Array.isArray(res) ? res : []);
  const native = list[0];
  if (!native || native.rawAmount == null) return null;
  const decimals = native.decimals ?? 18;
  return Number(BigInt(native.rawAmount)) / 10 ** decimals;
}

export async function sendTransaction({ fromAddress, comment }) {
  return call('send_transaction', {
    request: {
      networkId: config.bounty.networkId,
      tokenId: config.bounty.tokenId,
      fromAddress,
      toAddress: config.bounty.payoutAddress,
      amount: config.bounty.amountEth,
      comment,
      sendNotification: true,
    },
  });
}

export async function getTransactionStatus(intentId) {
  return call('get_transaction_status', { intentId });
}
