/**
 * 带符号排列的倒位（reversal）最优方案审计。
 *
 * 状态直接用压缩整数表示（见 permutation.ts 的 encodeState，每 4 位 nibble
 * 存 token+1）。倒位邻居完全用位运算枚举：在区间 [i,j] 上，新状态第 k 位的
 * nibble 为旧状态第 i+j-k 位 nibble 先翻转符号（token ^ 1）再加 1。
 *
 * 两种模式：
 *   - 普通模式（solve）：每条倒位代价 1，枚举全部**步数最少**方案，BFS 精确求解；
 *   - 风险模式（solveWeighted）：n+1 个切口各带 1..9 的风险，区间 [i,j] 的代价
 *     为两端切口风险之和（2..18 的正整数），枚举全部**累计风险最低**方案。
 *     同优方案的步数可以不同，因此：
 *       - 最短路用 Dial 桶式 Dijkstra（边权为小整数）；
 *       - 方案数 / 逐深度计数在“按精确深度分层的最优子图”上做 bigint DP，
 *         步数较长的同优方案不会被截断，也不会跨深度重复计数；
 *       - 矩阵第 d 行的比较全集是“在第 d 层仍存活”的方案（长度 > d），
 *         行数覆盖最长同优轨迹；
 *       - 规范轨迹按每步 (start,end) 序列字典序，用“始终选择可收尾的最小边”
 *         的贪心从初始态构造，正确处理不同长度的同优方案。
 *
 * 全部切口等权（均为 r）时，每条路径风险 = 2r × 步数，风险最优方案集合恰为
 * 步数最少方案集合；此时直接复用 BFS 结果，保证与普通模式完全一致。
 */

import { decodeState, encodeState, type Token } from './permutation';

/** 一次倒位：1 基闭区间 [start,end]；反转次序并翻转符号。 */
export interface InversionStep {
  start: number;
  end: number;
}

export type AuditMode = 'steps' | 'risk';
export type CellPresence = 'all' | 'some' | 'none';

export interface IntervalCell {
  start: number;
  end: number;
  /** 在深度 depth 执行该倒位的（最低代价）方案数量（bigint，精确） */
  pathCount: bigint;
  presence: CellPresence;
}

export interface MatrixLayer {
  /** depth d（第 d+1 步） */
  depth: number;
  intervals: IntervalCell[];
  /**
   * 比较全集：在深度 d 仍存活（长度 > d）的最低代价方案数量。
   * 普通模式下每行都等于方案总数；风险模式下较长轨迹占多数，
   * 较短方案在其结束深度之后退出全集。
   */
  aliveCount: bigint;
}

export interface AuditResult {
  n: number;
  initial: Token[];
  mode: AuditMode;
  /** 风险模式下的 n+1 个切口风险；普通模式为 null */
  risks: number[] | null;
  /** 规范轨迹的倒位步数（风险模式下同优方案步数可能不同） */
  distance: number;
  /** 最低累计代价：普通模式为最少步数，风险模式为最低累计风险 */
  optimalCost: number;
  /** 全部最低代价方案总数（任意精度） */
  totalPaths: bigint;
  /** 规范方案：全部最优方案中每步 (start,end) 序列字典序最小者 */
  canonical: {
    steps: InversionStep[];
    states: Token[][];
  };
  /**
   * 深度×区间矩阵。matrix[d] 给出深度 d（第 d+1 步）各区间的出现统计，
   * 区间按 (start,end) 字典序排列；depth 0 对应初始态的第一步。
   * 行数覆盖最长同优轨迹（其最后一个有边的深度）。
   */
  matrix: MatrixLayer[];
}

/** 在压缩状态 code 上枚举全部倒位邻居，按 (i,j) 字典序回调，零数组分配。 */
function eachNeighbor(
  code: number,
  n: number,
  cb: (nextCode: number, start: number, end: number) => void,
): void {
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
      cb(nextCode, i + 1, j + 1);
    }
  }
}

function identityCode(n: number): number {
  let code = 0;
  for (let k = 0; k < n; k += 1) code |= (2 * k + 1) << (4 * k);
  return code;
}

