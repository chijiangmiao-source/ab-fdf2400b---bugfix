/*
 * 超导磁通探针阵列 —— 整数相位面复原求解器（精确，无浮点近似，无枚举）。
 *
 * 问题：给定探针整数相位范围 [lo, hi]、一个固定为 0 的参考探针、
 * 有向观测边 (u, v, t, w)（目标差值 t，正整数权重 w），
 * 在所有满足范围的整数赋值 x 上精确最小化
 *     Σ_e  w_e · |(x_v − x_u) − t_e|
 * 同成本时取按探针标识升序的字典序最小相位向量。
 *
 * 方法（Ishikawa 归约）：有序整数标签上的凸代价 → s-t 最小割。
 *   · 对每个探针 i 与每个等级 k ∈ (lo_i, hi_i] 设 0/1 指示 y_{i,k} = [x_i ≥ k]，
 *     单调性 y_{i,k} ≥ y_{i,k+1} 用 ∞ 容量边强制；
 *   · 由分层恒等式（coarea）：|x_v − x_u − t| = Σ_k |y_{v,k} − y_{u,k−t}|，
 *     每一项是两个 0/1 变量的绝对差，用一对反向、容量各为 w 的弧精确表示；
 *     若某侧指示落在自由等级区间之外则为常量，退化为源/汇弧或常数项；
 *   · 全部容量为整数，用 Dinic 求最大流，完全整数运算。
 *
 * 字典序最小：最大流残量图中从源可达的集合是所有最小割源侧集合的唯一最小元，
 * 它给出分量最小的 y，从而给出分量最小、亦即字典序最小的相位向量。
 *
 * 本文件为 UMD：既可被 Web Worker 以 importScripts 加载，也可被 Node require。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PhaseSolver = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const LIMITS = {
    MIN_PROBES: 2,
    MAX_PROBES: 40,
    MAX_WIDTH: 100,        // 单个探针 hi − lo 的上限（保证浏览器内响应）
    MAX_ABS_BOUND: 1e6,    // |lo|、|hi|、|target| 的上限
    MAX_WEIGHT: 1e6,       // 权重上限（正整数）
    MAX_EDGES: 1600,       // 40 探针全连接有向边（含自环）为 1600
    MAX_GRAPH_ARCS: 2e6,   // 归约图规模保护
  };

  const label = (id) => 'P' + id;

  /* ---------------- 输入校验：逐条定位错误 ---------------- */
  function validate(input) {
    const errors = [];
    const err = (path, message) => errors.push({ path, message });

    if (!input || typeof input !== 'object') {
      err('input', '输入为空或不是对象');
      return errors;
    }

    const probes = input.probes;
    if (!Array.isArray(probes)) {
      err('probes', '缺少探针列表');
      return errors;
    }
    if (probes.length < LIMITS.MIN_PROBES || probes.length > LIMITS.MAX_PROBES) {
      err('probes', `探针数量须为 ${LIMITS.MIN_PROBES}–${LIMITS.MAX_PROBES}，当前为 ${probes.length}`);
    }

    const seen = new Set();
    probes.forEach((p, i) => {
      const at = `probes[${i}]`;
      if (!p || typeof p !== 'object') {
        err(at, `探针 #${i} 定义缺失`);
        return;
      }
      if (!Number.isInteger(p.id)) {
        err(`${at}.id`, `探针 #${i} 的标识不是整数`);
      } else if (seen.has(p.id)) {
        err(`${at}.id`, `探针标识 ${label(p.id)} 重复`);
      } else {
        seen.add(p.id);
      }
      if (!Number.isInteger(p.lo) || !Number.isInteger(p.hi)) {
        err(`${at}.range`, `探针 ${label(p.id)} 的范围端点须为整数`);
      } else {
        if (Math.abs(p.lo) > LIMITS.MAX_ABS_BOUND || Math.abs(p.hi) > LIMITS.MAX_ABS_BOUND) {
          err(`${at}.range`, `探针 ${label(p.id)} 的范围端点超出 ±${LIMITS.MAX_ABS_BOUND}`);
        }
        if (p.lo > p.hi) {
          err(`${at}.range`, `探针 ${label(p.id)} 的整数相位范围为空（下限 ${p.lo} > 上限 ${p.hi}）`);
        } else if (p.hi - p.lo > LIMITS.MAX_WIDTH) {
          err(`${at}.range`, `探针 ${label(p.id)} 的范围宽度 ${p.hi - p.lo} 超过上限 ${LIMITS.MAX_WIDTH}`);
        }
      }
    });

    const ref = input.reference;
    if (!Number.isInteger(ref) || !seen.has(ref)) {
      err('reference', `参考探针 ${Number.isInteger(ref) ? label(ref) : JSON.stringify(ref)} 不存在`);
    } else {
      const rp = probes.find((p) => p.id === ref);
      if (rp && Number.isInteger(rp.lo) && Number.isInteger(rp.hi) && !(rp.lo <= 0 && 0 <= rp.hi)) {
        err('reference', `参考探针 ${label(ref)} 越界：范围 [${rp.lo}, ${rp.hi}] 不包含 0，无法固定为零`);
      }
    }

    let edges = input.edges;
    if (edges == null) {
      edges = [];
    } else if (!Array.isArray(edges)) {
      err('edges', '观测边列表须为数组');
      edges = [];
    }
    if (edges.length > LIMITS.MAX_EDGES) {
      err('edges', `观测边数量 ${edges.length} 超过上限 ${LIMITS.MAX_EDGES}`);
    }
    edges.forEach((e, i) => {
      const at = `edges[${i}]`;
      if (!e || typeof e !== 'object') {
        err(at, `边 #${i} 定义缺失`);
        return;
      }
      if (!Number.isInteger(e.from) || !seen.has(e.from)) {
        err(`${at}.from`, `边 #${i} 的起点 ${JSON.stringify(e.from)} 不存在`);
      }
      if (!Number.isInteger(e.to) || !seen.has(e.to)) {
        err(`${at}.to`, `边 #${i} 的终点 ${JSON.stringify(e.to)} 不存在`);
      }
      if (!Number.isInteger(e.target) || Math.abs(e.target) > LIMITS.MAX_ABS_BOUND) {
        err(`${at}.target`, `边 #${i} 的目标差值须为整数且在 ±${LIMITS.MAX_ABS_BOUND} 内`);
      }
      if (!Number.isInteger(e.weight) || e.weight < 1 || e.weight > LIMITS.MAX_WEIGHT) {
        err(`${at}.weight`, `边 #${i} 的权重须为正整数（1–${LIMITS.MAX_WEIGHT}）`);
      }
    });

    return errors;
  }

  /* ---------------- s-t 最小割（Dinic，整数容量，精确） ---------------- */
  function createGraph(n) {
    return { n, arcs: 0, adj: Array.from({ length: n }, () => []) };
  }

  function addArc(g, u, v, c) {
    const a = { to: v, cap: c, rev: null };
    const b = { to: u, cap: 0, rev: a };
    a.rev = b;
    g.adj[u].push(a);
    g.adj[v].push(b);
    g.arcs += 1;
  }

  function maxFlow(g, s, t) {
    const n = g.n;
    const level = new Int32Array(n);
    const it = new Int32Array(n);
    let flow = 0;

    const bfs = () => {
      level.fill(-1);
      const q = [s];
      level[s] = 0;
      for (let h = 0; h < q.length; h++) {
        const v = q[h];
        for (const e of g.adj[v]) {
          if (e.cap > 0 && level[e.to] < 0) {
            level[e.to] = level[v] + 1;
            q.push(e.to);
          }
        }
      }
      return level[t] >= 0;
    };

    const dfs = (v, f) => {
      if (v === t) return f;
      const edges = g.adj[v];
      for (; it[v] < edges.length; it[v]++) {
        const e = edges[it[v]];
        if (e.cap > 0 && level[e.to] === level[v] + 1) {
          const d = dfs(e.to, Math.min(f, e.cap));
          if (d > 0) {
            e.cap -= d;
            e.rev.cap += d;
            return d;
          }
        }
      }
      return 0;
    };

    while (bfs()) {
      it.fill(0);
      let f;
      while ((f = dfs(s, Infinity)) > 0) flow += f;
    }
    return flow;
  }

  /* 残量图中从源可达的集合 = 所有最小割源侧集合的唯一最小元 */
  function minCutSourceSet(g, s) {
    const inS = new Uint8Array(g.n);
    const q = [s];
    inS[s] = 1;
    for (let h = 0; h < q.length; h++) {
      const v = q[h];
      for (const e of g.adj[v]) {
        if (e.cap > 0 && !inS[e.to]) {
          inS[e.to] = 1;
          q.push(e.to);
        }
      }
    }
    return inS;
  }

  /* ---------------- 求解 ---------------- */
  function solve(input) {
    const errors = validate(input);
    if (errors.length) return { ok: false, errors };

    // 归一化：探针按标识升序；参考探针钳制为 0（已校验 0 在其范围内）
    const probes = input.probes
      .map((p) => ({ id: p.id, lo: p.lo, hi: p.hi }))
      .sort((a, b) => a.id - b.id);
    const pos = new Map(probes.map((p, i) => [p.id, i]));
    const refPos = pos.get(input.reference);
    probes[refPos].lo = 0;
    probes[refPos].hi = 0;

    const edges = (input.edges || []).map((e) => ({
      from: e.from,
      to: e.to,
      target: e.target,
      weight: e.weight,
    }));

    // 节点编号：0 = 源，1 = 汇，其后按探针分段，每段 hi − lo 个等级节点
    const offsets = [];
    let nodeCount = 2;
    probes.forEach((p, i) => {
      offsets[i] = nodeCount;
      nodeCount += Math.max(0, p.hi - p.lo);
    });
    const nodeOf = (i, k) => offsets[i] + (k - probes[i].lo - 1); // k ∈ (lo_i, hi_i]

    // ∞ 容量：任意可行割的有限代价上界 + 1
    let inf = 1;
    for (const e of edges) {
      const u = probes[pos.get(e.from)];
      const v = probes[pos.get(e.to)];
      const span = Math.max(v.hi, u.hi + e.target) - Math.min(v.lo, u.lo + e.target) + 1;
      inf += e.weight * span;
    }

    // 规模保护
    let arcEstimate = 0;
    probes.forEach((p) => {
      arcEstimate += Math.max(0, p.hi - p.lo - 1);
    });
    for (const e of edges) {
      const u = probes[pos.get(e.from)];
      const v = probes[pos.get(e.to)];
      arcEstimate += 2 * ((v.hi - v.lo) + (u.hi - u.lo) + 2);
    }
    if (arcEstimate > LIMITS.MAX_GRAPH_ARCS) {
      return {
        ok: false,
        errors: [{
          path: 'edges',
          message: `归约图规模（约 ${arcEstimate} 条弧）超过上限 ${LIMITS.MAX_GRAPH_ARCS}，请缩小相位范围或减少观测边`,
        }],
      };
    }

    const g = createGraph(nodeCount);
    const S = 0;
    const T = 1;

    // 单调性边：y_{i,k+1} ≤ y_{i,k}，即禁止 node(k+1) ∈ S 且 node(k) ∈ T
    probes.forEach((p, i) => {
      for (let k = p.lo + 2; k <= p.hi; k++) {
        addArc(g, nodeOf(i, k), nodeOf(i, k - 1), inf);
      }
    });

    // 观测边：w·|x_v − x_u − t| = w·Σ_k |y_{v,k} − y_{u,k−t}|
    // 常量区间（两侧指示均为常量）按段解析累加，不逐 k 展开，目标差值再大也不影响耗时。
    let constantTerm = 0;
    for (const e of edges) {
      const ui = pos.get(e.from);
      const vi = pos.get(e.to);
      const u = probes[ui];
      const v = probes[vi];
      const t = e.target;
      const w = e.weight;
      const kMin = Math.min(v.lo, u.lo + t) + 1;
      const kMax = Math.max(v.hi, u.hi + t);
      let k = kMin;
      while (k <= kMax) {
        const j = k - t;
        const aFree = k > v.lo && k <= v.hi;
        const bFree = j > u.lo && j <= u.hi;
        if (aFree || bFree) {
          const aNode = aFree ? nodeOf(vi, k) : -1;
          const bNode = bFree ? nodeOf(ui, j) : -1;
          const aC = aFree ? 0 : k <= v.lo ? 1 : 0;
          const bC = bFree ? 0 : j <= u.lo ? 1 : 0;
          if (aNode >= 0 && bNode >= 0) {
            addArc(g, aNode, bNode, w);
            addArc(g, bNode, aNode, w);
          } else if (aNode >= 0) {
            // 代价 w·|y_a − bC|：bC=1 → y_a=0 时付费（源→a）；bC=0 → y_a=1 时付费（a→汇）
            if (bC === 1) addArc(g, S, aNode, w);
            else addArc(g, aNode, T, w);
          } else if (bNode >= 0) {
            if (aC === 1) addArc(g, S, bNode, w);
            else addArc(g, bNode, T, w);
          } else {
            constantTerm += w * Math.abs(aC - bC);
          }
          k++;
        } else {
          const aC = k <= v.lo ? 1 : 0;
          const bC = j <= u.lo ? 1 : 0;
          let next = kMax + 1;
          const c1 = v.lo + 1;
          const c2 = v.hi + 1;
          const c3 = u.lo + t + 1;
          const c4 = u.hi + t + 1;
          if (c1 > k && c1 < next) next = c1;
          if (c2 > k && c2 < next) next = c2;
          if (c3 > k && c3 < next) next = c3;
          if (c4 > k && c4 < next) next = c4;
          constantTerm += w * Math.abs(aC - bC) * (next - k);
          k = next;
        }
      }
    }

    const flowValue = maxFlow(g, S, T);
    const inS = minCutSourceSet(g, S);

    // 提取相位：x_i = lo_i + Σ_k y_{i,k}，y=1 ⇔ 节点在源侧
    const phaseAt = probes.map((p, i) => {
      let x = p.lo;
      for (let k = p.lo + 1; k <= p.hi; k++) {
        if (inS[nodeOf(i, k)]) x++;
      }
      return x;
    });

    const rows = edges.map((e, i) => {
      const actual = phaseAt[pos.get(e.to)] - phaseAt[pos.get(e.from)];
      const residual = actual - e.target;
      const contribution = e.weight * Math.abs(residual);
      return {
        index: i,
        from: e.from,
        to: e.to,
        target: e.target,
        weight: e.weight,
        actual,
        residual,
        contribution,
      };
    });
    const totalCost = rows.reduce((s, r) => s + r.contribution, 0);

    return {
      ok: true,
      phases: probes.map((p, i) => ({ id: p.id, phase: phaseAt[i] })),
      totalCost,
      edges: rows,
      stats: {
        nodes: nodeCount,
        arcs: g.arcs,
        flowValue,
        constantTerm,
      },
    };
  }

  return { solve, validate, LIMITS };
});
