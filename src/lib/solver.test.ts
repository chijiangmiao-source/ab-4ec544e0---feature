import { describe, expect, it } from 'vitest';
import {
  applyInversion,
  encodeState,
  encodeToken,
  formatBigIntDecimal,
  validatePermutation,
  validateRisks,
} from './permutation';
import { type InversionStep, solve, solveWeighted } from './solver';

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

describe('风险输入校验：合并反馈且保留文本语义', () => {
  it('合法的 n+1 个 1..9 风险通过', () => {
    const r = validateRisks('1 2 3 4', 3);
    expect(r.errors).toEqual([]);
    expect(r.risks).toEqual([1, 2, 3, 4]);
  });

  it('数量错误与逐项非法（非正整数、越界、非整数）合并反馈', () => {
    const r = validateRisks('1, 0, 10, x, -2', 3); // n=3 需要 4 个，给了 5 个
    expect(r.risks).toBeUndefined();
    expect(r.errors.length).toBeGreaterThanOrEqual(4);
    expect(r.errors.join(' ')).toContain('4 个');
  });

  it('接受常见分隔符与外层括号', () => {
    expect(validateRisks('[9;8;7]', 2).risks).toEqual([9, 8, 7]);
  });

  it('数量恰好但含非法值时仍拒绝', () => {
    expect(validateRisks('1 1 9 10', 3).risks).toBeUndefined();
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

/* ------------------------------------------------------------------ *
 * 风险模式：独立暴力枚举交叉验证
 * ------------------------------------------------------------------ */

/** 简易 Dial：从 goal 出发求全图最短距离（倒位自逆，图关于权值无向）。 */
function bruteDistances(values: number[], risks: number[]) {
  const n = values.length;
  const goalCode = encodeState(tokensOf(Array.from({ length: n }, (_, k) => k + 1)));
  const tent = new Map<number, number>([[goalCode, 0]]);
  const buckets: number[][] = [[goalCode]];
  let cur = 0;
  while (cur < buckets.length) {
    const bucket = buckets[cur] ?? [];
    while (bucket.length) {
      const code = bucket.pop()!;
      if (tent.get(code) !== cur) continue;
      const tokens: number[] = [];
      for (let k = 0; k < n; k += 1) tokens.push(((code >>> (4 * k)) & 0x0f) - 1);
      for (let i = 0; i < n; i += 1) {
        for (let j = i; j < n; j += 1) {
          const nx = encodeState(applyInversion(tokens, i, j));
          const nd = cur + risks[i] + risks[j + 1];
          const prev = tent.get(nx);
          if (prev === undefined || nd < prev) {
            tent.set(nx, nd);
            (buckets[nd] ??= []).push(nx);
          }
        }
      }
    }
    cur += 1;
  }
  return tent;
}

interface BruteWeighted {
  cost: number;
  total: number;
  lengths: Set<number>;
  /** 方案步数直方图：长度 -> 最优方案数 */
  lengthCount: Map<number, number>;
  lexMin: InversionStep[];
  /** depthKey `${i+1}:${j+1}` -> 在该深度出现的最优完整方案数 */
  depthCounts: Map<string, number>[];
}

/** DFS 枚举全部最优路径（正权下边在最优路径上不形成环，路径必为简单路）。 */
function bruteWeighted(values: number[], risks: number[]): BruteWeighted {
  const n = values.length;
  const start = tokensOf(values);
  const goalCode = encodeState(tokensOf(Array.from({ length: n }, (_, k) => k + 1)));
  const distGoal = bruteDistances(values, risks);
  const startCode = encodeState(start);
  const optimal = distGoal.get(startCode)!;

  let total = 0;
  const lengths = new Set<number>();
  const lengthCount = new Map<number, number>();
  let lexMin: InversionStep[] | null = null;
  const depthCounts: Map<string, number>[] = [];

  const walk = (tokens: number[], spent: number, path: InversionStep[]) => {
    const code = encodeState(tokens);
    if (code === goalCode) {
      if (spent !== optimal) return;
      total += 1;
      lengths.add(path.length);
      lengthCount.set(path.length, (lengthCount.get(path.length) ?? 0) + 1);
      if (lexMin === null || lexicographicLess(path, lexMin)) lexMin = path.slice();
      path.forEach((s, d) => {
        const m = depthCounts[d] ?? new Map<string, number>();
        const key = `${s.start}:${s.end}`;
        m.set(key, (m.get(key) ?? 0) + 1);
        depthCounts[d] = m;
      });
      return;
    }
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) {
        const w = risks[i] + risks[j + 1];
        const nx = applyInversion(tokens, i, j);
        if (spent + w + distGoal.get(encodeState(nx))! !== optimal) continue;
        path.push({ start: i + 1, end: j + 1 });
        walk(nx, spent + w, path);
        path.pop();
      }
    }
  };
  walk(start, 0, []);
  return { cost: optimal, total, lengths, lengthCount, lexMin: lexMin!, depthCounts };
}

describe('风险模式：与暴力枚举交叉验证（n=3 全部排列 × 多组风险）', () => {
  const perms = (arr: number[]): number[][] =>
    arr.length <= 1
      ? [arr]
      : arr.flatMap((v, i) =>
          perms(arr.filter((_, k) => k !== i)).map((p) => [v, ...p]),
        );
  const cases: number[][] = [];
  for (const order of perms([1, 2, 3])) {
    for (let mask = 0; mask < 1 << 3; mask += 1) {
      cases.push(order.map((v, k) => (mask & (1 << k) ? -v : v)));
    }
  }
  const riskSets = [
    [1, 1, 1, 1],
    [1, 9, 2, 8],
    [3, 1, 4, 1],
    [9, 1, 1, 9],
    [2, 3, 2, 3],
    [5, 1, 9, 2],
  ];

  let sawUnequalLengths = false;

  for (const c of cases) {
    for (const risks of riskSets) {
      it(`${JSON.stringify(c)} risks=${risks.join(',')}`, () => {
        const r = solveWeighted(tokensOf(c), risks);
        const b = bruteWeighted(c, risks);
        expect(r.optimalCost).toBe(b.cost);
        expect(r.totalPaths).toBe(BigInt(b.total));
        expect(r.canonical.steps).toEqual(b.lexMin);

        if (b.lengths.size > 1) {
          sawUnequalLengths = true;
          // 不同步数的同优方案共存：矩阵行数必须覆盖最长轨迹
          const maxLen = Math.max(...b.lengths);
          expect(r.matrix.length).toBe(maxLen);
        }

        // 逐深度格计数、比较全集与暴力枚举一致
        let aliveExpected = b.total;
        for (let d = 0; d < r.matrix.length; d += 1) {
          let rowSum = 0n;
          for (const cell of r.matrix[d].intervals) {
            const key = `${cell.start}:${cell.end}`;
            const expected = BigInt(b.depthCounts[d]?.get(key) ?? 0);
            expect(cell.pathCount).toBe(expected);
            rowSum += cell.pathCount;
          }
          expect(rowSum).toBe(r.matrix[d].aliveCount);
          expect(r.matrix[d].aliveCount).toBe(BigInt(aliveExpected));
          // 下一层仍存活 = 当前存活中去掉长度恰为 d+1（在本层收尾）的方案
          aliveExpected -= b.lengthCount.get(d + 1) ?? 0;
        }

        // 规范轨迹必须可行、到达目标且累计代价恰为最优
        let cur = tokensOf(c);
        let spent = 0;
        for (const s of r.canonical.steps) {
          spent += risks[s.start - 1] + risks[s.end];
          cur = applyInversion(cur, s.start - 1, s.end - 1);
        }
        expect(signedOf(cur)).toEqual(Array.from({ length: c.length }, (_, k) => k + 1));
        expect(spent).toBe(b.cost);
      });
    }
  }

  it('至少存在一组“同优但步数不同”的实例被正确处理', () => {
    expect(sawUnequalLengths).toBe(true);
  });
});

describe('风险模式：等权切口与普通模式逐项一致', () => {
  const samples = [
    [1, -3, -2, 4],
    [-1, -2, -3],
    [3, 2, 1],
    [-7, 6, -5, 4, -3, 2, -1],
  ];

  for (const values of samples) {
    for (const w of [1, 4, 9]) {
      it(`${JSON.stringify(values)} 等权 ${w}`, () => {
        const normal = solve(tokensOf(values));
        const risks = Array(values.length + 1).fill(w);
        const weighted = solveWeighted(tokensOf(values), risks);
        expect(weighted.totalPaths).toBe(normal.totalPaths);
        expect(weighted.canonical.steps).toEqual(normal.canonical.steps);
        expect(weighted.canonical.states).toEqual(normal.canonical.states);
        expect(weighted.distance).toBe(normal.distance);
        expect(weighted.optimalCost).toBe(2 * w * normal.distance);
        expect(weighted.matrix.length).toBe(normal.matrix.length);
        weighted.matrix.forEach((layer, d) => {
          expect(layer.aliveCount).toBe(normal.totalPaths);
          layer.intervals.forEach((cell, k) => {
            expect(cell.pathCount).toBe(normal.matrix[d].intervals[k].pathCount);
            expect(cell.presence).toBe(normal.matrix[d].intervals[k].presence);
          });
        });
      });
    }
  }
});

describe('风险模式：语义与边界', () => {
  it('区间代价取两端切口风险之和，单点倒位风险 2*r 也成立', () => {
    // [-1,2,3] 唯一修复方式是翻转位置 1（普通模式距离 1）。
    // 风险 [5,1,1,1]：单点 [1,1] 代价 5+1=6；其他绕路不可能更优时仍选它。
    const r = solveWeighted(tokensOf([-1, 2, 3]), [5, 1, 1, 1]);
    expect(r.canonical.steps).toEqual([{ start: 1, end: 1 }]);
    expect(r.optimalCost).toBe(6);
  });

  it('高风险切口可以让更“长”的路径成为最低风险方案', () => {
    // [1,-3,-2,4] 的直接修复是 [2,3]（两端切口 2 与 4）。
    // 风险 [1,1,1,6,1]：直接代价 r[1]+r[3] = 1+6 = 7；
    // 唯一最优轨迹是 3 步绕行 [2,4]→[3,4]→[2,4]，代价 2+7+2 = 6（切口语义核验）：
    //   [2,4] 代价 r[1]+r[4]=1+1=2；[3,4] 代价 r[2]+r[4]=1+1=2；
    //   再 [2,4] 代价 2 —— 更长的步数反而累计风险更低。
    const risks = [1, 1, 1, 6, 1];
    const r = solveWeighted(tokensOf([1, -3, -2, 4]), risks);
    expect(r.optimalCost).toBe(6);
    expect(r.optimalCost).toBeLessThan(risks[1] + risks[3]);
    expect(r.totalPaths).toBe(1n);
    expect(r.canonical.steps).toEqual([
      { start: 2, end: 4 },
      { start: 3, end: 4 },
      { start: 2, end: 4 },
    ]);
    let cur = tokensOf([1, -3, -2, 4]);
    for (const s of r.canonical.steps) {
      cur = applyInversion(cur, s.start - 1, s.end - 1);
    }
    expect(signedOf(cur)).toEqual([1, 2, 3, 4]);
  });

  it('已是全正顺序时风险模式同样为空轨迹、代价 0', () => {
    const r = solveWeighted(tokensOf([1, 2, 3]), [7, 7, 7, 7]);
    expect(r.optimalCost).toBe(0);
    expect(r.totalPaths).toBe(1n);
    expect(r.matrix).toEqual([]);
  });
});
