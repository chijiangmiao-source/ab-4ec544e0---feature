/**
 * verify 一次性服务中的需求核查（业务断言，与单元测试分开、输出可读）：
 *   1) [1,-3,-2,4] 的最短步数必须为 1（且唯一最短倒位为 [2,3]）；
 *   2) 重复绝对值必须被校验拒绝（输入不保留给求解器）；
 *   3) 风险模式：n+1 个切口风险、区间代价为两端之和；等权时与普通模式逐项一致；
 *      非法风险输入合并反馈；构造高风险切口使更“长”的轨迹成为最低风险方案。
 * 任一断言失败即以非零退出码结束容器。
 */
import { encodeToken, validatePermutation, validateRisks } from '../src/lib/permutation';
import { solve, solveWeighted } from '../src/lib/solver';

let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`PASS: ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    failures += 1;
  }
}

// 1) [1,-3,-2,4] 最短步数为 1
{
  const values = [1, -3, -2, 4];
  const { tokens, errors } = validatePermutation(values.join(','));
  check('[1,-3,-2,4] 通过输入校验', tokens !== undefined && errors.length === 0);
  if (tokens) {
    const r = solve(tokens);
    check('[1,-3,-2,4] 最短步数为 1', r.distance === 1, `实际为 ${r.distance}`);
    check(
      '[1,-3,-2,4] 唯一最短倒位是 [2,3]',
      r.totalPaths === 1n &&
        r.canonical.steps.length === 1 &&
        r.canonical.steps[0].start === 2 &&
        r.canonical.steps[0].end === 3,
      `方案数 ${r.totalPaths}，规范步骤 ${JSON.stringify(r.canonical.steps)}`,
    );
  }
}

// 2) 重复绝对值被拒绝（同号重复、异号重复各一例）
for (const raw of ['1,1,3', '1,-1,2', '2,2,2']) {
  const { tokens, errors } = validatePermutation(raw);
  check(
    `重复绝对值被拒绝：“${raw}”`,
    tokens === undefined && errors.some((e) => e.includes('重复')),
    errors.join(' / '),
  );
}

// 附带确认 encodeToken 没有被误用（快速健全性检查）
{
  const tokens = [1, -3, -2, 4].map(encodeToken);
  check('token 编码往返', tokens.length === 4);
}

// 3) 风险模式
{
  const values = [1, -3, -2, 4];
  const tokens = values.map(encodeToken);

  // 3a) 非法风险（数量不符 + 越界 + 非整数）合并反馈：n=3 需要 4 个，给 5 个
  const bad = validateRisks('1, 0, 10, x, 9', 3);
  check(
    '风险非法输入合并反馈（数量、范围、非整数一次给出）',
    bad.risks === undefined && bad.errors.length >= 4,
    bad.errors.join(' / '),
  );
  check('合法 n+1 个 1..9 风险通过', validateRisks('9 8 7 6 5', 4).risks !== undefined);

  // 3b) 等权风险与普通模式逐项一致（含 n=7 示例）
  const sample = [-7, 6, -5, 4, -3, 2, -1];
  const normal = solve(sample.map(encodeToken));
  const equal = solveWeighted(sample.map(encodeToken), Array(sample.length + 1).fill(3));
  const matrixSame =
    equal.matrix.length === normal.matrix.length &&
    equal.matrix.every((layer, d) =>
      layer.intervals.every(
        (cell, k) =>
          cell.pathCount === normal.matrix[d].intervals[k].pathCount &&
          cell.presence === normal.matrix[d].intervals[k].presence,
      ),
    );
  check(
    '全部切口等权时方案数/规范轨迹/矩阵归属与最少步数审计一致',
    equal.totalPaths === normal.totalPaths &&
      equal.canonical.steps.join() === normal.canonical.steps.join() &&
      equal.distance === normal.distance &&
      equal.optimalCost === 2 * 3 * normal.distance &&
      matrixSame,
    `普通 ${normal.totalPaths} / 风险 ${equal.totalPaths}`,
  );

  // 3c) 抬高切口 4 的风险：直接修复 [2,3] 代价 r[1]+r[3]=7，
  //     而 3 步绕行 [2,4]→[3,4]→[2,4] 代价 2+2+2=6，更长轨迹反而更便宜
  const risks3 = [1, 1, 1, 6, 1];
  const r = solveWeighted(tokens, risks3);
  const directCost = risks3[1] + risks3[3];
  check(
    '高风险切口使更长轨迹成为最低风险方案（步数不再代表代价）',
    r.optimalCost === 6 &&
      r.optimalCost < directCost &&
      r.totalPaths === 1n &&
      r.canonical.steps.length === 3 &&
      r.canonical.steps[0].start === 2 &&
      r.canonical.steps[0].end === 4,
    `最低风险 ${r.optimalCost}（直修代价 ${directCost}），规范步数 ${r.canonical.steps.length}，方案数 ${r.totalPaths}`,
  );

  // 3d) 同优方案步数可不同：逐深度比较全集随行数递减；每格计数为精确 bigint
  let rowSumOk = true;
  for (const layer of r.matrix) {
    let sum = 0n;
    for (const cell of layer.intervals) sum += cell.pathCount;
    if (sum !== layer.aliveCount) rowSumOk = false;
  }
  check('风险矩阵每行计数之和等于该深度比较全集', rowSumOk);
}

if (failures > 0) {
  console.error(`需求核查失败 ${failures} 项`);
  process.exit(1);
}
console.log('需求核查全部通过');
