import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from './config.js';
import { parseResult } from './mcp.js';

let client = null;

async function getClient() {
  if (client) return client;
  if (!config.github.token) throw new Error('GITHUB_TOKEN is missing from .env');
  const transport = new StreamableHTTPClientTransport(new URL(config.github.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${config.github.token}` } },
  });
  const c = new Client({ name: 'mergepay', version: '1.0.0' });
  await c.connect(transport);
  client = c;
  return c;
}

async function call(name, args) {
  try {
    const c = await getClient();
    return parseResult(await c.callTool({ name, arguments: args }));
  } catch (e) {
    if (!e.toolError) client = null; // reconnect next time on transport errors
    throw e;
  }
}

const closingRef = (n) => new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#${n}\\b`, 'i');

// Reads the issue, finds the PR that closes it and its merge status. All via GitHub MCP.
export async function readBountyEvidence() {
  const { owner, repo, issueNumber } = config.bounty;
  const out = { issue: null, pr: null, problems: [] };

  try {
    const issue = await call('issue_read', { method: 'get', owner, repo, issue_number: issueNumber });
    out.issue = {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      url: issue.html_url,
      author: issue.user?.login,
    };
    var linked = issue.closed_by_pull_requests?.references?.[0]?.number;
  } catch (e) {
    out.problems.push(`Could not read issue #${issueNumber} in ${owner}/${repo}: ${e.message}`);
    return out;
  }

  try {
    let prNumber = linked;
    if (!prNumber) {
      const prs = await call('list_pull_requests', { owner, repo, state: 'all', perPage: 50 });
      prNumber = (Array.isArray(prs) ? prs : []).find((p) => closingRef(issueNumber).test(p.body || ''))?.number;
    }
    if (!prNumber) {
      out.problems.push(`No pull request is linked to issue #${issueNumber} yet (a PR body must say "Closes #${issueNumber}").`);
      return out;
    }
    const pr = await call('pull_request_read', { method: 'get', owner, repo, pullNumber: prNumber });
    out.pr = {
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: pr.state,
      merged: pr.merged === true,
      mergedAt: pr.merged_at || null,
      mergedBy: (typeof pr.merged_by === 'string' ? pr.merged_by : pr.merged_by?.login) || null,
      author: pr.user?.login,
      authorUrl: pr.user?.profile_url || (pr.user?.login ? `https://github.com/${pr.user.login}` : null),
      mergeCommit: pr.merge_commit_sha || null,
      baseRef: pr.base?.ref,
    };
  } catch (e) {
    out.problems.push(`Could not read the pull request: ${e.message}`);
  }
  return out;
}