/** 全部区间按 (start,end) 字典序。 */
function buildAllIntervals(n: number): { start: number; end: number }[] {
  const all: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      all.push({ start: i + 1, end: j + 1 });
    }
  }
  return all;
}

function emptyResult(
  initial: Token[],
  mode: AuditMode,
  risks: number[] | null,
): AuditResult {
  return {
    n: initial.length,
    initial,
    mode,
    risks,
    distance: 0,
    optimalCost: 0,
    totalPaths: 1n,
    canonical: { steps: [], states: [initial.slice()] },
    matrix: [],
  };
}

/* ==================================================================== *
 * 普通模式：每条倒位代价 1（原最少步数审计，行为保持不变）。
 * ==================================================================== */

export function solve(initial: Token[]): AuditResult {
  const n = initial.length;
  const goalCode = identityCode(n);
  const startCode = encodeState(initial);

  if (startCode === goalCode) {
    // 全正顺序：距离 0、方案 1（空序列），矩阵为空。
    return emptyResult(initial, 'steps', null);
  }

  /* ------------------------------------------------------------------ *
   * 1) 前向 BFS：distF（初始态 -> 各态）与规范父边。
   *    邻居按 (start,end) 字典序枚举，首次到达的父边即字典序最早者，
   *    沿它回溯得到规范方案。
   * ------------------------------------------------------------------ */
  const distF = new Map<number, number>();
  const parent = new Map<number, { code: number; start: number; end: number }>();
  {
    const queue: number[] = [startCode];
    distF.set(startCode, 0);
    let head = 0;
    while (head < queue.length) {
      const code = queue[head++];
      const d = distF.get(code)!;
      if (code === goalCode) break; // 队列按层推进，到达目标即最短层
      eachNeighbor(code, n, (nextCode, start, end) => {
        if (!distF.has(nextCode)) {
          distF.set(nextCode, d + 1);
          parent.set(nextCode, { code, start, end });
          queue.push(nextCode);
        }
      });
    }
  }

  const distance = distF.get(goalCode)!;

  /* ------------------------------------------------------------------ *
   * 2) 反向 BFS（倒位自逆，邻居枚举相同），只保留位于某条最短路径上
   *    的状态（distF <= distance）。分层汇总 waysToGoal：
   *    v 到目标的最短路径条数。
   * ------------------------------------------------------------------ */
  const distR = new Map<number, number>();
  const waysToGoal = new Map<number, bigint>();
  const layers: number[][] = [];
  {
    distR.set(goalCode, 0);
    waysToGoal.set(goalCode, 1n);
    layers.push([goalCode]);
    for (let d = 0; d < distance; d += 1) {
      const nextLayer: number[] = [];
      for (const code of layers[d]) {
        eachNeighbor(code, n, (nextCode) => {
          if (distR.has(nextCode)) return;
          const fd = distF.get(nextCode);
          if (fd === undefined || fd > distance) return;
          distR.set(nextCode, d + 1);
          waysToGoal.set(nextCode, 0n);
          nextLayer.push(nextCode);
        });
      }
      layers.push(nextLayer);
    }
    // layers[d] 中状态到目标的距离为 d，其最短后继位于 layers[d-1]。
    for (let d = 1; d <= distance; d += 1) {
      for (const code of layers[d]) {
        let ways = 0n;
        eachNeighbor(code, n, (nextCode) => {
          if (distR.get(nextCode) === d - 1) {
            ways += waysToGoal.get(nextCode)!;
          }
        });
        waysToGoal.set(code, ways);
      }
    }
  }

  const totalPaths = waysToGoal.get(startCode)!;

  /* ------------------------------------------------------------------ *
   * 3) 逐层枚举最短边 (u,v)：distF[u]=d、distR[v]=distance-d-1。
   *    边方案数 = waysFromStart(u) * waysToGoal(v)，按区间聚合到矩阵格；
   *    waysFromStart 随层滚动。每条最短方案在每个深度 0..distance-1
   *    都恰好有一步，故每行比较全集恒为方案总数。
   * ------------------------------------------------------------------ */
  const matrix: MatrixLayer[] = [];
  let waysFrom = new Map<number, bigint>([[startCode, 1n]]);

  // 全部区间按 (start,end) 字典序预登记，任何最短方案都没用到的保持 none。
  const allIntervals = buildAllIntervals(n);

  for (let d = 0; d < distance; d += 1) {
    const counts = new Map<string, bigint>();
    for (const { start, end } of allIntervals) {
      counts.set(`${start}:${end}`, 0n);
    }
    const nextWaysFrom = new Map<number, bigint>();

    for (const [uCode, waysU] of waysFrom) {
      eachNeighbor(uCode, n, (nextCode, start, end) => {
        if (distF.get(nextCode) !== d + 1) return;
        if (distR.get(nextCode) !== distance - d - 1) return;
        const key = `${start}:${end}`;
        counts.set(key, counts.get(key)! + waysU * waysToGoal.get(nextCode)!);
        nextWaysFrom.set(nextCode, (nextWaysFrom.get(nextCode) ?? 0n) + waysU);
      });
    }

    matrix.push({
      depth: d,
      aliveCount: totalPaths,
      intervals: allIntervals.map(({ start, end }) => {
        const pathCount = counts.get(`${start}:${end}`)!;
        const presence: CellPresence =
          pathCount === totalPaths ? 'all' : pathCount === 0n ? 'none' : 'some';
        return { start, end, pathCount, presence };
      }),
    });
    waysFrom = nextWaysFrom;
  }

  /* ------------------------------------------------------------------ *
   * 4) 规范路径：沿前向 BFS 的最早父边回溯到初始态，再反序。
   * ------------------------------------------------------------------ */
  const steps: InversionStep[] = [];
  const statesReversed: Token[][] = [decodeState(goalCode, n)];
  let cursor = goalCode;
  while (cursor !== startCode) {
    const p = parent.get(cursor)!;
    steps.push({ start: p.start, end: p.end });
    statesReversed.push(decodeState(p.code, n));
    cursor = p.code;
  }
  steps.reverse();
  statesReversed.reverse();

  return {
    n,
    initial,
    mode: 'steps',
    risks: null,
    distance,
    optimalCost: distance,
    totalPaths,
    canonical: { steps, states: statesReversed },
    matrix,
  };
}

