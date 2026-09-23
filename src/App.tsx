import { useCallback, useRef, useState } from 'react';
import {
  formatBigIntDecimal,
  tokenToSigned,
  validatePermutation,
  validateRisks,
  type Token,
} from './lib/permutation';
import {
  fromDTO,
  solve,
  solveWeighted,
  toDTO,
  type AuditMode,
  type AuditResult,
  type AuditResultDTO,
  type IntervalCell,
} from './lib/solver';
import type { AuditRequest } from './audit.worker';

const EXAMPLES = [
  '1,-3,-2,4',
  '-1,-2,-3',
  '3,2,1',
  '-7,6,-5,4,-3,2,-1',
];

interface SelectedCell {
  depth: number;
  start: number;
  end: number;
}

export function App() {
  const [mode, setMode] = useState<AuditMode>('unit');
  const [input, setInput] = useState('1,-3,-2,4');
  const [riskInput, setRiskInput] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [computing, setComputing] = useState(false);
  // 当前查看的深度（0 表示尚未执行任何倒位）。
  const [activeDepth, setActiveDepth] = useState(0);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const runAudit = useCallback(() => {
    const { tokens, tokenCount, errors: permErrors } = validatePermutation(input);
    // 风险模式还需校验 n+1 个切口风险；排列非法时若标记数量在 3..7 内，
    // 仍可对风险个数做联动校验（错误合并反馈，文本一律保留）。
    const riskN =
      tokens !== undefined
        ? tokens.length
        : tokenCount >= 3 && tokenCount <= 7
          ? tokenCount
          : undefined;
    const riskCheck =
      mode === 'risk'
        ? validateRisks(riskInput, riskN)
        : { risks: undefined as number[] | undefined, errors: [] as string[] };

    // 无论合法与否，输入文本都原样保留；错误合并为一次反馈。
    const allErrors = [...permErrors, ...riskCheck.errors];
    setErrors(allErrors);
    if (!tokens || (mode === 'risk' && !riskCheck.risks)) {
      setResult(null);
      return;
    }
    const risks = mode === 'risk' ? riskCheck.risks! : null;

    setComputing(true);
    setResult(null);
    setSelected(null);
    setActiveDepth(0);

    const finish = (dto: AuditResultDTO) => {
      setResult(fromDTO(dto));
      setComputing(false);
    };

    try {
      if (!workerRef.current) {
        workerRef.current = new Worker(
          new URL('./audit.worker.ts', import.meta.url),
          { type: 'module' },
        );
      }
      const worker = workerRef.current;
      worker.onmessage = (event: MessageEvent<AuditResultDTO>) =>
        finish(event.data);
      const message: AuditRequest = { tokens, risks };
      worker.postMessage(message);
    } catch {
      // Worker 不可用时退回主线程求解（功能不降级，仅可能短暂阻塞）。
      finish(
        toDTO(
          risks
            ? solveWeighted(tokens, risks, 'risk')
            : solve(tokens),
        ),
      );
    }
  }, [input, riskInput, mode]);

  return (
    <main className="page">
      <header className="header">
        <h1>带符号标记排列 · 规范倒位审计</h1>
        <p className="subtitle">
          浏览器内对全部最优方案做精确枚举：普通模式给出最少步数，风险审计模式
          给出最低累计风险；均含任意精度方案总数、按每步 <code>[起,止]</code>{' '}
          下标对字典序选出的规范方案，以及逐深度区间出现矩阵。
          所有计算均在本机完成，无后端、无网络请求。
        </p>
      </header>

      <section className="card" aria-label="排列输入">
        <div className="mode-switch" role="tablist" aria-label="审计模式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'unit'}
            className={mode === 'unit' ? 'mode mode-active' : 'mode'}
            onClick={() => {
              setMode('unit');
              setResult(null);
              setErrors([]);
              setSelected(null);
            }}
          >
            普通模式（按倒位次数）
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'risk'}
            className={mode === 'risk' ? 'mode mode-active' : 'mode'}
            onClick={() => {
              setMode('risk');
              setResult(null);
              setErrors([]);
              setSelected(null);
            }}
          >
            风险审计模式（按切口风险）
          </button>
        </div>

        <label className="field-label" htmlFor="perm-input">
          带符号排列（3 至 7 个标记，绝对值须恰好为 1 至 n 且互异）
        </label>
        <textarea
          id="perm-input"
          className="perm-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={2}
          spellCheck={false}
          placeholder="例如：1,-3,-2,4"
        />
        <div className="examples">
          <span className="muted">示例：</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip"
              onClick={() => setInput(ex)}
            >
              {ex}
            </button>
          ))}
        </div>

        {mode === 'risk' && (
          <div className="risk-field">
            <label className="field-label" htmlFor="risk-input">
              切口风险（须恰好 n+1 个，即排列两端与相邻标记之间的 n+1 个切口；
              每个为 1 至 9 的正整数。倒位 [i,j] 的代价 = 切口 r(i-1) 与 r(j) 风险之和）
            </label>
            <textarea
              id="risk-input"
              className="perm-input"
              value={riskInput}
              onChange={(e) => setRiskInput(e.target.value)}
              rows={2}
              spellCheck={false}
              placeholder="例如 n=3 时填写 4 个：1 5 9 1（依次为 r0, r1, r2, r3）"
            />
            <div className="examples">
              <button
                type="button"
                className="chip"
                onClick={() => {
                  const { tokens, tokenCount } = validatePermutation(input);
                  const n =
                    tokens?.length ??
                    (tokenCount >= 3 && tokenCount <= 7 ? tokenCount : 7);
                  setRiskInput(new Array(n + 1).fill(1).join(' '));
                }}
                title="按当前排列的 n+1 个切口填入等权风险 1"
              >
                全部等权（按 n+1 个填 1）
              </button>
            </div>
          </div>
        )}

        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={runAudit}
            disabled={computing}
          >
            {computing ? '审计进行中…' : '启动审计'}
          </button>
          {computing && <span className="muted">n=7 最坏情况约需数秒</span>}
        </div>
        {errors.length > 0 && (
          <div className="alert" role="alert">
            <strong>输入不合法，请一并修正：</strong>
            <ul>
              {errors.map((msg, idx) => (
                <li key={idx}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {result && <ResultView result={result} activeDepth={activeDepth} setActiveDepth={setActiveDepth} selected={selected} setSelected={setSelected} />}

      <footer className="footer muted">
        倒位语义：选取闭区间 [i,j]，反转区间内标记次序并同时翻转每个符号。
      </footer>
    </main>
  );
}

function ResultView({
  result,
  activeDepth,
  setActiveDepth,
  selected,
  setSelected,
}: {
  result: AuditResult;
  activeDepth: number;
  setActiveDepth: (d: number) => void;
  selected: SelectedCell | null;
  setSelected: (s: SelectedCell | null) => void;
}) {
  const { minCost, distance, maxSteps, minSteps, totalPaths, canonical, matrix } = result;
  const riskMode = result.mode === 'risk';

  const currentStep =
    activeDepth < canonical.steps.length ? canonical.steps[activeDepth] : null;

  const jumpToDepth = useCallback(
    (cell: IntervalCell, depth: number) => {
      setActiveDepth(depth);
      setSelected({ depth, start: cell.start, end: cell.end });
    },
    [setActiveDepth, setSelected],
  );

  return (
    <>
      <section className="card summary" aria-label="审计结论">
        <div className="stat">
          <div className="stat-value">{riskMode ? minCost : distance}</div>
          <div className="stat-label">
            {riskMode ? '最低累计风险' : '最少倒位步数'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-value big" title={totalPaths.toString()}>
            {formatBigIntDecimal(totalPaths)}
          </div>
          <div className="stat-label">
            {riskMode ? '最低风险方案总数（精确十进制）' : '最短方案总数（精确十进制）'}
          </div>
        </div>
        {riskMode ? (
          <div className="stat">
            <div className="stat-value">
              {minSteps === maxSteps ? minSteps : `${minSteps}–${maxSteps}`}
            </div>
            <div className="stat-label">最优方案步数范围（不同方案可不同长）</div>
          </div>
        ) : (
          <div className="stat">
            <div className="stat-value">{result.n}</div>
            <div className="stat-label">标记数 n</div>
          </div>
        )}
      </section>

      <section className="card" aria-label="规范方案轨迹">
        <h2>规范方案轨迹</h2>
        <p className="muted">
          {canonical.steps.length === 0
            ? '输入已是全正顺序，无需倒位。'
            : `在全部${riskMode ? '最低风险' : '最短'}方案中，按每步 (起, 止) 下标对序列的字典序选出。该规范轨迹共 ${canonical.steps.length} 步，可单步查看：`}
        </p>

        {canonical.steps.length > 0 && (
          <Trajectory
            result={result}
            activeDepth={activeDepth}
            setActiveDepth={(d) => {
              // 手动浏览深度时清除矩阵选中，避免高亮仍指向旧深度。
              setSelected(null);
              setActiveDepth(d);
            }}
          />
        )}

        {currentStep && (
          <p className="step-hint">
            第 {activeDepth + 1} 步：对闭区间{' '}
            <strong>
              [{currentStep.start}, {currentStep.end}]
            </strong>{' '}
            执行倒位（反转次序并翻转符号
            {riskMode
              ? `，代价 ${result.risks[currentStep.start - 1] + result.risks[currentStep.end]}`
              : ''}
            ）。
          </p>
        )}
        {riskMode && activeDepth >= canonical.steps.length && canonical.steps.length > 0 && (
          <p className="step-hint muted">
            规范轨迹在第 {canonical.steps.length} 步后已到达全正顺序；
            矩阵仍展示更长的同优轨迹（最长 {maxSteps} 步）。
          </p>
        )}
      </section>

      {matrix.length > 0 && (
        <section className="card" aria-label="深度区间矩阵">
          <h2>深度 × 区间出现矩阵</h2>
          <Legend selected={selected} canonicalAtDepth={selected ? canonical.steps[selected.depth] ?? null : null} />
          <div className="table-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th className="corner">深度 ＼ 区间</th>
                  {matrix[0].intervals.map((cell) => (
                    <th key={`${cell.start}-${cell.end}`}>
                      {cell.start}-{cell.end}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((layer) => {
                  const canon = canonical.steps[layer.depth];
                  return (
                    <tr key={layer.depth}>
                      <th scope="row" className="rowhead">
                        第 {layer.depth + 1} 步
                        <span className="rowtotal" title="仍包含该深度的最优方案数（本行比较全集）">
                          （全集 {formatBigIntDecimal(layer.rowTotal)}）
                        </span>
                      </th>
                      {layer.intervals.map((cell) => {
                        const isCanonical =
                          canon !== undefined &&
                          canon.start === cell.start &&
                          canon.end === cell.end;
                        const isSelected =
                          selected?.depth === layer.depth &&
                          selected.start === cell.start &&
                          selected.end === cell.end;
                        const dimmed =
                          selected !== null && !isSelected && !isCanonical;
                        return (
                          <td key={`${cell.start}-${cell.end}`}>
                            <button
                              type="button"
                              className={[
                                'cell',
                                `cell-${cell.presence}`,
                                isCanonical ? 'cell-canonical' : '',
                                isSelected ? 'cell-selected' : '',
                                dimmed ? 'cell-dimmed' : '',
                              ].join(' ')}
                              onClick={() => jumpToDepth(cell, layer.depth)}
                              title={cellTitle(cell, layer.rowTotal, riskMode)}
                            >
                              <span className="cell-count">
                                {formatBigIntDecimal(cell.pathCount)}
                              </span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            每格数字为：在该深度选择该区间的{riskMode ? '最低风险' : '最短'}方案数量
            （bigint 精确计数）；矩阵行数覆盖最长的同优轨迹（{maxSteps} 步），
            每行只以<strong>仍包含该深度</strong>的方案为比较全集（行首标注），
            故每行之和等于该全集数，而非总方案数。加粗描边格为规范方案在该深度的选择；
            点击任意格，轨迹视图联动跳转到对应深度。
          </p>
        </section>
      )}
    </>
  );
}

function cellTitle(cell: IntervalCell, rowTotal: bigint, riskMode: boolean): string {
  const kind = riskMode ? '最低风险' : '最短';
  const scope =
    cell.presence === 'all'
      ? `仍包含该深度的全部${kind}方案`
      : cell.presence === 'some'
        ? `部分${kind}方案`
        : `任何${kind}方案在该深度均未出现`;
  return `区间 [${cell.start}, ${cell.end}]：${scope}，出现于 ${cell.pathCount} 个方案（该行全集 ${rowTotal} 个）`;
}

function Legend({
  selected,
  canonicalAtDepth,
}: {
  selected: SelectedCell | null;
  canonicalAtDepth: { start: number; end: number } | null;
}) {
  return (
    <div className="legend">
      <span className="legend-item">
        <i className="swatch swatch-all" /> 该行全部方案均出现
      </span>
      <span className="legend-item">
        <i className="swatch swatch-some" /> 仅部分方案出现
      </span>
      <span className="legend-item">
        <i className="swatch swatch-none" /> 该深度任何方案均未出现
      </span>
      <span className="legend-item">
        <i className="swatch swatch-canonical" /> 规范方案选择
      </span>
      {selected && (
        <span className="legend-note" role="status">
          已选第 {selected.depth + 1} 步区间 [{selected.start}, {selected.end}]
          {canonicalAtDepth &&
          canonicalAtDepth.start === selected.start &&
          canonicalAtDepth.end === selected.end
            ? '，正是规范轨迹上的倒位。'
            : '，该倒位不在规范轨迹上（规范选择见描边格）。'}
        </span>
      )}
    </div>
  );
}

function Trajectory({
  result,
  activeDepth,
  setActiveDepth,
}: {
  result: AuditResult;
  activeDepth: number;
  setActiveDepth: (d: number) => void;
}) {
  const { canonical, maxSteps } = result;
  const states = canonical.states;
  // 规范轨迹可能短于最长同优轨迹：超出后停留在其终态展示。
  const stateIndex = Math.min(activeDepth, states.length - 1);
  const current = states[stateIndex];
  const ended = activeDepth >= canonical.steps.length;
  const next = !ended && activeDepth < maxSteps ? states[activeDepth + 1] : null;
  const step = activeDepth < canonical.steps.length ? canonical.steps[activeDepth] : null;

  const positions = new Set<number>();
  if (step) {
    // 当前态中哪些位置落在本步倒位区间内（倒位后位置不变，仅次序与符号变）
    for (let k = step.start - 1; k <= step.end - 1; k += 1) positions.add(k);
  }

  return (
    <div>
      <div className="stepper">
        <button
          type="button"
          onClick={() => setActiveDepth(Math.max(0, activeDepth - 1))}
          disabled={activeDepth === 0}
        >
          ← 上一步
        </button>
        <span className="stepper-pos">
          深度 {activeDepth} / {maxSteps}（规范轨迹共 {canonical.steps.length} 步）
        </span>
        <button
          type="button"
          onClick={() => setActiveDepth(Math.min(maxSteps, activeDepth + 1))}
          disabled={activeDepth === maxSteps}
        >
          下一步 →
        </button>
      </div>

      <div className="states">
        <StateRow
          tokens={current}
          marks={positions}
          caption={
            ended
              ? `深度 ${activeDepth}（规范轨迹 ${canonical.steps.length} 步已结束，此为其终态；该深度属于更长的同优轨迹）`
              : `深度 ${activeDepth}（执行前）`
          }
        />
        {step && (
          <div className="arrow" aria-hidden="true">
            → [{step.start},{step.end}]
          </div>
        )}
        {next && (
          <StateRow tokens={next} marks={positions} caption={`深度 ${activeDepth + 1}（执行后）`} muted />
        )}
      </div>

      <input
        className="scrub"
        type="range"
        min={0}
        max={maxSteps}
        value={activeDepth}
        onChange={(e) => setActiveDepth(Number(e.target.value))}
        aria-label="选择查看的深度"
      />
    </div>
  );
}

function StateRow({
  tokens,
  marks,
  caption,
  muted = false,
}: {
  tokens: Token[];
  marks: Set<number>;
  caption: string;
  muted?: boolean;
}) {
  return (
    <div className={`state-row ${muted ? 'state-next' : ''}`}>
      <div className="state-caption muted">{caption}</div>
      <div className="markers">
        {tokens.map((t, idx) => {
          const value = tokenToSigned(t);
          return (
            <span
              key={idx}
              className={[
                'marker',
                value < 0 ? 'marker-neg' : 'marker-pos',
                marks.has(idx) ? 'marker-hit' : '',
              ].join(' ')}
            >
              {value > 0 ? `+${value}` : value}
            </span>
          );
        })}
      </div>
    </div>
  );
}
