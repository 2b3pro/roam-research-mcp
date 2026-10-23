import './fake-roam-backend.mjs';
import { appendFileSync } from 'node:fs';

const fixtureFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  if (!request.url.startsWith('https://api.roamresearch.com/')) return fixtureFetch(input, init);
  if (request.url.endsWith('/q')) {
    const body = await request.clone().json();
    if (body.query === 'error-probe') return new Response(JSON.stringify({ message: 'peer starting' }), {
      status: 503, headers: { 'Retry-After': '2' },
    });
  }
  if (request.url.endsWith('/write')) {
    const body = await request.clone().json();
    if (process.env.FAKE_ROAM_WRITE_LOG) appendFileSync(process.env.FAKE_ROAM_WRITE_LOG, JSON.stringify(body) + '\n');
    return new Response(JSON.stringify({ message: 'batch interrupted',
      data: { 'num-actions-successfully-transacted-before-failure': 1 },
    }), { status: 429, headers: { 'Retry-After': '7' } });
  }
  return fixtureFetch(input, init);
};