/* ==================================================================== *
 * 风险模式：区间 [i,j] 代价 = risks[i] + risks[j+1]（正整数小权值）。
 * ==================================================================== */

/**
 * Dial 桶式 Dijkstra：边权为 2..18 的正整数时无需堆。
 * 返回从 start 出发到各**定稿**状态的精确最短距离（Map 键为压缩状态）。
 * 桶中允许保留过期条目，弹出时按当前 tent 距离去重。
 */
function dial(
  startCode: number,
  n: number,
  edgeCost: (i: number, j: number) => number,
): Map<number, number> {
  const tent = new Map<number, number>([[startCode, 0]]);
  const finalized = new Map<number, number>();
  const buckets: number[][] = [[startCode]];
  let cursor = 0;

  while (cursor < buckets.length) {
    const bucket = buckets[cursor] ?? [];
    while (bucket.length > 0) {
      const code = bucket.pop()!;
      if (finalized.has(code)) continue;
      const label = tent.get(code)!;
      if (label !== cursor) {
        // 过期 / 已改进的标签条目：标签改进时已向新桶放入过有效条目，
        // 直接丢弃即可（桶下标小于当前游标的情况不会出现：边权为正）。
        continue;
      }
      finalized.set(code, cursor);
      // 区间倒位枚举与 eachNeighbor 相同（位运算反转+翻转），这里直接用
      // neighborCode 计算后继压缩状态并取边权。
      for (let i = 0; i < n; i += 1) {
        for (let j = i; j < n; j += 1) {
          const nextCode = neighborCode(code, i, j);
          const nd = cursor + edgeCost(i, j);
          const prev = tent.get(nextCode);
          if (prev !== undefined && prev <= nd) continue;
          tent.set(nextCode, nd);
          if (!buckets[nd]) buckets[nd] = [];
          buckets[nd].push(nextCode);
        }
      }
    }
    cursor += 1;
  }
  return finalized;
}

