import type { RiskLevel } from '@huntara/agent-core';

export type ApprovalStatus = 'PENDING' | 'GRANTED' | 'REJECTED' | 'NOT_REQUIRED';

export interface ApprovalRequired {
  readonly kind: 'ApprovalRequired';
  readonly toolName: string;
  readonly requestId: string;
  readonly reason: string;
  readonly riskLevel: RiskLevel;
}

export interface ApprovalGranted {
  readonly kind: 'ApprovalGranted';
  readonly requestId: string;
  readonly grantedBy: string;
  readonly timestamp: string;
}

export interface ApprovalRejected {
  readonly kind: 'ApprovalRejected';
  readonly requestId: string;
  readonly rejectedBy: string;
  readonly reason: string;
  readonly timestamp: string;
}

export type ApprovalDecision = ApprovalGranted | ApprovalRejected;
