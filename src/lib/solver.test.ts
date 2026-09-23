import { describe, expect, it } from 'vitest';
import {
  applyInversion,
  encodeState,
  encodeToken,
  formatBigIntDecimal,
  validatePermutation,
  validateRisks,
} from './permutation';
import {
  type InversionStep,
  solve,
  solveWeighted,
} from './solver';

function tokensOf(values: number[]) {
  return values.map(encodeToken);
}

function signedOf(tokens: ReturnType<typeof tokensOf>) {
  return tokens.map((t) => ((t & 1) === 0 ? (t >> 1) + 1 : -(((t >> 1) + 1))));
}

/** 独立的暴力 DFS：枚举全部最短倒位序列，用于交叉验证。 */
function bruteForce(values: number[]): {
  distance: number;
  total: number;
  lexicographicMin: InversionStep[];
} {
  const n = values.length;
  const start = tokensOf(values);
  const goalCode = encodeState(tokensOf(Array.from({ length: n }, (_, k) => k + 1)));

  // BFS 求最短距离
  const dist = new Map<number, number>([[encodeState(start), 0]]);
  const queue = [encodeState(start)];
  let goal = -1;
  for (let head = 0; head < queue.length; head += 1) {
    const code = queue[head];
    if (code === goalCode) {
      goal = dist.get(code)!;
      break;
    }
    const d = dist.get(code)!;
    const cur: number[] = [];
    for (let k = 0; k < n; k += 1) cur.push(((code >>> (4 * k)) & 0x0f) - 1);
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) {
        const nx = encodeState(applyInversion(cur, i, j));
        if (!dist.has(nx)) {
          dist.set(nx, d + 1);
          queue.push(nx);
        }
      }
    }
  }
  const distance = goal;

  // DFS 只走能保持最短性的边，枚举全部最短方案（n<=3 时规模很小）
  let total = 0;
  let lexicographicMin: InversionStep[] | null = null;
  const walk = (tokens: number[], d: number[], path: InversionStep[]) => {
    const code = encodeState(tokens);
    if (code === goalCode) {
      total += 1;
      if (
        lexicographicMin === null ||
        lexicographicLess(path, lexicographicMin)
      ) {
        lexicographicMin = path.slice();
      }
      return;
    }
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) {
        const nx = applyInversion(tokens, i, j);
        const nxCode = encodeState(nx);
        if (dist.get(nxCode) === dist.get(code)! + 1 && dist.get(nxCode)! <= distance) {
          path.push({ start: i + 1, end: j + 1 });
          walk(nx, d, path);
          path.pop();
        }
      }
    }
  };
  walk(start, [], []);
  return { distance, total, lexicographicMin: lexicographicMin! };
}

function lexicographicLess(a: InversionStep[], b: InversionStep[]) {
  for (let k = 0; k < Math.max(a.length, b.length); k += 1) {
    const x = a[k];
    const y = b[k];
    if (x === undefined) return true;
    if (y === undefined) return false;
    if (x.start !== y.start) return x.start < y.start;
    if (x.end !== y.end) return x.end < y.end;
  }
  return false;
}

describe('倒位操作语义', () => {
  it('反转区间次序并同时翻转每个符号', () => {
    // [1,-3,-2,4] 倒位 [2,3] -> [1, 2, 3, 4]
    const got = applyInversion(tokensOf([1, -3, -2, 4]), 1, 2);
    expect(signedOf(got)).toEqual([1, 2, 3, 4]);
  });

  it('单点区间只翻转该符号', () => {
    const got = applyInversion(tokensOf([1, 2, 3]), 1, 1);
    expect(signedOf(got)).toEqual([1, -2, 3]);
  });
});

describe('需求用例 [1,-3,-2,4]', () => {
  it('最短步数为 1，规范倒位是 [2,3]，方案总数为 1', () => {
    const r = solve(tokensOf([1, -3, -2, 4]));
    expect(r.distance).toBe(1);
    expect(r.totalPaths).toBe(1n);
    expect(r.canonical.steps).toEqual([{ start: 2, end: 3 }]);
    expect(signedOf(r.canonical.states[1])).toEqual([1, 2, 3, 4]);
  });
});