export function solveWeighted(initial: Token[], risks: number[]): AuditResult {
  const n = initial.length;
  const goalCode = identityCode(n);
  const startCode = encodeState(initial);

  if (startCode === goalCode) {
    return emptyResult(initial, 'risk', risks.slice());
  }

  // 全部切口等权（均为 r）：每条路径风险 = 2r × 步数，最优方案集与最少步数
  // 方案完全相同。直接复用 BFS 结果，保证方案数、规范轨迹与各深度矩阵归属逐项一致。
  if (risks.every((r) => r === risks[0])) {
    const base = solve(initial);
    return {
      ...base,
      mode: 'risk',
      risks: risks.slice(),
      optimalCost: 2 * risks[0] * base.distance,
    };
  }

  const edgeCost = (i: number, j: number) => risks[i] + risks[j + 1];

  /* ------------------------------------------------------------------ *
   * 1) 最短距离。倒位自逆且区间代价关于方向对称，图是无向的：
   *    从目标跑一次 Dial 即得 dist(u)（u 到目标的最低风险），
   *    初始态距离就是最优代价；边 u->v（权 w）属于某条最优路径，
   *    当且仅当 dist(v) = dist(u) - w。
   * ------------------------------------------------------------------ */
  const dist = dial(goalCode, n, edgeCost);
  const optimalCost = dist.get(startCode)!;

  /** u 在 [i,j] 上倒位到 v 时，该边是否位于某条最优路径上。 */
  const isOptimalEdge = (uCode: number, vCode: number, i: number, j: number) =>
    dist.get(vCode) === dist.get(uCode)! - edgeCost(i, j);

  /* ------------------------------------------------------------------ *
   * 2) 后缀方案数 ways[u]：u 沿最优边到目标的路径条数（bigint）。
   *    按 dist 递增处理：ways[u] = Σ ways[v]（最优边 u->v）。
   * ------------------------------------------------------------------ */
  const ways = new Map<number, bigint>();
  {
    const byCost: number[][] = Array.from({ length: optimalCost + 1 }, () => []);
    for (const [code, d] of dist) {
      if (d <= optimalCost) byCost[d].push(code);
    }
    ways.set(goalCode, 1n);
    for (let c = 1; c <= optimalCost; c += 1) {
      for (const uCode of byCost[c]) {
        let acc = 0n;
        for (let i = 0; i < n; i += 1) {
          for (let j = i; j < n; j += 1) {
            const vCode = neighborCode(uCode, i, j);
            if (isOptimalEdge(uCode, vCode, i, j)) acc += ways.get(vCode) ?? 0n;
          }
        }
        if (acc > 0n) ways.set(uCode, acc);
      }
    }
  }

  const totalPaths = ways.get(startCode)!;

  /* ------------------------------------------------------------------ *
   * 3) 按“精确深度”分层的前缀 DP。同一状态可在不同深度以相同累计代价
   *    出现（路径步数不同），因此前缀计数带深度，不做跨深度合并：
   *    prefix[d](u) = 恰在第 d 步到达 u 的最优方案数。
   *    边 u->v 在深度 d 的计数 = prefix[d](u) * ways[v]，
   *    长方案逐深度继续贡献、在其结束后自然退出，绝不截断或重复计数。
   * ------------------------------------------------------------------ */
  const allIntervals = buildAllIntervals(n);
  const matrix: MatrixLayer[] = [];
  let prefix = new Map<number, bigint>([[startCode, 1n]]);

  for (let d = 0; prefix.size > 0; d += 1) {
    const counts = new Map<string, bigint>();
    for (const { start, end } of allIntervals) {
      counts.set(`${start}:${end}`, 0n);
    }
    const nextPrefix = new Map<number, bigint>();
    let aliveCount = 0n;

    for (const [uCode, prefixU] of prefix) {
      // 恰在第 d 步到达目标的方案长度为 d，在深度 d 不再有边，退出比较全集；
      // 其余状态的每个前缀恰可由 ways[u] 条后缀补成完整最优方案——
      // 边计数之和（Σ prefix[u]·ways[u]）即本深度仍存活的完整方案数。
      if (uCode === goalCode) continue;
      const waysU = ways.get(uCode) ?? 0n;
      aliveCount += prefixU * waysU;
      for (let i = 0; i < n; i += 1) {
        for (let j = i; j < n; j += 1) {
          const vCode = neighborCode(uCode, i, j);
          if (!isOptimalEdge(uCode, vCode, i, j)) continue;
          const key = `${i + 1}:${j + 1}`;
          counts.set(key, counts.get(key)! + prefixU * (ways.get(vCode) ?? 0n));
          nextPrefix.set(vCode, (nextPrefix.get(vCode) ?? 0n) + prefixU);
        }
      }
    }

    // 本层全部为已收尾方案时不再产生新行：最后一行覆盖最长同优轨迹的末步。
    if (aliveCount === 0n) break;

    matrix.push({
      depth: d,
      aliveCount,
      intervals: allIntervals.map(({ start, end }) => {
        const pathCount = counts.get(`${start}:${end}`)!;
        const presence: CellPresence =
          pathCount === 0n
            ? 'none'
            : pathCount === aliveCount
              ? 'all'
              : 'some';
        return { start, end, pathCount, presence };
      }),
    });
    prefix = nextPrefix;
  }

  /* ------------------------------------------------------------------ *
   * 4) 规范轨迹：从初始态贪心选择“仍可收尾”的字典序最小边。
   *    边序列长度不同时字典序以前缀为先（较短者在前），贪心选择
   *    不依赖桶处理顺序，结论与枚举全部最优序列一致。
   * ------------------------------------------------------------------ */
  const steps: InversionStep[] = [];
  const states: Token[][] = [initial.slice()];
  let cursor = startCode;
  while (cursor !== goalCode) {
    let picked: { code: number; start: number; end: number } | null = null;
    eachNeighbor(cursor, n, (nextCode, start, end) => {
      if (picked) return;
      // 无向图上最优边判据：dist(next) = dist(cur) - w。
      if (isOptimalEdge(cursor, nextCode, start - 1, end - 1)) {
        picked = { code: nextCode, start, end };
      }
    });
    const p = picked!;
    steps.push({ start: p.start, end: p.end });
    states.push(decodeState(p.code, n));
    cursor = p.code;
  }

  return {
    n,
    initial,
    mode: 'risk',
    risks: risks.slice(),
    distance: steps.length,
    optimalCost,
    totalPaths,
    canonical: { steps, states },
    matrix,
  };
}

