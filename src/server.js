import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { readBountyEvidence } from './github.js';
import * as tangem from './tangem.js';

const STATE_FILE = path.resolve('data/payment.json');
const loadPayment = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
};
const savePayment = (p) => {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  if (p) fs.writeFileSync(STATE_FILE, JSON.stringify(p, null, 2));
  else fs.rmSync(STATE_FILE, { force: true });
};

// Read-only check of the transaction on Ethereum itself (public RPC), so the
// receipt shows real on-chain confirmation, not just the Tangem app's report.
async function rpc(method, params) {
  const r = await fetch(config.ethRpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
async function chainStatus(txHash) {
  try {
    const [tx, receipt] = await Promise.all([
      rpc('eth_getTransactionByHash', [txHash]),
      rpc('eth_getTransactionReceipt', [txHash]),
    ]);
    if (!tx) return { state: 'not_found' };
    const out = {
      to: tx.to,
      from: tx.from,
      valueEth: Number(BigInt(tx.value)) / 1e18,
      state: receipt ? (receipt.status === '0x1' ? 'confirmed' : 'failed') : 'pending',
      blockNumber: receipt ? parseInt(receipt.blockNumber, 16) : null,
    };
    if (out.blockNumber) {
      const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
      out.timestamp = new Date(parseInt(block.timestamp, 16) * 1000).toISOString();
    }
    return out;
  } catch (e) {
    return { state: 'unknown', error: e.message };
  }
}

const app = express();
app.use(express.json());
app.use(express.static(path.resolve('public')));

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
};

app.get('/api/config', (req, res) =>
  res.json({
    repo: `${config.bounty.owner}/${config.bounty.repo}`,
    issueNumber: config.bounty.issueNumber,
    amountEth: config.bounty.amountEth,
    network: 'Ethereum',
    payoutAddress: config.bounty.payoutAddress,
    explorerTxUrl: config.explorerTxUrl,
  }),
);

app.get('/api/bounty', wrap(async () => ({ ...(await readBountyEvidence()), checkedAt: new Date().toISOString() })));

app.get(
  '/api/tangem',
  wrap(async () => {
    let conn;
    try {
      conn = await tangem.connect();
    } catch (e) {
      return { connected: false, error: `Could not reach Tangem MCP: ${e.message}` };
    }
    if (!conn.connected) return conn;
    try {
      const { fromAddress } = await tangem.getEthAccount();
      let balance = null;
      let balanceError = null;
      try {
        balance = await tangem.getEthBalance(fromAddress);
      } catch (e) {
        balanceError = e.message;
      }
      return { connected: true, fromAddress, balance, balanceError };
    } catch (e) {
      return { connected: true, walletError: e.message };
    }
  }),
);

app.post('/api/tangem/disconnect', wrap(async () => (await tangem.disconnect(), { ok: true })));

app.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.redirect(`/?tangemError=${encodeURIComponent(error_description || error)}`);
  try {
    await tangem.finishAuth(String(code), String(state || ''));
    res.redirect('/?tangem=connected');
  } catch (e) {
    console.error(e);
    res.redirect(`/?tangemError=${encodeURIComponent(e.message)}`);
  }
});

app.get('/api/payment', (req, res) => res.json(loadPayment()));

app.post(
  '/api/payment/prepare',
  wrap(async () => {
    const existing = loadPayment();
    if (existing) throw new Error('A payment request already exists. Check its status, or discard it first.');
    // Re-check the evidence right now: never request a payment for an unmerged PR.
    const ev = await readBountyEvidence();
    if (!ev.issue || !ev.pr) throw new Error(ev.problems.join(' ') || 'Missing issue or pull request.');
    if (!ev.pr.merged) throw new Error(`PR #${ev.pr.number} is not merged. Payment unavailable.`);

    const { fromAddress } = await tangem.getEthAccount();
    const comment = `MergePay bounty: ${config.bounty.owner}/${config.bounty.repo}#${ev.issue.number} via PR #${ev.pr.number} by @${ev.pr.author}`;
    const res = await tangem.sendTransaction({ fromAddress, comment });
    const intentId = res.intentId || res.id;
    if (!intentId) throw new Error(`Tangem did not return a request id: ${JSON.stringify(res)}`);
    const payment = {
      intentId,
      deeplink: res.deeplink || res.deepLink || res.url || null,
      status: res.status || 'CREATED',
      fromAddress,
      toAddress: config.bounty.payoutAddress,
      amountEth: config.bounty.amountEth,
      network: 'Ethereum',
      issue: ev.issue,
      pr: ev.pr,
      requestedAt: new Date().toISOString(),
      tangemResponse: res,
    };
    savePayment(payment);
    return payment;
  }),
);

app.post(
  '/api/payment/status',
  wrap(async () => {
    const p = loadPayment();
    if (!p) throw new Error('No payment request yet.');
    const res = await tangem.getTransactionStatus(p.intentId);
    p.status = res.status || p.status;
    p.txHash = res.txHash || res.transactionHash || p.txHash || null;
    p.tangemStatus = res;
    p.checkedAt = new Date().toISOString();
    if (p.txHash) p.chain = await chainStatus(p.txHash);
    savePayment(p);
    return p;
  }),
);

app.post('/api/payment/discard', (req, res) => {
  const p = loadPayment();
  if (p?.txHash) return res.status(400).json({ error: 'This request has a signed transaction. It cannot be discarded.' });
  savePayment(null);
  res.json({ ok: true });
});

app.listen(config.port, () => console.log(`MergePay running at ${config.baseUrl}`));
