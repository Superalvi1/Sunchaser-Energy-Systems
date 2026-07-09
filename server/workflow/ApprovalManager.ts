import type { ApprovalDecision, ApprovalState, ApprovalVote } from "./types.ts";
import type { Clock } from "./Clock.ts";
import { DuplicateVoteError, UnauthorizedApproverError } from "./errors.ts";

export class ApprovalManager {
  constructor(private readonly clock: Clock) {}

  request(
    stepId: string,
    approvers: string[],
    quorum?: number,
    timeoutMs?: number
  ): ApprovalState {
    if (approvers.length === 0) {
      throw new RangeError(`Approval step "${stepId}" must have at least one approver`);
    }
    const resolvedQuorum = quorum ?? approvers.length;
    if (resolvedQuorum < 1 || resolvedQuorum > approvers.length) {
      throw new RangeError("quorum must be between 1 and the number of approvers");
    }
    return {
      stepId,
      approvers: [...approvers],
      quorum: resolvedQuorum,
      votes: [],
      status: "pending",
      requestedAt: this.clock.now(),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    };
  }

  vote(state: ApprovalState, approver: string, decision: ApprovalDecision): ApprovalState {
    if (state.status !== "pending") {
      throw new RangeError(`Cannot vote on an approval that is already "${state.status}"`);
    }
    if (!state.approvers.includes(approver)) {
      throw new UnauthorizedApproverError(approver);
    }
    if (state.votes.some((vote) => vote.approver === approver)) {
      throw new DuplicateVoteError(approver);
    }
    const vote: ApprovalVote = { approver, decision, timestamp: this.clock.now() };
    const next: ApprovalState = { ...state, votes: [...state.votes, vote] };
    next.status = this.computeStatus(next);
    return next;
  }

  computeStatus(state: ApprovalState): ApprovalState["status"] {
    const approvals = state.votes.filter((v) => v.decision === "approved").length;
    const rejections = state.votes.filter((v) => v.decision === "rejected").length;
    if (approvals >= state.quorum) return "approved";
    const maxPossibleApprovals = state.approvers.length - rejections;
    if (maxPossibleApprovals < state.quorum) return "rejected";
    return "pending";
  }

  isTimedOut(state: ApprovalState): boolean {
    if (state.status !== "pending" || state.timeoutMs === undefined) return false;
    return this.clock.now() - state.requestedAt >= state.timeoutMs;
  }
}
