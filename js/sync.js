// GitHub backup: whole-file Contents-API PUT of data.json to the private data repo.
// Network calls take an injected fetch so the flow is testable under node.
// Flow per the decided sync shape: GET the remote blob sha; if it matches the sha we
// last wrote, PUT; if it differs, report divergence and let the user choose.

export const REPO = {
  owner: 'curtisnn',
  repo: 'cn-personal-habits',
  path: 'data/data.json',
  branch: 'main',
};

const API = 'https://api.github.com';

export function contentsUrl(repo = REPO) {
  return `${API}/repos/${repo.owner}/${repo.repo}/contents/${repo.path}`;
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function serialize(data) {
  return JSON.stringify(data, null, 2) + '\n';
}

export function encodeContent(data) {
  const bytes = new TextEncoder().encode(serialize(data));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function decodeContent(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// -> { status: 'ok', sha, data } | { status: 'missing' } | { status: 'auth' }
// Throws on network failure or unexpected HTTP status.
export async function getRemote(fetchFn, token, repo = REPO) {
  const res = await fetchFn(`${contentsUrl(repo)}?ref=${repo.branch}`, { headers: headers(token) });
  if (res.status === 401) return { status: 'auth' };
  if (res.status === 404) return { status: 'missing' };
  if (!res.ok) throw new Error(`GitHub GET failed (${res.status})`);
  const body = await res.json();
  return { status: 'ok', sha: body.sha, data: decodeContent(body.content) };
}

// -> { status: 'ok', sha } | { status: 'auth' } | { status: 'conflict' }
export async function putRemote(fetchFn, token, data, sha, message, repo = REPO) {
  const res = await fetchFn(contentsUrl(repo), {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({
      message,
      branch: repo.branch,
      content: encodeContent(data),
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 401) return { status: 'auth' };
  if (res.status === 409 || res.status === 422) return { status: 'conflict' };
  if (!res.ok) throw new Error(`GitHub PUT failed (${res.status})`);
  const body = await res.json();
  return { status: 'ok', sha: body.content.sha };
}

// The auto-backup on session finish. lastSha is the blob sha this device last wrote
// or pulled; a remote sha that differs (or a remote file this device has never seen)
// is divergence — never overwrite silently.
// -> putRemote's result, or { status: 'diverged', remote }
export async function backup(fetchFn, token, data, lastSha, message, repo = REPO) {
  const remote = await getRemote(fetchFn, token, repo);
  if (remote.status === 'auth') return { status: 'auth' };
  if (remote.status === 'ok' && remote.sha !== lastSha) return { status: 'diverged', remote };
  return putRemote(fetchFn, token, data, remote.status === 'ok' ? remote.sha : null, message, repo);
}