describe('校验：合并反馈且拒绝非法排列', () => {
  it('重复绝对值被拒绝', () => {
    const r = validatePermutation('1 1 3');
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.tokens).toBeUndefined();
    expect(r.errors.join(' ')).toContain('重复');
  });

  it('重复绝对值（符号不同）被拒绝', () => {
    const r = validatePermutation('[1, -1, 2]');
    expect(r.tokens).toBeUndefined();
    expect(r.errors.join(' ')).toContain('重复');
  });

  it('缺少某个绝对值（未恰好覆盖 1..n）被拒绝', () => {
    expect(validatePermutation('1 2 2').tokens).toBeUndefined();
    expect(validatePermutation('1 2 4').tokens).toBeUndefined();
  });

  it('数量越界、0、非整数与越界值合并为一次反馈', () => {
    const r = validatePermutation('1, 0, x, 9');
    expect(r.tokens).toBeUndefined();
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('合法排列通过校验并接受常见分隔符', () => {
    expect(validatePermutation('1 -2 3').tokens).toBeDefined();
    expect(validatePermutation('[1, -2, 3]').tokens).toBeDefined();
    expect(validatePermutation('1;-2;3').tokens).toBeDefined();
  });
});

describe('与暴力枚举交叉验证（n=3 全部排列，n=4 部分排列）', () => {
  const cases: number[][] = [];
  const perms = (arr: number[]): number[][] =>
    arr.length <= 1
      ? [arr]
      : arr.flatMap((v, i) =>
          perms(arr.filter((_, k) => k !== i)).map((p) => [v, ...p]),
        );
  for (const order of perms([1, 2, 3])) {
    for (let mask = 0; mask < 1 << 3; mask += 1) {
      cases.push(order.map((v, k) => (mask & (1 << k) ? -v : v)));
    }
  }
  for (const order of perms([1, 2, 3, 4]).slice(0, 24)) {
    cases.push(order.map((v) => (v % 2 === 0 ? -v : v)));
  }

  for (const c of cases) {
    it(`case ${JSON.stringify(c)}`, () => {
      const r = solve(tokensOf(c));
      const b = bruteForce(c);
      expect(r.distance).toBe(b.distance);
      expect(r.totalPaths).toBe(BigInt(b.total));
      expect(r.canonical.steps).toEqual(b.lexicographicMin);

      // 规范路径本身必须可行且到达全正顺序
      let cur = tokensOf(c);
      for (const s of r.canonical.steps) {
        cur = applyInversion(cur, s.start - 1, s.end - 1);
      }
      expect(signedOf(cur)).toEqual(Array.from({ length: c.length }, (_, k) => k + 1));

      // 矩阵不变量：每层各区间出现方案数之和恰为总方案数
      for (const layer of r.matrix) {
        let sum = 0n;
        for (const cell of layer.intervals) sum += cell.pathCount;
        expect(sum).toBe(r.totalPaths);
      }
    });
  }
});

describe('深度×区间矩阵', () => {
  it('未使用区间标 none，全部方案共用标 all，并给出精确出现数', () => {
    // [-1,2,3] 只有一条最短路径：单点翻转位置 1
    const r = solve(tokensOf([-1, 2, 3]));
    expect(r.distance).toBe(1);
    const layer = r.matrix[0];
    for (const cell of layer.intervals) {
      if (cell.start === 1 && cell.end === 1) {
        expect(cell.presence).toBe('all');
        expect(cell.pathCount).toBe(1n);
      } else {
        expect(cell.presence).toBe('none');
        expect(cell.pathCount).toBe(0n);
      }
    }
  });

  it('存在多种选择时标注 some 且计数精确', () => {
    // [-1,-2,-3]：三个单点倒位各需 3 步（顺序无关 => 6 条），也有更短路径。
    // 这里直接验证：some 格子计数严格介于 0 与总数之间，且层级计数自洽。
    const r = solve(tokensOf([-1, -2, -3]));
    expect(r.distance).toBeGreaterThan(0);
    for (const layer of r.matrix) {
      for (const cell of layer.intervals) {
        if (cell.presence === 'some') {
          expect(cell.pathCount > 0n).toBe(true);
          expect(cell.pathCount < r.totalPaths).toBe(true);
        }
      }
    }
  });
});

describe('边界与展示', () => {
  it('已是全正顺序时距离 0、方案 1、矩阵为空', () => {
    const r = solve(tokensOf([1, 2, 3]));
    expect(r.distance).toBe(0);
    expect(r.totalPaths).toBe(1n);
    expect(r.matrix).toEqual([]);
    expect(r.canonical.steps).toEqual([]);
  });

  it('n=7 可求解且大数以千分位完整输出', () => {
    const r = solve(tokensOf([-7, -6, -5, -4, -3, -2, -1]));
    expect(r.distance).toBeGreaterThan(0);
    expect(r.totalPaths > 0n).toBe(true);
    expect(formatBigIntDecimal(r.totalPaths)).toMatch(/^\d{1,3}(,\d{3})*$/);
    // 往返一致：去掉千分位仍是同一个整数
    expect(BigInt(formatBigIntDecimal(r.totalPaths).replace(/,/g, ''))).toBe(
      r.totalPaths,
    );
  });
});

/* ==================================================================== *
 * 风险审计模式
 * ==================================================================== */

/** 边代价 = 两端切口风险之和（i,j 为 0 基闭区间）。 */
function edgeWeight(i: number, j: number, risks: number[]): number {
  return risks[i] + risks[j + 1];
}

/**
 * 独立暴力：Dijkstra 求最低代价（分别从初始态与目标态跑一次——倒位自逆、
 * 边权对称，故到目标的距离 = 从目标出发的距离），再带预算 DFS 枚举全部
 * 最低代价方案（边代价严格为正，超出预算或无法达成最优即剪枝，自动终止）。
 */
function bruteForceWeighted(
  values: number[],
  risks: number[],
): {
  minCost: number;
  total: number;
  minLen: number;
  maxLen: number;
  lexicographicMin: InversionStep[];
  depthCount: Map<string, number>[];
  rowTotal: number[];
} {
  const n = values.length;
  const start = tokensOf(values);
  const goalCode = encodeState(tokensOf(Array.from({ length: n }, (_, k) => k + 1)));

  const dijkstra = (sourceCode: number) => {
    const dist = new Map<number, number>([[sourceCode, 0]]);
    const queue: number[] = [sourceCode];
    const settled = new Set<number>();
    while (queue.length > 0) {
      let bi = 0;
      for (let k = 1; k < queue.length; k += 1) {
        if (dist.get(queue[k])! < dist.get(queue[bi])!) bi = k;
      }
      const code = queue.splice(bi, 1)[0];
      if (settled.has(code)) continue;
      settled.add(code);
      const cur: number[] = [];
      for (let k = 0; k < n; k += 1) cur.push(((code >>> (4 * k)) & 0x0f) - 1);
      for (let i = 0; i < n; i += 1) {
        for (let j = i; j < n; j += 1) {
          const nx = encodeState(applyInversion(cur, i, j));
          const nd = dist.get(code)! + edgeWeight(i, j, risks);
          if (dist.get(nx) === undefined || nd < dist.get(nx)!) {
            dist.set(nx, nd);
            queue.push(nx);
          }
        }
      }
    }
    return dist;
  };

  const fromStart = dijkstra(encodeState(start));
  const toGoal = dijkstra(goalCode);
  const minCost = fromStart.get(goalCode)!;

  let total = 0;
  let minLen = Infinity;
  let maxLen = 0;
  let lexicographicMin: InversionStep[] | null = null;
  const depthCount: Map<string, number>[] = [];

  const walk = (curTok: number[], spent: number, path: InversionStep[]) => {
    const code = encodeState(curTok);
    if (code === goalCode) {
      total += 1;
      minLen = Math.min(minLen, path.length);
      maxLen = Math.max(maxLen, path.length);
      if (lexicographicMin === null || lexicographicLess(path, lexicographicMin)) {
        lexicographicMin = path.slice();
      }
      // 每条完整方案在其经过的每个深度各贡献一次区间计数。
      path.forEach((step, d) => {
        const key = `${step.start}:${step.end}`;
        depthCount[d].set(key, (depthCount[d].get(key) ?? 0) + 1);
      });
      return;
    }
    const d = path.length;
    if (!depthCount[d]) depthCount[d] = new Map();
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) {
        const w = edgeWeight(i, j, risks);
        const nx = applyInversion(curTok, i, j);
        // 最优边：走到 nx 后剩余代价必须仍恰好达成全局最低代价。
        if (spent + w + toGoal.get(encodeState(nx))! !== minCost) continue;
        path.push({ start: i + 1, end: j + 1 });
        walk(nx, spent + w, path);
        path.pop();
      }
    }
  };
  walk(start, 0, []);

  const rowTotal = depthCount.map((m) =>
    [...m.values()].reduce((a, b) => a + b, 0),
  );

  return {
    minCost,
    total,
    minLen,
    maxLen,
    lexicographicMin: lexicographicMin!,
    depthCount,
    rowTotal,
  };
}