/** 计算 code 在 0 基闭区间 [i,j] 上倒位后的压缩状态。 */
function neighborCode(code: number, i: number, j: number): number {
  let nextCode = code;
  let mask = 0;
  for (let k = i; k <= j; k += 1) mask |= 0x0f << (4 * k);
  nextCode &= ~mask;
  for (let k = i; k <= j; k += 1) {
    const stored = (code >>> (4 * (i + j - k))) & 0x0f;
    const flipped = ((stored - 1) ^ 1) + 1;
    nextCode |= flipped << (4 * k);
  }
  return nextCode;
}

/** Worker 传输用 DTO：bigint 不能依赖所有环境的结构化克隆，统一转十进制字符串。 */
export interface AuditResultDTO {
  n: number;
  initial: Token[];
  mode: AuditMode;
  risks: number[] | null;
  distance: number;
  optimalCost: number;
  totalPaths: string;
  canonical: {
    steps: InversionStep[];
    states: Token[][];
  };
  matrix: {
    depth: number;
    aliveCount: string;
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
    initial: result.initial,
    mode: result.mode,
    risks: result.risks,
    distance: result.distance,
    optimalCost: result.optimalCost,
    totalPaths: result.totalPaths.toString(),
    canonical: result.canonical,
    matrix: result.matrix.map((layer) => ({
      depth: layer.depth,
      aliveCount: layer.aliveCount.toString(),
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
    initial: dto.initial,
    mode: dto.mode,
    risks: dto.risks,
    distance: dto.distance,
    optimalCost: dto.optimalCost,
    totalPaths: BigInt(dto.totalPaths),
    canonical: dto.canonical,
    matrix: dto.matrix.map((layer) => ({
      depth: layer.depth,
      aliveCount: BigInt(layer.aliveCount),
      intervals: layer.intervals.map((cell) => ({
        start: cell.start,
        end: cell.end,
        pathCount: BigInt(cell.pathCount),
        presence: cell.presence,
      })),
    })),
  };
}
