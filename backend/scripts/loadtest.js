/**
 * Basic load test for ImgHoster API.
 *
 * Exercises:
 *  - POST /api/auth/login
 *  - POST /api/images/upload
 *  - GET  /i/:slug
 *  - DELETE /api/images/:id
 *
 * Usage examples:
 *   node scripts/loadtest.js --username admin --password MyPass123!
 *   node scripts/loadtest.js --baseUrl http://127.0.0.1:3000 --durationSec 120 --concurrency 40 --username admin --password secret
 */

import { performance } from 'node:perf_hooks';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

function toInt(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function pickRandom(arr) {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function parseSetCookieHeader(setCookie) {
  const first = String(setCookie).split(';')[0];
  const eq = first.indexOf('=');
  if (eq <= 0) return null;
  return {
    name: first.slice(0, eq).trim(),
    value: first.slice(eq + 1).trim(),
  };
}

function buildMultipartBody(fields, files) {
  const boundary = `----imghoster-loadtest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks = [];

  for (const [name, value] of Object.entries(fields || {})) {
    chunks.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      `${value}\r\n`
    ));
  }

  for (const file of files || []) {
    chunks.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n` +
      `Content-Type: ${file.mimeType}\r\n\r\n`
    ));
    chunks.push(file.content);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    buffer: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

class HttpClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.cookieJar = new Map();
  }

  _cookieHeader() {
    return [...this.cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  _captureCookies(response) {
    let setCookies = [];
    if (typeof response.headers.getSetCookie === 'function') {
      setCookies = response.headers.getSetCookie();
    } else {
      const one = response.headers.get('set-cookie');
      if (one) setCookies = [one];
    }

    for (const sc of setCookies) {
      const parsed = parseSetCookieHeader(sc);
      if (parsed) this.cookieJar.set(parsed.name, parsed.value);
    }
  }

  async request(method, path, { headers = {}, body } = {}) {
    const requestHeaders = { ...headers };
    const cookie = this._cookieHeader();
    if (cookie) requestHeaders.Cookie = cookie;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body,
    });

    this._captureCookies(res);

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json().catch(() => ({}));
      return { status: res.status, json, headers: res.headers };
    }

    const text = await res.text().catch(() => '');
    return { status: res.status, text, headers: res.headers };
  }
}