describe('风险输入校验', () => {
  it('接受恰好 n+1 个 1..9 正整数', () => {
    expect(validateRisks('1 2 3 4', 3).risks).toEqual([1, 2, 3, 4]);
    expect(validateRisks('[9,8,7,6,5]', 4).risks).toEqual([9, 8, 7, 6, 5]);
  });

  it('数量不符、0、超出 9、非整数合并反馈，且不产出 risks', () => {
    const r = validateRisks('1, 0, 10, x, 2', 3);
    expect(r.risks).toBeUndefined();
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('空输入与负数被拒绝', () => {
    expect(validateRisks('', 3).risks).toBeUndefined();
    expect(validateRisks('1 -2 3 4', 3).errors.length).toBeGreaterThan(0);
  });
});

describe('风险模式：等权时与普通模式完全一致', () => {
  const cases: number[][] = [];
  const perms = (arr: number[]): number[][] =>
    arr.length <= 1
      ? [arr]
      : arr.flatMap((v, i) =>
          perms(arr.filter((_, k) => k !== i)).map((p) => [v, ...p]),
        );
  for (const order of perms([1, 2, 3])) {
    for (let mask = 0; mask < 1 << 3; mask += 1) {
      cases.push(order.map((v, k) => (mask & (1 << k) ? -v : v)));
    }
  }

  for (const c of cases) {
    it(`等权一致 ${JSON.stringify(c)}`, () => {
      const unit = solve(tokensOf(c));
      const equal = solveWeighted(
        tokensOf(c),
        new Array(c.length + 1).fill(1),
        'risk',
      );
      expect(equal.minCost).toBe(2 * unit.distance);
      expect(equal.distance).toBe(unit.distance);
      expect(equal.minSteps).toBe(unit.distance);
      expect(equal.maxSteps).toBe(unit.distance);
      expect(equal.totalPaths).toBe(unit.totalPaths);
      expect(equal.canonical.steps).toEqual(unit.canonical.steps);
      expect(equal.matrix.length).toBe(unit.matrix.length);
      for (let d = 0; d < unit.matrix.length; d += 1) {
        expect(equal.matrix[d].rowTotal).toBe(unit.totalPaths);
        for (let k = 0; k < unit.matrix[d].intervals.length; k += 1) {
          expect(equal.matrix[d].intervals[k].pathCount).toBe(
            unit.matrix[d].intervals[k].pathCount,
          );
          expect(equal.matrix[d].intervals[k].presence).toBe(
            unit.matrix[d].intervals[k].presence,
          );
        }
      }
    });
  }

  it('等权但非 1（全 5）时方案数/规范/归属同样不变', () => {
    for (const values of [
      [-1, -2, -3],
      [3, 2, 1],
      [2, 1, -3],
      [1, -3, -2],
    ]) {
      const unit = solve(tokensOf(values));
      const eq5 = solveWeighted(
        tokensOf(values),
        new Array(values.length + 1).fill(5),
        'risk',
      );
      expect(eq5.minCost).toBe(10 * unit.distance);
      expect(eq5.totalPaths).toBe(unit.totalPaths);
      expect(eq5.canonical.steps).toEqual(unit.canonical.steps);
      for (let d = 0; d < unit.matrix.length; d += 1) {
        for (let k = 0; k < unit.matrix[d].intervals.length; k += 1) {
          expect(eq5.matrix[d].intervals[k].presence).toBe(
            unit.matrix[d].intervals[k].presence,
          );
        }
      }
    }
  });
});

describe('风险模式：与暴力枚举交叉验证', () => {
  const cases: { values: number[]; risks: number[] }[] = [];
  const perms = (arr: number[]): number[][] =>
    arr.length <= 1
      ? [arr]
      : arr.flatMap((v, i) =>
          perms(arr.filter((_, k) => k !== i)).map((p) => [v, ...p]),
        );
  const all3: number[][] = [];
  for (const order of perms([1, 2, 3])) {
    for (let mask = 0; mask < 1 << 3; mask += 1) {
      all3.push(order.map((v, k) => (mask & (1 << k) ? -v : v)));
    }
  }
  const riskVectors = [
    [1, 1, 1, 1],
    [9, 1, 1, 9],
    [1, 9, 9, 1],
    [3, 7, 2, 5],
    [5, 5, 5, 1],
    [1, 1, 1, 3],
    [1, 2, 4, 8],
  ];
  for (const risks of riskVectors) {
    for (const values of all3) cases.push({ values, risks });
  }
  // n=4 抽样（状态 384 个，暴力仅走最优 DAG，仍可接受）
  for (const values of [
    [-1, -2, -3, -4],
    [4, 3, 2, 1],
    [2, -1, 4, -3],
  ]) {
    cases.push({ values, risks: [9, 1, 9, 1, 9] });
    cases.push({ values, risks: [1, 9, 1, 9, 1] });
  }

  for (const { values, risks } of cases) {
    it(`${JSON.stringify(values)} risks=${JSON.stringify(risks)}`, () => {
      const r = solveWeighted(tokensOf(values), risks, 'risk');
      const b = bruteForceWeighted(values, risks);

      expect(r.minCost).toBe(b.minCost);
      expect(r.totalPaths).toBe(BigInt(b.total));
      expect(r.minSteps).toBe(b.minLen);
      expect(r.maxSteps).toBe(b.maxLen);
      expect(r.canonical.steps).toEqual(b.lexicographicMin);
      expect(r.matrix.length).toBe(b.maxLen);

      // 规范轨迹必须实际可行且到达全正顺序
      let cur = tokensOf(values);
      let cost = 0;
      for (const s of r.canonical.steps) {
        cost += edgeWeight(s.start - 1, s.end - 1, risks);
        cur = applyInversion(cur, s.start - 1, s.end - 1);
      }
      expect(signedOf(cur)).toEqual(
        Array.from({ length: values.length }, (_, k) => k + 1),
      );
      expect(cost).toBe(b.minCost);

      for (let d = 0; d < b.maxLen; d += 1) {
        const layer = r.matrix[d];
        expect(layer.rowTotal).toBe(BigInt(b.rowTotal[d] ?? 0));
        let sum = 0n;
        for (const cell of layer.intervals) {
          sum += cell.pathCount;
          const expected = BigInt(b.depthCount[d]?.get(`${cell.start}:${cell.end}`) ?? 0);
          expect(cell.pathCount).toBe(expected);
          if (expected === 0n) expect(cell.presence).toBe('none');
          else if (expected === layer.rowTotal) expect(cell.presence).toBe('all');
          else expect(cell.presence).toBe('some');
        }
        expect(sum).toBe(layer.rowTotal);
      }
    });
  }

  it('非等权时确实可能出现步数不同的同优方案', () => {
    // 末段切口更贵时，[2,1,-3] 的最低风险方案既有 3 步也有 4 步。
    const r = solveWeighted(tokensOf([2, 1, -3]), [1, 1, 1, 3], 'risk');
    expect(r.minSteps).toBe(3);
    expect(r.maxSteps).toBe(4);
    // 矩阵行数覆盖最长轨迹；最后一行（深度 3）只有 4 步方案，rowTotal 严格小于总数。
    expect(r.matrix.length).toBe(4);
    expect(r.matrix[3].rowTotal < r.totalPaths).toBe(true);
    expect(r.matrix[3].rowTotal > 0n).toBe(true);
    expect(r.matrix[0].rowTotal).toBe(r.totalPaths);
  });
});
