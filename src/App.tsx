import { useCallback, useRef, useState } from 'react';
import {
  formatBigIntDecimal,
  riskFormatErrors,
  splitRawParts,
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
  const [mode, setMode] = useState<AuditMode>('steps');
  const [input, setInput] = useState('1,-3,-2,4');
  const [riskInput, setRiskInput] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [computing, setComputing] = useState(false);
  // 当前查看的深度（0 表示尚未执行任何倒位）。
  const [activeDepth, setActiveDepth] = useState(0);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // 文本框中切出的标记数（仅用于风险框占位与等权预填，不做合法性假设）。
  const partCount = splitRawParts(input).length;

  const switchMode = (next: AuditMode) => {
    if (next === mode) return;
    setMode(next);
    setErrors([]);
    setResult(null);
    setSelected(null);
    setActiveDepth(0);
    if (next === 'risk' && riskInput.trim() === '' && partCount >= 3 && partCount <= 7) {
      // 首次进入风险模式时给出 n+1 个等权切口作为可编辑起点（文本仍可保留修改）。
      setRiskInput(Array(partCount + 1).fill(1).join(' '));
    }
  };

  const runAudit = useCallback(() => {
    const { tokens, errors: permErrors } = validatePermutation(input);
    // 无论合法与否，输入文本都原样保留；错误合并为一次反馈。
    let merged = permErrors;

    let risks: number[] | undefined;
    if (mode === 'risk') {
      if (tokens) {
        const riskResult = validateRisks(riskInput, tokens.length);
        risks = riskResult.risks;
        merged = [...permErrors, ...riskResult.errors];
      } else {
        // 排列不合法时无法确定切口数 n+1，但仍对风险逐项格式合并反馈；
        // 两份文本都原样保留，不会被清空。
        merged = [...permErrors, ...riskFormatErrors(riskInput)];
      }
    }
    setErrors(merged);
    if (!tokens || (mode === 'risk' && !risks)) {
      setResult(null);
      return;
    }

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
      const message: AuditRequest =
        mode === 'risk'
          ? { tokens, mode, risks }
          : { tokens, mode: 'steps' };
      worker.postMessage(message);
    } catch {
      // Worker 不可用时退回主线程求解（功能不降级，仅可能短暂阻塞）。
      const r = mode === 'risk' ? solveWeighted(tokens, risks!) : solve(tokens);
      finish(toDTO(r));
    }
  }, [input, riskInput, mode]);

  return (
    <main className="page">
      <header className="header">
        <h1>带符号标记排列 · 规范倒位审计</h1>
        <p className="subtitle">
          浏览器内对全部最优方案做精确枚举：普通模式给出最少步数；
          风险审计模式为 n+1 个切口填写 1 至 9 的风险，倒位区间代价取
          两端切口风险之和，给出最低累计风险。均含任意精度方案总数、
          按每步 <code>[起,止]</code> 下标对字典序选出的规范方案，
          以及逐深度区间出现矩阵。所有计算均在本机完成，无后端、无网络请求。
        </p>
      </header>

      <section className="card" aria-label="排列输入">
        <div className="mode-switch" role="tablist" aria-label="审计模式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'steps'}
            className={mode === 'steps' ? 'mode-tab mode-tab-active' : 'mode-tab'}
            onClick={() => switchMode('steps')}
          >
            普通模式（最少倒位步数）
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'risk'}
            className={mode === 'risk' ? 'mode-tab mode-tab-active' : 'mode-tab'}
            onClick={() => switchMode('risk')}
          >
            风险审计模式（最低累计风险）
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
              切口风险（{partCount >= 3 && partCount <= 7 ? `${partCount + 1} 个` : 'n+1 个'}
              ，依次为标记 1 之前 … 标记 n 之后；每个为 1 至 9 的正整数。
              区间 [i,j] 的代价 = 切口 i 风险 + 切口 j+1 风险）
            </label>
            <textarea
              id="risk-input"
              className="perm-input risk-input"
              value={riskInput}
              onChange={(e) => setRiskInput(e.target.value)}
              rows={1}
              spellCheck={false}
              placeholder={
                partCount >= 3 && partCount <= 7
                  ? `例如（全部等权）：${Array(partCount + 1).fill(1).join(' ')}`
                  : '例如 n=3 时：1 2 3 1'
              }
            />
          </div>
        )}

        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={runAudit}
            disabled={computing}
          >
            {computing ? '审计进行中…' : mode === 'risk' ? '启动风险审计' : '启动审计'}
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
  const { distance, optimalCost, totalPaths, canonical, matrix, mode } = result;

  const currentStep =
    activeDepth < distance ? canonical.steps[activeDepth] : null;

  const jumpToDepth = useCallback(
    (cell: IntervalCell, depth: number) => {
      // 规范轨迹可能比最长同优轨迹短：矩阵行数覆盖最长轨迹，
      // 点击超出规范步数的行时，轨迹视图停在规范轨迹终点，格子仍高亮并计数。
      setActiveDepth(Math.min(depth, distance));
      setSelected({ depth, start: cell.start, end: cell.end });
    },
    [setActiveDepth, setSelected, distance],
  );

  return (
    <>
      <section className="card summary" aria-label="审计结论">
        <div className="stat">
          <div className="stat-value">{optimalCost}</div>
          <div className="stat-label">
            {mode === 'risk' ? '最低累计风险' : '最少倒位步数'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-value big" title={totalPaths.toString()}>
            {formatBigIntDecimal(totalPaths)}
          </div>
          <div className="stat-label">
            {mode === 'risk' ? '最低风险方案总数（精确十进制）' : '最短方案总数（精确十进制）'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-value">{distance}</div>
          <div className="stat-label">规范轨迹倒位步数</div>
        </div>
        <div className="stat">
          <div className="stat-value">{result.n}</div>
          <div className="stat-label">标记数 n</div>
        </div>
      </section>

      <section className="card" aria-label="规范方案轨迹">
        <h2>规范方案轨迹</h2>
        <p className="muted">
          {distance === 0
            ? '输入已是全正顺序，无需倒位。'
            : mode === 'risk'
              ? `在全部 ${formatBigIntDecimal(totalPaths)} 个最低风险方案中，按每步 (起, 止) 下标对序列的字典序选出（同优方案步数可不同，本轨迹共 ${distance} 步）。可单步查看：`
              : '在全部最短方案中，按每步 (起, 止) 下标对序列的字典序选出。可单步查看：'}
        </p>

        {distance > 0 && (
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
            {mode === 'risk' && result.risks
              ? `，本步代价 ${result.risks[currentStep.start - 1] + result.risks[currentStep.end]}`
              : ''}
            ）。
          </p>
        )}
      </section>

      {distance > 0 && matrix.length > 0 && (
        <section className="card" aria-label="深度区间矩阵">
          <h2>深度 × 区间出现矩阵</h2>
          <Legend selected={selected} mode={mode} canonicalAtDepth={selected ? canonical.steps[selected.depth] ?? null : null} />
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
                  <th className="corner">本深度比较全集</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((layer) => {
                  const canon = canonical.steps[layer.depth];
                  return (
                    <tr key={layer.depth}>
                      <th scope="row" className="rowhead">
                        第 {layer.depth + 1} 步
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
                              title={cellTitle(cell, layer.aliveCount, mode)}
                            >
                              <span className="cell-count">
                                {formatBigIntDecimal(cell.pathCount)}
                              </span>
                            </button>
                          </td>
                        );
                      })}
                      <th className="rowhead alive-head" title="仍包含该深度（长度大于该深度）的最优方案数量">
                        {formatBigIntDecimal(layer.aliveCount)}
                      </th>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            每格数字为：在该深度选择该区间的{mode === 'risk' ? '最低风险' : '最短'}方案数量（bigint 精确计数）；
            每行各格之和等于该行“比较全集”——即仍包含该深度的方案数
            {mode === 'risk'
              ? '（风险模式下同优方案步数可不同：较短方案在其收尾后退出全集，矩阵行数覆盖最长同优轨迹，全程不截断、不重复计数）'
              : '（普通模式下每行均等于方案总数）'}
            。白色描边格为规范方案在该深度的选择；点击任意格，轨迹视图联动跳转到对应深度。
          </p>
        </section>
      )}
    </>
  );
}

