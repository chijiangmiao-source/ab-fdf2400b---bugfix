/*
 * Web Worker：在后台线程执行最小割求解，避免阻塞页面。
 * 每条消息携带 jobId，主线程据此丢弃过期结果（草稿修改或取消后旧计算不得覆盖当前状态）。
 */
importScripts('solver.js');

self.onmessage = function (event) {
  const data = event.data || {};
  const jobId = data.jobId;
  let result;
  try {
    result = PhaseSolver.solve(data.input);
  } catch (err) {
    result = {
      ok: false,
      errors: [{
        path: 'solver',
        message: '求解器内部错误：' + (err && err.message ? err.message : String(err)),
      }],
    };
  }
  self.postMessage({ jobId, result });
};
