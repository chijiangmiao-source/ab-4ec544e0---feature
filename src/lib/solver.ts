/**
 * 带符号排列的倒位（reversal）最优方案审计。
 *
 * 两种模式共用同一套状态编码：
 *   - 普通模式（unit）：每条倒位边代价 1，最优 = 倒位次数最少（BFS）；
 *   - 风险模式（risk）：n 个标记有 n+1 个切口风险 r_0..r_n（1..9），
 *     倒位 [i,j] 的代价 = r_{i-1} + r_j，最优 = 累计风险最低（Dijkstra）。
 *
 * 风险模式下最优方案的步数可以不同（便宜倒位可多走、贵倒位可少走），
 * 因此计数按“深度（第几步）”分层：最优路径的长度介于 minSteps 与 maxSteps
 * 之间，矩阵按实际步骤深度 0..maxSteps-1 展示，每行只统计仍包含该深度的
 * 方案（rowTotal[d]），presence 也以该行方案为比较全集。
 *
 * 状态直接用压缩整数表示（见 permutation.ts 的 encodeState，每 4 位 nibble
 * 存 token+1）。n<=7 时状态至多 2^n·n! ≈ 645120、每态至多 28 个倒位，
 * 浏览器内可即时完成，所有结果都是精确的（计数用 bigint）：
 *   - 最低代价（普通模式即最少步数）；
 *   - 全部最优方案总数（任意精度）；
 *   - 规范方案：全部最优方案中按“每步 (start,end) 序列”字典序最小者；
 *   - 深度×区间矩阵：逐格统计该倒位在多少最优方案的该深度出现。
 */

import { decodeState, encodeState, type Token } from './permutation';

/** 一次倒位：1 基闭区间 [start,end]；反转次序并翻转符号。 */
export interface InversionStep {
  start: number;
  end: number;
}

export type AuditMode = 'unit' | 'risk';

export type CellPresence = 'all' | 'some' | 'none';

export interface IntervalCell {
  start: number;
  end: number;
  /** 在深度 depth 执行该倒位的、且仍包含该深度的最优方案数量（bigint，精确） */
  pathCount: bigint;
  /** 以“仍包含该深度的方案”为比较全集的归属 */
  presence: CellPresence;
}

export interface AuditResult {
  n: number;
  mode: AuditMode;
  initial: Token[];
  /** 切口风险（普通模式为全 1），长度 n+1，下标与切口一一对应 */
  risks: number[];
  /** 最优累计代价：普通模式为倒位步数，风险模式为累计风险 */
  minCost: number;
  /** 最优方案中的最少步数（普通模式下即 minCost） */
  distance: number;
  /** 最优方案中最长轨迹的步数（普通模式所有方案等长，等于 distance） */
  maxSteps: number;
  /** 最优方案中最短轨迹的步数 */
  minSteps: number;
  /** 全部最优方案总数（任意精度） */
  totalPaths: bigint;
  /** 规范方案：全部最优方案中每步 (start,end) 序列字典序最小者 */
  canonical: {
    steps: InversionStep[];
    states: Token[][];
  };
  /**
   * 深度×区间矩阵。matrix[d] 给出深度 d（第 d+1 步）各区间的出现统计，
   * 区间按 (start,end) 字典序排列；depth 0 对应初始态的第一步。
   * 矩阵共 maxSteps 行，每行只统计仍包含该深度的最优方案。
   */
  matrix: {
    depth: number;
    /** 该行的比较全集：仍包含该深度（即至少走了 d+1 步）的最优方案数 */
    rowTotal: bigint;
    intervals: IntervalCell[];
  }[];
}

/**
 * 在压缩状态 code 上枚举全部倒位邻居，按 (i,j) 字典序回调，零数组分配。
 * edgeCosts 给出每个区间（按枚举顺序，即 (start,end) 字典序）的边代价；
 * 为 null 时单位代价。
 */
function eachNeighbor(
  code: number,
  n: number,
  edgeCosts: Int16Array | null,
  cb: (nextCode: number, start: number, end: number, cost: number) => void,
): void {
  let edgeIdx = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let nextCode = code;
      // 先把区间内各位清零（取区间外的 nibble），再按反转+翻转填回。
      let mask = 0;
      for (let k = i; k <= j; k += 1) mask |= 0x0f << (4 * k);
      nextCode &= ~mask;
      for (let k = i; k <= j; k += 1) {
        // 存储 nibble = token+1；翻转后的存储值为 ((token ^ 1) + 1)。
        const stored = (code >>> (4 * (i + j - k))) & 0x0f;
        const flipped = ((stored - 1) ^ 1) + 1;
        nextCode |= flipped << (4 * k);
      }
      cb(nextCode, i + 1, j + 1, edgeCosts ? edgeCosts[edgeIdx] : 1);
      edgeIdx += 1;
    }
  }
}

