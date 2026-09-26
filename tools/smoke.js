#!/usr/bin/env node
/*
 * HTTP 冒烟：静态应用可用性检查。
 * 目标由环境变量 APP_URL 指定（默认 http://localhost:8080）。
 * 全部检查通过退出码 0，否则退出码 1。
 */
'use strict';

const base = (process.env.APP_URL || 'http://localhost:8080').replace(/\/+$/, '');

const CHECKS = [
  { path: '/', expect: 200, includes: ['超导磁通探针', 'app.js', 'probe-table'] },
  { path: '/solver.js', expect: 200, includes: ['PhaseSolver', 'minCutSourceSet'] },
  { path: '/worker.js', expect: 200, includes: ['importScripts', 'onmessage'] },
  { path: '/app.js', expect: 200, includes: ['new Worker', 'runToken'] },
  { path: '/styles.css', expect: 200, includes: ['#app'] },
  { path: '/__missing__', expect: 404 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  const res = await fetch(base + path, { redirect: 'follow' });
  const body = await res.text();
  return { status: res.status, body };
}

async function waitForApp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const r = await get('/');
      if (r.status === 200) return true;
      lastErr = new Error('HTTP ' + r.status);
    } catch (e) {
      lastErr = e;
    }
    await sleep(500);
  }
  throw lastErr || new Error('等待应用就绪超时');
}

(async () => {
  console.log(`HTTP 冒烟目标: ${base}`);
  try {
    await waitForApp(30000);
    console.log('  ✓ 应用已就绪');
  } catch (e) {
    console.error('  ✗ 应用未就绪: ' + e.message);
    process.exit(1);
  }

  let failed = false;
  for (const c of CHECKS) {
    try {
      const r = await get(c.path);
      if (r.status !== c.expect) {
        console.error(`  ✗ GET ${c.path} → ${r.status}（期望 ${c.expect}）`);
        failed = true;
        continue;
      }
      const missing = (c.includes || []).filter((s) => !r.body.includes(s));
      if (missing.length) {
        console.error(`  ✗ GET ${c.path} 缺少内容标记: ${missing.join(', ')}`);
        failed = true;
        continue;
      }
      console.log(`  ✓ GET ${c.path} → ${r.status}`);
    } catch (e) {
      console.error(`  ✗ GET ${c.path} 请求失败: ${e.message}`);
      failed = true;
    }
  }

  if (failed) {
    console.error('HTTP 冒烟失败');
    process.exit(1);
  }
  console.log('HTTP 冒烟通过');
  process.exit(0);
})();
