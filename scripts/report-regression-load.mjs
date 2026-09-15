import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8080';
const routes = ['/api/v1/videos/recommend', '/api/v1/videos/ranking?type=hot&period=daily', '/api/v1/feeds'];
const results = [];
for (const concurrency of [10, 50, 100]) {
  const count = 600;
  let next = 0;
  let ok = 0;
  const errors = {};
  const timings = [];
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      const at = performance.now();
      try {
        const response = await fetch(base + routes[index % routes.length], { signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (response.ok && data.code === 0) ok++;
        else { const key = `${response.status}/${data.code}`; errors[key] = (errors[key] || 0) + 1; }
      } catch (error) { errors[error.name] = (errors[error.name] || 0) + 1; }
      timings.push(performance.now() - at);
    }
  }));
  const elapsed = performance.now() - start;
  timings.sort((a, b) => a - b);
  const percentile = (p) => Number(timings[Math.ceil(timings.length * p) - 1].toFixed(2));
  const result = { concurrency, requests: count, succeeded: ok, errors, elapsedMs: Math.round(elapsed), rps: Number((count * 1000 / elapsed).toFixed(2)), p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99) };
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile('test-artifacts/revision-load-results.json', JSON.stringify({ date: new Date().toISOString(), base, routes, environment: 'Single Windows host; dev H2; finite mixed-read regression, not a capacity or soak certification', results }, null, 2) + '\n');
if (results.some((result) => result.succeeded !== result.requests)) process.exitCode = 1;
