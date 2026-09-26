# 超导磁通探针阵列 · 整数相位面复核

相邻探针读数带有整周跳变。本应用从互相矛盾的边差观测中复原一张可用于补偿的
**整数相位面**：在所有满足范围的整数相位赋值中精确最小化

```
Σ_e  w_e · |(x_v − x_u) − t_e|
```

同成本时按探针标识升序取**字典序最小**的相位向量。不沿生成树逐边累加、不做浮点
近似、不枚举全部赋值。

## 方法：有序整数标签的凸代价 → 最小割（Ishikawa 归约）

求解完全在浏览器内的 **Web Worker** 中执行（`app/solver.js`，UMD，亦可被 Node
加载）：

1. 对每个探针 `i` 与每个等级 `k ∈ (lo_i, hi_i]` 设 0/1 指示 `y_{i,k} = [x_i ≥ k]`，
   单调性 `y_{i,k} ≥ y_{i,k+1}` 用 ∞ 容量弧强制；
2. 由分层恒等式（coarea）：`|x_v − x_u − t| = Σ_k |y_{v,k} − y_{u,k−t}|`，每一项是
   两个 0/1 变量的绝对差，用一对反向、容量各为 `w` 的弧精确表示；落在自由等级区间
   之外的指示为常量，退化为源/汇弧或常数项（常量区间按段解析累加，目标差值再大也
   不逐层展开）；
3. 全部容量为整数，用 Dinic 求最大流（纯整数运算）；
4. **字典序最小**：最大流残量图中从源可达的集合是所有最小割源侧集合的唯一最小元，
   它给出分量最小、亦即字典序最小的相位向量。

## 页面功能

- 录入 2–40 个探针（各自整数相位范围）、一个固定为 0 的参考探针、任意条带目标
  差值与正整数权重的有向观测边；
- 成功结论：每个探针相位、总代价，以及每条边的实际差、残差、贡献；
- 错误定位：范围为空（lo > hi）、参考探针范围不含 0、边端点不存在等，逐条给出
  路径与说明，并清除旧结论；
- 草稿任何修改或点击取消后，进行中的计算被终止、迟到的 Worker 结果被令牌丢弃，
  不会覆盖当前状态；
- 内置样例：闭环矛盾且局部累加非最优——沿生成树累加得 (0, 5, 10) 代价 40，
  全局最优 (0, 1, 6) 代价 4。

## 运行（Docker Compose）

```bash
# 启动静态应用（宿主机端口由 APP_PORT 配置，默认 8080）
APP_PORT=8080 docker compose up --build app
# 打开 http://localhost:8080

# 验证：代码测试 + 构建检查 + HTTP 冒烟，verify 容器完成后自行退出，
# 本命令的退出码即 verify 的退出码
docker compose up --build --exit-code-from verify verify
docker compose down
```

- `app` 服务：nginx 托管 `app/` 静态文件；健康检查直接请求应用首页
  （`wget http://127.0.0.1/`），对应静态应用可用性；
- `verify` 服务：`depends_on: service_healthy` 等待应用就绪后执行
  `npm run verify`（`node --test` → `tools/build.js` → `tools/smoke.js`），
  以退出码报告结果。

## 本地开发（无需 Docker）

```bash
npm test          # 单元测试：样例、字典序规则、错误定位、300 例暴力枚举对拍
npm run build     # 构建检查：JS 语法、HTML 资源引用、求解器自检，产出 dist/
APP_URL=http://localhost:8080 npm run smoke   # 对运行中的静态应用做 HTTP 冒烟
```

## 输入限制（求解器校验，超限逐条报错）

| 项 | 限制 |
| --- | --- |
| 探针数量 | 2–40 |
| 单探针范围宽度 hi − lo | ≤ 100 |
| 范围端点 / 目标差值 | 整数，±10⁶ 内 |
| 权重 | 正整数，≤ 10⁶ |
| 观测边数量 | ≤ 1600 |
| 归约图规模 | ≤ 10⁶ 弧 |

## 目录结构

```
app/            静态应用（index.html / app.js / worker.js / solver.js / styles.css）
tests/          node:test 单元测试（含暴力枚举对拍）
tools/build.js  构建检查
tools/smoke.js  HTTP 冒烟
Dockerfile      多阶段：verify（Node）与 app（nginx）
docker-compose.yml
```
