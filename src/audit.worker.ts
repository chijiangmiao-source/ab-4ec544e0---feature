/// <reference lib="webworker" />
/**
 * 审计求解 Worker：n=7 最坏情况下完整枚举可达数秒，
 * 放在 Worker 中运行，避免阻塞页面交互。
 * 普通模式按最少倒位步数审计；风险模式按 n+1 个切口风险的
 * 最低累计风险枚举全部同优方案（步数可不相同）。
 */
import { type Token } from './lib/permutation';
import {
  solve,
  solveWeighted,
  toDTO,
  type AuditResultDTO,
} from './lib/solver';

export interface AuditRequest {
  tokens: Token[];
  mode: 'steps' | 'risk';
  /** 风险模式下为 n+1 个 1..9 的切口风险，普通模式省略 */
  risks?: number[];
}

self.onmessage = (event: MessageEvent<AuditRequest>) => {
  const { tokens, mode, risks } = event.data;
  const result =
    mode === 'risk' && risks ? solveWeighted(tokens, risks) : solve(tokens);
  const dto: AuditResultDTO = toDTO(result);
  (self as unknown as Worker).postMessage(dto);
};