function cellTitle(cell: IntervalCell, aliveCount: bigint, mode: AuditMode): string {
  const noun = mode === 'risk' ? '最低风险方案' : '最短方案';
  const scope =
    cell.presence === 'all'
      ? `该深度仍存活的全部${noun}`
      : cell.presence === 'some'
        ? `该深度仍存活的部分${noun}`
        : `任何仍含该深度的${noun}中均未出现`;
  return `区间 [${cell.start}, ${cell.end}]：${scope}；出现于 ${cell.pathCount} / ${aliveCount} 个${noun}`;
}

function Legend({
  selected,
  mode,
  canonicalAtDepth,
}: {
  selected: SelectedCell | null;
  mode: AuditMode;
  canonicalAtDepth: { start: number; end: number } | null;
}) {
  const noun = mode === 'risk' ? '最低风险方案' : '最短方案';
  return (
    <div className="legend">
      <span className="legend-item">
        <i className="swatch swatch-all" /> 该深度全部存活方案均出现
      </span>
      <span className="legend-item">
        <i className="swatch swatch-some" /> 仅部分存活方案出现
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
            : canonicalAtDepth === undefined
              ? `，该深度已超出规范轨迹的步数（规范轨迹更短，但同为最低${mode === 'risk' ? '风险' : '代价'}方案）。`
              : '，该倒位不在规范轨迹上（规范选择见描边格；颜色比较的是该深度仍存活的' + noun + '）。'}
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
  const { canonical, distance } = result;
  const states = canonical.states;
  const current = states[activeDepth];
  const next = activeDepth < distance ? states[activeDepth + 1] : null;
  const step = activeDepth < distance ? canonical.steps[activeDepth] : null;

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
          深度 {activeDepth} / {distance}
        </span>
        <button
          type="button"
          onClick={() => setActiveDepth(Math.min(distance, activeDepth + 1))}
          disabled={activeDepth === distance}
        >
          下一步 →
        </button>
      </div>

      <div className="states">
        <StateRow tokens={current} marks={positions} caption={`深度 ${activeDepth}（执行前）`} />
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
        max={distance}
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
