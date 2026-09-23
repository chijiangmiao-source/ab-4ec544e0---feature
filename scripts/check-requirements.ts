/**
 * verify 一次性服务中的需求核查（业务断言，与单元测试分开、输出可读）：
 *   1) [1,-3,-2,4] 的最短步数必须为 1（且唯一最短倒位为 [2,3]）；
 *   2) 重复绝对值必须被校验拒绝（输入不保留给求解器）；
 *   3) 风险审计模式：切口风险校验、等权与普通模式一致、非等权时
 *      最低累计风险与变长同优方案的矩阵行数 / 行全集正确。
 * 任一断言失败即以非零退出码结束容器。
 */
import {
  encodeToken,
  validatePermutation,
  validateRisks,
} from '../src/lib/permutation';
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

// 3) 风险审计模式
{
  // 3a) 风险输入校验：合法通过，非法（数量/0/>9/非整数）合并反馈并保留不产出
  check(
    '风险输入接受 n+1 个 1..9 正整数',
    JSON.stringify(validateRisks('1 5 9 1', 3).risks) === JSON.stringify([1, 5, 9, 1]),
  );
  const bad = validateRisks('1, 0, 10, x', 3);
  check(
    '风险输入非法时合并反馈且不产出 risks',
    bad.risks === undefined && bad.errors.length >= 3,
    bad.errors.join(' / '),
  );

  const { tokens } = validatePermutation('1,-3,-2,4');
  if (tokens) {
    // 3b) 全部切口等权（均为 1）时，与普通最少步数审计完全一致
    const unit = solve(tokens);
    const equal = solveWeighted(tokens, [1, 1, 1, 1, 1], 'risk');
    check(
      '等权风险：最低风险 = 2 × 最少步数，方案数/规范/矩阵一致',
      equal.minCost === 2 * unit.distance &&
        equal.totalPaths === unit.totalPaths &&
        JSON.stringify(equal.canonical.steps) ===
          JSON.stringify(unit.canonical.steps) &&
        equal.matrix.length === unit.matrix.length,
      `最低风险 ${equal.minCost}，方案数 ${equal.totalPaths}`,
    );

    // 3c) 非等权：倒位代价 = 两端切口风险之和
    //     [2,1,-3]，risks=[1,1,1,3]：最低风险 10，最优方案 3 步与 4 步并存
    const t2 = [2, 1, -3].map(encodeToken);
    const r = solveWeighted(t2, [1, 1, 1, 3], 'risk');
    check(
      '非等权风险：给出最低累计风险',
      r.minCost === 10,
      `实际 ${r.minCost}`,
    );
    check(
      '非等权风险：同优方案步数可不同且矩阵覆盖最长轨迹',
      r.minSteps === 3 && r.maxSteps === 4 && r.matrix.length === 4,
      `步数范围 ${r.minSteps}–${r.maxSteps}，矩阵 ${r.matrix.length} 行`,
    );
    check(
      '非等权风险：首行全集为总方案数，末行全集仅为仍含该深度的方案',
      r.matrix[0].rowTotal === r.totalPaths &&
        0n < r.matrix[3].rowTotal &&
        r.matrix[3].rowTotal < r.totalPaths,
      `总数 ${r.totalPaths}，末行全集 ${r.matrix[3].rowTotal}`,
    );
  }
}

// 附带确认 encodeToken 没有被误用（快速健全性检查）
{
  const tokens = [1, -3, -2, 4].map(encodeToken);
  check('token 编码往返', tokens.length === 4);
}

if (failures > 0) {
  console.error(`需求核查失败 ${failures} 项`);
  process.exit(1);
}
console.log('需求核查全部通过');

