/// <reference lib="webworker" />
/**
 * 审计求解 Worker：n=7 最坏情况下完整枚举可达数秒，
 * 放在 Worker 中运行，避免阻塞页面交互。
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
  /** 风险审计模式下传入 n+1 个切口风险；缺省为普通模式 */
  risks?: number[] | null;
}

self.onmessage = (event: MessageEvent<AuditRequest>) => {
  const { tokens, risks = null } = event.data;
  const dto: AuditResultDTO = toDTO(
    risks ? solveWeighted(tokens, risks, 'risk') : solve(tokens),
  );
  (self as unknown as Worker).postMessage(dto);
};