function identityCode(n: number): number {
  let code = 0;
  for (let k = 0; k < n; k += 1) code |= (2 * k + 1) << (4 * k);
  return code;
}

/** 全部区间按 (start,end) 字典序；第 k 个区间的代价 = r[start-1] + r[end]。 */
function buildEdgeCosts(n: number, risks: number[]): Int16Array {
  const costs = new Int16Array((n * (n + 1)) / 2);
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      costs[k] = risks[i] + risks[j + 1];
      k += 1;
    }
  }
  return costs;
}

/** 普通模式：每边代价 1。 */
export function solve(initial: Token[]): AuditResult {
  return solveWeighted(initial, null, 'unit');
}

/**
 * 风险模式：risks 为长度 n+1 的切口风险（1..9）。
 * edgeCosts 为 null 时退化为单位代价（与普通模式完全一致的结果）。
 */
export function solveWeighted(
  initial: Token[],
  risks: number[] | null,
  mode: AuditMode,
): AuditResult {
  const n = initial.length;
  const cutRisks = risks ?? new Array<number>(n + 1).fill(1);
  const edgeCosts = risks ? buildEdgeCosts(n, cutRisks) : null;

  const goalCode = identityCode(n);
  const startCode = encodeState(initial);

  if (startCode === goalCode) {
    // 全正顺序：代价 0、方案 1（空序列），矩阵为空。
    return {
      n,
      mode,
      initial,
      risks: cutRisks.slice(),
      minCost: 0,
      distance: 0,
      maxSteps: 0,
      minSteps: 0,
      totalPaths: 1n,
      canonical: { steps: [], states: [initial.slice()] },
      matrix: [],
    };
  }

  /* ------------------------------------------------------------------ *
   * 1) 前向 Dijkstra（单位代价时即 BFS）求 distF：初始态到各态的最低
   *    累计代价。桶式优先队列（边代价为整数：单位恒 1，风险 2..18），
   *    目标态一经 settle 即停止，故 distF 只覆盖代价 <= minCost 的态，
   *    而最优 DAG 上的态必然全部在内。
   * ------------------------------------------------------------------ */
  const distF = new Map<number, number>();
  // 普通模式：首次到达父边（BFS 邻居按字典序枚举）即规范父边。
  const bfsParent = new Map<
    number,
    { code: number; start: number; end: number }
  >();
  const buckets = new Map<number, number[]>();
  let minBucket = 0;

  distF.set(startCode, 0);
  buckets.set(0, [startCode]);

  let settled = false;
  while (!settled) {
    let bucket = buckets.get(minBucket);
    while (!bucket || bucket.length === 0) {
      buckets.delete(minBucket);
      minBucket += 1;
      bucket = buckets.get(minBucket);
    }
    // 保持插入顺序：单位代价时首次到达顺序决定规范父边（BFS 语义），
    // 风险模式的规范序列由 1b) 的独立 DP 计算，与此顺序无关。
    const current = bucket;
    buckets.delete(minBucket);

    for (const code of current) {
      if (distF.get(code) !== minBucket) continue; // 高代价桶中的过期条目
      if (code === goalCode) {
        settled = true;
        break;
      }
      eachNeighbor(code, n, edgeCosts, (nextCode, start, end, cost) => {
        const nd = minBucket + cost;
        const prev = distF.get(nextCode);
        if (prev !== undefined && prev <= nd) return;
        distF.set(nextCode, nd);
        if (edgeCosts === null && prev === undefined) {
          bfsParent.set(nextCode, { code, start, end });
        }
        const list = buckets.get(nd);
        if (list) list.push(nextCode);
        else buckets.set(nd, [nextCode]);
      });
    }
  }

  const minCost = distF.get(goalCode)!;

  /* ------------------------------------------------------------------ *
   * 2) 反向收集最优 DAG（倒位自逆，正反向边代价相同）。从目标出发做
   *    无权 BFS：v 的邻居 u 满足 distF(u)+w(u,v)=distF(v) 时 u 在某条
   *    最优路径上。BFS 层数即 distR（沿最优 DAG 到目标的最少步数）。
   *    后续所有统计（规范序列、路径数、矩阵）都只在该 DAG 上进行。
   * ------------------------------------------------------------------ */
  const distR = new Map<number, number>();
  const dag: number[] = [];
  {
    distR.set(goalCode, 0);
    dag.push(goalCode);
    let head = 0;
    while (head < dag.length) {
      const v = dag[head++];
      const dv = distF.get(v)!;
      eachNeighbor(v, n, edgeCosts, (u, _s, _e, cost) => {
        const du = distF.get(u);
        if (du === undefined || du + cost !== dv) return; // 非最优边
        if (!distR.has(u)) {
          distR.set(u, distR.get(v)! + 1);
          dag.push(u);
        }
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 1b) 规范前驱。要求：在全部最优方案（步数可不同）中，取每步
   *     (start,end) 序列字典序最小者；字典序按“元素逐项比较、短序列
   *     仅在作为真前缀时更小”定义。
   *     - 单位代价：所有最优方案等长，BFS 首次到达父边（邻居按字典序
   *       枚举）即为规范父边；
   *     - 风险代价：边权严格为正，最优入边 (u,e) 满足 distF(u)<distF(v)，
   *       按代价层递增处理最优 DAG 中的节点时，所有候选前驱的规范序列
   *       已定。每个区间按其 (start,end) 字典序编号编码为一个字符，
   *       字符串的原生字典序恰好等于步骤序列的字典序（含真前缀规则）。
   * ------------------------------------------------------------------ */
  const canonParent = new Map<number, { code: number; start: number; end: number }>();
  if (edgeCosts === null) {
    for (const [code, p] of bfsParent) {
      if (distR.has(code)) canonParent.set(code, p);
    }
  } else {
    // 区间字典序编号（与 eachNeighbor 的枚举顺序一致）。
    const edgeChar = new Map<string, string>();
    {
      let idx = 0;
      for (let i = 0; i < n; i += 1) {
        for (let j = i; j < n; j += 1) {
          edgeChar.set(`${i + 1}:${j + 1}`, String.fromCharCode(33 + idx));
          idx += 1;
        }
      }
    }
    const byCost = new Map<number, number[]>();
    for (const code of dag) {
      if (code === startCode) continue;
      const cost = distF.get(code)!;
      const list = byCost.get(cost);
      if (list) list.push(code);
      else byCost.set(cost, [code]);
    }
    const canonKey = new Map<number, string>([[startCode, '']]);

    for (const cost of [...byCost.keys()].sort((a, b) => a - b)) {
      for (const v of byCost.get(cost)!) {
        let best: { code: number; start: number; end: number } | null = null;
        let bestKey: string | null = null;
        eachNeighbor(v, n, edgeCosts, (u, start, end, w) => {
          const ku = canonKey.get(u);
          if (ku === undefined) return; // u 无最优路径（理论上 DAG 内不会发生）
          if (distF.get(u)! + w !== cost) return; // 非最优入边
          const candidate = ku + edgeChar.get(`${start}:${end}`)!;
          if (bestKey === null || candidate < bestKey) {
            bestKey = candidate;
            best = { code: u, start, end };
          }
        });
        if (best) {
          canonParent.set(v, best);
          canonKey.set(v, bestKey!);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 2b) waysToGoal（最优路径条数，bigint）与 tailMax（最多步数）。
   *     最优后继 u 的代价严格更大，按 distF 降序处理即可：
   *       ways[v] = Σ 最优后继 u 的 ways[u]
   *       tailMax[v] = 1 + max tailMax[u]（目标态为 0）
   * ------------------------------------------------------------------ */
  const waysToGoal = new Map<number, bigint>();
  const tailMax = new Map<number, number>();
  {
    const byDescCost = dag.slice().sort((a, b) => distF.get(b)! - distF.get(a)!);
    for (const v of byDescCost) {
      if (v === goalCode) {
        waysToGoal.set(v, 1n);
        tailMax.set(v, 0);
        continue;
      }
      let ways = 0n;
      let tMax = 0;
      const dv = distF.get(v)!;
      eachNeighbor(v, n, edgeCosts, (u, _s, _e, cost) => {
        if (distF.get(u) === undefined) return;
        if (dv + cost !== distF.get(u)!) return; // 非最优出边
        if (!waysToGoal.has(u)) return; // u 不在最优 DAG（到不了目标）
        ways += waysToGoal.get(u)!;
        const cand = tailMax.get(u)! + 1;
        if (cand > tMax) tMax = cand;
      });
      waysToGoal.set(v, ways);
      tailMax.set(v, tMax);
    }
  }

  const totalPaths = waysToGoal.get(startCode)!;
  const minSteps = distR.get(startCode)!;
  const maxSteps = tailMax.get(startCode)!;
  const distance = minSteps;

  /* ------------------------------------------------------------------ *
   * 3) 逐“步骤深度”枚举最优 DAG 上的边 (u,v)。单位代价下最优路径等长，
   *    深度即代价层；风险代价下最优路径长度可不同，按已走步数推进：
   *    waysFrom[d][u] = 以恰好 d 步（累计代价恰为 distF[u]）到达 u 的
   *    最优前缀条数。边方案数 = 前缀条数 × waysToGoal[v]。
   *    rowTotal[d] = 仍包含深度 d 的方案数（第 d 层各 u 的
   *    前缀数 × waysToGoal[u] 之和），也是该行 presence 的比较全集。
   * ------------------------------------------------------------------ */
  const matrix: AuditResult['matrix'] = [];
  let waysFrom = new Map<number, bigint>([[startCode, 1n]]);

  // 全部区间按 (start,end) 字典序预登记，任何最优方案都没用到的保持 none。
  const allIntervals: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      allIntervals.push({ start: i + 1, end: j + 1 });
    }
  }

  for (let d = 0; d < maxSteps; d += 1) {
    const counts = new Map<string, bigint>();
    for (const { start, end } of allIntervals) {
      counts.set(`${start}:${end}`, 0n);
    }
    const nextWaysFrom = new Map<number, bigint>();
    let rowTotal = 0n;

    for (const [uCode, waysU] of waysFrom) {
      if (uCode === goalCode) continue; // 已结束的方案不再包含后续深度
      rowTotal += waysU * waysToGoal.get(uCode)!;
      eachNeighbor(uCode, n, edgeCosts, (nextCode, start, end, cost) => {
        // 只保留最优 DAG 上的边。
        if (distF.get(uCode)! + cost !== distF.get(nextCode)!) return;
        if (!distR.has(nextCode)) return;
        const key = `${start}:${end}`;
        counts.set(key, counts.get(key)! + waysU * waysToGoal.get(nextCode)!);
        if (nextCode !== goalCode) {
          nextWaysFrom.set(
            nextCode,
            (nextWaysFrom.get(nextCode) ?? 0n) + waysU,
          );
        }
      });
    }

    const intervals: IntervalCell[] = allIntervals.map(({ start, end }) => {
      const pathCount = counts.get(`${start}:${end}`)!;
      const presence: CellPresence =
        pathCount === 0n ? 'none' : pathCount === rowTotal ? 'all' : 'some';
      return { start, end, pathCount, presence };
    });
    matrix.push({ depth: d, rowTotal, intervals });
    waysFrom = nextWaysFrom;
  }

  /* ------------------------------------------------------------------ *
   * 4) 规范路径：沿规范前驱回溯到初始态，再反序；同步记录各深度状态。
   * ------------------------------------------------------------------ */
  const steps: InversionStep[] = [];
  const statesReversed: Token[][] = [decodeState(goalCode, n)];
  let cursor = goalCode;
  while (cursor !== startCode) {
    const p = canonParent.get(cursor)!;
    steps.push({ start: p.start, end: p.end });
    statesReversed.push(decodeState(p.code, n));
    cursor = p.code;
  }
  steps.reverse();
  statesReversed.reverse();

  return {
    n,
    mode,
    initial,
    risks: cutRisks.slice(),
    minCost,
    distance,
    maxSteps,
    minSteps,
    totalPaths,
    canonical: { steps, states: statesReversed },
    matrix,
  };
}

/** Worker 传输用 DTO：bigint 不能依赖所有环境的结构化克隆，统一转十进制字符串。 */
export interface AuditResultDTO {
  n: number;
  mode: AuditMode;
  initial: Token[];
  risks: number[];
  minCost: number;
  distance: number;
  maxSteps: number;
  minSteps: number;
  totalPaths: string;
  canonical: {
    steps: InversionStep[];
    states: Token[][];
  };
  matrix: {
    depth: number;
    rowTotal: string;
    intervals: {
      start: number;
      end: number;
      pathCount: string;
      presence: CellPresence;
    }[];
  }[];
}

export function toDTO(result: AuditResult): AuditResultDTO {
  return {
    n: result.n,
    mode: result.mode,
    initial: result.initial,
    risks: result.risks,
    minCost: result.minCost,
    distance: result.distance,
    maxSteps: result.maxSteps,
    minSteps: result.minSteps,
    totalPaths: result.totalPaths.toString(),
    canonical: result.canonical,
    matrix: result.matrix.map((layer) => ({
      depth: layer.depth,
      rowTotal: layer.rowTotal.toString(),
      intervals: layer.intervals.map((cell) => ({
        start: cell.start,
        end: cell.end,
        pathCount: cell.pathCount.toString(),
        presence: cell.presence,
      })),
    })),
  };
}

export function fromDTO(dto: AuditResultDTO): AuditResult {
  return {
    n: dto.n,
    mode: dto.mode,
    initial: dto.initial,
    risks: dto.risks,
    minCost: dto.minCost,
    distance: dto.distance,
    maxSteps: dto.maxSteps,
    minSteps: dto.minSteps,
    totalPaths: BigInt(dto.totalPaths),
    canonical: dto.canonical,
    matrix: dto.matrix.map((layer) => ({
      depth: layer.depth,
      rowTotal: BigInt(layer.rowTotal),
      intervals: layer.intervals.map((cell) => ({
        start: cell.start,
        end: cell.end,
        pathCount: BigInt(cell.pathCount),
        presence: cell.presence,
      })),
    })),
  };
}