(async () => {
  const args = parseArgs(process.argv.slice(2));

  const config = {
    baseUrl: args.baseUrl || process.env.LOADTEST_BASE_URL || 'http://127.0.0.1:3000',
    username: args.username || process.env.LOADTEST_USERNAME || '',
    password: args.password || process.env.LOADTEST_PASSWORD || '',
    durationSec: toInt(args.durationSec || process.env.LOADTEST_DURATION_SEC, 60),
    concurrency: toInt(args.concurrency || process.env.LOADTEST_CONCURRENCY, 20),
    uploadWeight: toInt(args.uploadWeight || process.env.LOADTEST_UPLOAD_WEIGHT, 30),
    viewWeight: toInt(args.viewWeight || process.env.LOADTEST_VIEW_WEIGHT, 50),
    deleteWeight: toInt(args.deleteWeight || process.env.LOADTEST_DELETE_WEIGHT, 20),
  };

  if (!config.username || !config.password) {
    console.error('Missing credentials. Provide --username and --password or LOADTEST_USERNAME/LOADTEST_PASSWORD env vars.');
    process.exit(1);
  }

  const client = new HttpClient(config.baseUrl);

  const loginResp = await client.request('POST', '/api/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.username, password: config.password, rememberMe: false }),
  });

  if (loginResp.status !== 200) {
    console.error('Login failed:', loginResp.status, loginResp.json || loginResp.text || 'unknown error');
    process.exit(1);
  }

  let csrfToken = (loginResp.json && loginResp.json.csrfToken) || null;
  if (!csrfToken) {
    const meResp = await client.request('GET', '/api/auth/me');
    if (meResp.status === 200 && meResp.json) csrfToken = meResp.json.csrfToken || null;
  }

  if (!csrfToken) {
    console.error('Failed to obtain CSRF token after login.');
    process.exit(1);
  }

  const images = [];

  const metrics = {
    startedAt: performance.now(),
    total: 0,
    success: 0,
    failed: 0,
    byOp: {
      upload: { total: 0, success: 0, failed: 0, latencies: [] },
      view: { total: 0, success: 0, failed: 0, latencies: [] },
      delete: { total: 0, success: 0, failed: 0, latencies: [] },
    },
    statusCounts: {},
  };

  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5K3A8AAAAASUVORK5CYII=',
    'base64'
  );

  function chooseOp() {
    const sum = config.uploadWeight + config.viewWeight + config.deleteWeight;
    const n = Math.random() * sum;
    if (n < config.uploadWeight) return 'upload';
    if (n < config.uploadWeight + config.viewWeight) return 'view';
    return 'delete';
  }

  async function doUpload(workerId) {
    const payload = buildMultipartBody(
      {
        compress: 'false',
        comment: `loadtest worker ${workerId}`,
        tags: 'loadtest, perf',
      },
      [
        {
          fieldName: 'image',
          filename: `lt-${workerId}-${Date.now()}.png`,
          mimeType: 'image/png',
          content: tinyPng,
        },
      ]
    );

    const resp = await client.request('POST', '/api/images/upload', {
      headers: {
        'Content-Type': payload.contentType,
        'X-CSRF-Token': csrfToken,
      },
      body: payload.buffer,
    });

    if (resp.status === 201) {
      const entry = Array.isArray(resp.json.uploaded) ? resp.json.uploaded[0] : resp.json;
      if (entry && entry.id && entry.slug) {
        images.push({ id: entry.id, slug: entry.slug });
      }
      return true;
    }
    return false;
  }

  async function doView() {
    const target = pickRandom(images);
    if (!target) return doUpload('seed-view');

    const resp = await client.request('GET', `/i/${encodeURIComponent(target.slug)}`);
    return resp.status === 200;
  }

  async function doDelete() {
    const target = images.pop();
    if (!target) return doUpload('seed-delete');

    const resp = await client.request('DELETE', `/api/images/${target.id}`, {
      headers: { 'X-CSRF-Token': csrfToken },
    });

    return resp.status === 200 || resp.status === 404;
  }

  async function runOp(op, workerId) {
    const started = performance.now();
    let ok = false;
    let statusForCount = 'unknown';

    try {
      if (op === 'upload') ok = await doUpload(workerId);
      else if (op === 'view') ok = await doView();
      else ok = await doDelete();
      statusForCount = ok ? 'ok' : 'fail';
    } catch (_err) {
      ok = false;
      statusForCount = 'exception';
    }

    const elapsed = performance.now() - started;

    metrics.total += 1;
    metrics.byOp[op].total += 1;
    metrics.byOp[op].latencies.push(elapsed);

    metrics.statusCounts[statusForCount] = (metrics.statusCounts[statusForCount] || 0) + 1;

    if (ok) {
      metrics.success += 1;
      metrics.byOp[op].success += 1;
    } else {
      metrics.failed += 1;
      metrics.byOp[op].failed += 1;
    }
  }

  const deadline = Date.now() + (config.durationSec * 1000);
  console.log('Starting load test with config:', config);

  const workers = Array.from({ length: config.concurrency }).map((_, i) => (async () => {
    while (Date.now() < deadline) {
      const op = chooseOp();
      await runOp(op, i + 1);
    }
  })());

  await Promise.all(workers);

  // Cleanup a subset of leftover images to avoid DB growth during repeated runs.
  const cleanup = images.splice(0, Math.min(images.length, 200));
  for (const img of cleanup) {
    try {
      await client.request('DELETE', `/api/images/${img.id}`, {
        headers: { 'X-CSRF-Token': csrfToken },
      });
    } catch (_err) {
      // ignore cleanup failures
    }
  }

  const endedAt = performance.now();
  const elapsedSec = (endedAt - metrics.startedAt) / 1000;
  const rpm = elapsedSec > 0 ? (metrics.total / elapsedSec) * 60 : 0;

  function summarizeOp(name, op) {
    const avg = op.latencies.length
      ? op.latencies.reduce((a, b) => a + b, 0) / op.latencies.length
      : 0;
    return {
      name,
      total: op.total,
      success: op.success,
      failed: op.failed,
      avgMs: Number(avg.toFixed(2)),
      p50Ms: Number(percentile(op.latencies, 50).toFixed(2)),
      p95Ms: Number(percentile(op.latencies, 95).toFixed(2)),
      p99Ms: Number(percentile(op.latencies, 99).toFixed(2)),
    };
  }

  const summary = {
    durationSec: Number(elapsedSec.toFixed(2)),
    totalRequests: metrics.total,
    success: metrics.success,
    failed: metrics.failed,
    requestsPerMinute: Number(rpm.toFixed(2)),
    opBreakdown: [
      summarizeOp('upload', metrics.byOp.upload),
      summarizeOp('view', metrics.byOp.view),
      summarizeOp('delete', metrics.byOp.delete),
    ],
    statusCounts: metrics.statusCounts,
  };

  console.log('\nLoad test summary');
  console.log(JSON.stringify(summary, null, 2));
})();
