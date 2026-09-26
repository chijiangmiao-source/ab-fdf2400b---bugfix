#!/usr/bin/env node
/*
 * 构建检查：
 *  1. 全部前端 JS 的语法检查（node --check）；
 *  2. index.html 引用的本地资源存在性校验；
 *  3. 求解器在 Node 下可加载、内置样例结论自检；
 *  4. 产出 dist/ 静态产物。
 * 任一失败以非零退出码结束。
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'app');
const distDir = path.join(root, 'dist');

let failed = false;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  console.error(`  ✗ ${msg}`);
  failed = true;
};

console.log('[1/4] JS 语法检查');
const jsFiles = fs.readdirSync(appDir).filter((f) => f.endsWith('.js'));
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', path.join(appDir, f)], { stdio: 'pipe' });
    ok(`syntax: ${f}`);
  } catch (e) {
    bad(`syntax: ${f}: ${e.stderr ? String(e.stderr) : e.message}`);
  }
}

console.log('[2/4] HTML 资源引用校验');
const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !u.startsWith('http') && !u.startsWith('//') && !u.startsWith('data:'));
for (const r of refs) {
  if (fs.existsSync(path.join(appDir, r))) ok(`asset: ${r}`);
  else bad(`index.html 引用的资源缺失: ${r}`);
}

console.log('[3/4] 求解器加载与样例自检');
try {
  const solver = require(path.join(appDir, 'solver.js'));
  const r = solver.solve({
    probes: [
      { id: 0, lo: -20, hi: 20 },
      { id: 1, lo: -20, hi: 20 },
      { id: 2, lo: -20, hi: 20 },
    ],
    reference: 0,
    edges: [
      { from: 0, to: 1, target: 5, weight: 1 },
      { from: 1, to: 2, target: 5, weight: 1 },
      { from: 0, to: 2, target: 6, weight: 10 },
    ],
  });
  if (r.ok && r.totalCost === 4 && r.phases.map((p) => p.phase).join(',') === '0,1,6') {
    ok('样例结论 (0,1,6)，总代价 4');
  } else {
    bad('样例自检失败: ' + JSON.stringify(r));
  }
} catch (e) {
  bad('求解器加载失败: ' + e.message);
}

console.log('[4/4] 产出 dist/ 静态产物');
try {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  for (const f of fs.readdirSync(appDir)) {
    fs.copyFileSync(path.join(appDir, f), path.join(distDir, f));
  }
  ok(`dist/ 已写入 ${fs.readdirSync(distDir).length} 个文件`);
} catch (e) {
  bad('dist 产出失败: ' + e.message);
}

if (failed) {
  console.error('构建检查失败');
  process.exit(1);
}
console.log('构建检查通过');
