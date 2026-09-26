/*
 * 页面逻辑：草稿录入、调用 Web Worker 复核、渲染结论。
 * 关键约束：草稿修改或取消后，旧计算（迟到的 Worker 消息）不得覆盖当前状态。
 * 实现：单调递增的运行令牌 + 每次求解/修改/取消时 terminate 旧 Worker；
 * 仅当回包 jobId 与当前令牌一致时才采纳结果。
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  /* 内置样例：闭环矛盾，且沿生成树逐边累加非最优（累加代价 40，全局最优 4）。 */
  const SAMPLE = {
    probes: [
      { lo: '-20', hi: '20' },
      { lo: '-20', hi: '20' },
      { lo: '-20', hi: '20' },
    ],
    reference: 0,
    edges: [
      { from: 0, to: 1, target: '5', weight: '1' },
      { from: 1, to: 2, target: '5', weight: '1' },
      { from: 0, to: 2, target: '6', weight: '10' },
    ],
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const state = clone(SAMPLE);

  /* ---------------- 过期计算防护 ---------------- */
  let runToken = 0; // 每次求解、草稿修改、取消都使其 +1
  let worker = null;
  let busy = false;

  function updateButtons() {
    $('#solve').disabled = busy;
    $('#cancel').disabled = !busy;
  }

  function invalidateRun() {
    runToken++;
    if (worker) {
      worker.terminate();
      worker = null;
    }
    const wasBusy = busy;
    busy = false;
    updateButtons();
    return wasBusy;
  }

  function setStatus(text) {
    $('#status').textContent = text;
  }

  function clearResult() {
    const el = $('#result');
    el.hidden = true;
    el.replaceChildren();
  }

  function clearErrors() {
    const el = $('#errors');
    el.hidden = true;
    el.replaceChildren();
  }

  /* 草稿任何修改：作废旧计算、清除旧结论与旧错误 */
  function draftChanged() {
    const wasBusy = invalidateRun();
    clearResult();
    clearErrors();
    setStatus(wasBusy
      ? '草稿已修改：进行中的计算已中止，旧结论已清除。'
      : '草稿已修改：旧结论已清除，请重新发起复核。');
  }

  /* ---------------- DOM 构造 ---------------- */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
      }
    }
    for (const c of children) node.appendChild(c);
    return node;
  }

  function numInput(value, dataset) {
    const input = el('input', { type: 'number', step: '1' });
    input.value = value;
    Object.assign(input.dataset, dataset);
    return input;
  }

  function renderProbes() {
    const tbody = $('#probe-table tbody');
    tbody.replaceChildren();
    state.probes.forEach((p, i) => {
      const radio = el('input', { type: 'radio', name: 'reference', value: String(i) });
      radio.checked = i === state.reference;
      tbody.appendChild(el('tr', null,
        el('td', { class: 'pid', text: 'P' + i }),
        el('td', null, numInput(p.lo, { probe: String(i), field: 'lo' })),
        el('td', null, numInput(p.hi, { probe: String(i), field: 'hi' })),
        el('td', null, radio),
      ));
    });
  }

  function probeSelect(value, dataset) {
    const sel = el('select');
    state.probes.forEach((_, i) => {
      sel.appendChild(el('option', { value: String(i), text: 'P' + i }));
    });
    sel.value = String(value);
    if (sel.value === '') sel.value = '0';
    Object.assign(sel.dataset, dataset);
    return sel;
  }

  function renderEdges() {
    const tbody = $('#edge-table tbody');
    tbody.replaceChildren();
    state.edges.forEach((e, i) => {
      const del = el('button', { type: 'button', class: 'danger', text: '删除' });
      del.dataset.action = 'delete';
      del.dataset.edge = String(i);
      tbody.appendChild(el('tr', null,
        el('td', { text: '#' + i }),
        el('td', null, probeSelect(e.from, { edge: String(i), field: 'from' })),
        el('td', null, probeSelect(e.to, { edge: String(i), field: 'to' })),
        el('td', null, numInput(e.target, { edge: String(i), field: 'target' })),
        el('td', null, numInput(e.weight, { edge: String(i), field: 'weight' })),
        el('td', null, del),
      ));
    });
  }

  /* ---------------- 草稿事件 ---------------- */
  function resizeProbes(n) {
    while (state.probes.length < n) state.probes.push({ lo: '-20', hi: '20' });
    state.probes.length = n;
    if (state.reference >= n) state.reference = 0;
    for (const e of state.edges) {
      e.from = Math.min(Number(e.from) || 0, n - 1);
      e.to = Math.min(Number(e.to) || 0, n - 1);
    }
  }

  function onInput(event) {
    const t = event.target;
    const d = t.dataset;
    let structural = false;
    if (t.id === 'probe-count') {
      const n = Number(t.value);
      if (Number.isInteger(n) && n >= 2 && n <= 40) {
        resizeProbes(n);
        structural = true;
      }
    } else if (d.probe !== undefined && d.field) {
      state.probes[Number(d.probe)][d.field] = t.value;
    } else if (d.edge !== undefined && d.field) {
      state.edges[Number(d.edge)][d.field] = t.value;
    } else if (t.name === 'reference') {
      state.reference = Number(t.value);
    } else {
      return;
    }
    if (structural) {
      renderProbes();
      renderEdges();
    }
    draftChanged();
  }

  function onEdgeTableClick(event) {
    const t = event.target;
    if (t.dataset && t.dataset.action === 'delete') {
      state.edges.splice(Number(t.dataset.edge), 1);
      renderEdges();
      draftChanged();
    }
  }

  /* ---------------- 输入收集与本地校验 ---------------- */
  function collectInput() {
    const errors = [];
    const intField = (raw, path, what) => {
      const v = Number(raw);
      if (raw === '' || !Number.isInteger(v)) {
        errors.push({ path, message: `${what} 须为整数（当前：“${raw}”）` });
        return 0;
      }
      return v;
    };
    const probes = state.probes.map((p, i) => ({
      id: i,
      lo: intField(p.lo, `probes[${i}].lo`, `探针 P${i} 的相位下限`),
      hi: intField(p.hi, `probes[${i}].hi`, `探针 P${i} 的相位上限`),
    }));
    const edges = state.edges.map((e, i) => ({
      from: Number(e.from),
      to: Number(e.to),
      target: intField(e.target, `edges[${i}].target`, `边 #${i} 的目标差值`),
      weight: intField(e.weight, `edges[${i}].weight`, `边 #${i} 的权重`),
    }));
    return { input: { probes, reference: state.reference, edges }, errors };
  }

  /* ---------------- 渲染 ---------------- */
  function renderErrors(errors) {
    const box = $('#errors');
    box.replaceChildren();
    box.hidden = false;
    box.appendChild(el('h2', { text: '输入错误（已定位）' }));
    const ul = el('ul');
    for (const e of errors) {
      const li = el('li');
      li.appendChild(el('code', { text: e.path }));
      li.append('：' + e.message);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  function renderResult(r) {
    const box = $('#result');
    box.replaceChildren();
    box.hidden = false;
    box.appendChild(el('h2', { text: '复核结论' }));

    const summary = el('p');
    summary.append('总代价 ');
    summary.appendChild(el('strong', { class: 'cost', text: String(r.totalCost) }));
    summary.append('（同成本下已按探针标识升序取字典序最小相位向量；最小割图 ');
    summary.append(String(r.stats.nodes) + ' 节点 / ' + String(r.stats.arcs) + ' 弧）');
    box.appendChild(summary);

    box.appendChild(el('h3', { text: '各探针相位' }));
    const pt = el('table', { class: 'data' });
    pt.appendChild(el('thead', null, el('tr', null,
      el('th', { text: '探针' }), el('th', { text: '相位 x' }))));
    const pb = el('tbody');
    for (const p of r.phases) {
      pb.appendChild(el('tr', null,
        el('td', { text: 'P' + p.id }),
        el('td', { text: String(p.phase) })));
    }
    pt.appendChild(pb);
    box.appendChild(pt);

    box.appendChild(el('h3', { text: '各观测边明细' }));
    const et = el('table', { class: 'data' });
    const head = el('tr', null);
    for (const h of ['#', '边', '目标 t', '权重 w', '实际差 xᵥ−xᵤ', '残差', '贡献 w·|残差|']) {
      head.appendChild(el('th', { text: h }));
    }
    et.appendChild(el('thead', null, head));
    const eb = el('tbody');
    for (const row of r.edges) {
      eb.appendChild(el('tr', null,
        el('td', { text: '#' + row.index }),
        el('td', { text: `P${row.from} → P${row.to}` }),
        el('td', { text: String(row.target) }),
        el('td', { text: String(row.weight) }),
        el('td', { text: String(row.actual) }),
        el('td', { text: String(row.residual) }),
        el('td', { text: String(row.contribution) })));
    }
    et.appendChild(eb);
    box.appendChild(et);
  }

  /* ---------------- 求解 / 取消 ---------------- */
  function onSolve() {
    invalidateRun();
    clearErrors();
    clearResult();

    const { input, errors } = collectInput();
    if (errors.length) {
      renderErrors(errors);
      setStatus('复核未发起：请先修正输入错误。');
      return;
    }

    const token = runToken;
    busy = true;
    updateButtons();
    setStatus('正在复核：Worker 内构造最小割图并求最大流…');

    let w;
    try {
      w = new Worker('worker.js');
    } catch (err) {
      busy = false;
      updateButtons();
      renderErrors([{ path: 'worker', message: '无法创建 Worker：' + err.message }]);
      setStatus('复核失败。');
      return;
    }
    worker = w;

    w.onmessage = (event) => {
      const data = event.data || {};
      if (data.jobId !== token || token !== runToken) return; // 过期计算，丢弃
      busy = false;
      updateButtons();
      const r = data.result;
      if (r && r.ok) {
        renderResult(r);
        setStatus('复核完成。');
      } else {
        renderErrors((r && r.errors) || [{ path: 'solver', message: '未知求解错误' }]);
        clearResult();
        setStatus('复核失败：输入存在错误，旧结论已清除。');
      }
    };
    w.onerror = (event) => {
      if (token !== runToken) return; // 过期 Worker，忽略
      busy = false;
      updateButtons();
      renderErrors([{ path: 'worker', message: event.message || 'Worker 执行异常' }]);
      clearResult();
      setStatus('复核失败：Worker 异常，旧结论已清除。');
    };
    w.postMessage({ jobId: token, input });
  }

  function onCancel() {
    invalidateRun();
    setStatus('已取消：进行中的计算已丢弃，不会产生新结论。');
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    renderProbes();
    renderEdges();
    updateButtons();
    $('#probe-count').value = String(state.probes.length);
    setStatus('就绪。已载入闭环矛盾样例，可直接复核或修改草稿。');

    document.getElementById('app').addEventListener('input', onInput);
    $('#edge-table').addEventListener('click', onEdgeTableClick);
    $('#add-edge').addEventListener('click', () => {
      const last = state.edges[state.edges.length - 1];
      state.edges.push(last
        ? Object.assign({}, last)
        : { from: 0, to: Math.min(1, state.probes.length - 1), target: '0', weight: '1' });
      renderEdges();
      draftChanged();
    });
    $('#load-sample').addEventListener('click', () => {
      const s = clone(SAMPLE);
      state.probes = s.probes;
      state.reference = s.reference;
      state.edges = s.edges;
      $('#probe-count').value = String(s.probes.length);
      renderProbes();
      renderEdges();
      draftChanged();
      setStatus('已载入样例：闭环矛盾，逐边累加非最优。请发起复核。');
    });
    $('#solve').addEventListener('click', onSolve);
    $('#cancel').addEventListener('click', onCancel);
  }

  init();
})();
