export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export class WorkflowDefinitionError extends WorkflowError {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowDefinitionError";
  }
}

export class UnknownStepError extends WorkflowError {
  constructor(stepId: string) {
    super(`Unknown step id: "${stepId}"`);
    this.name = "UnknownStepError";
  }
}

export class InvalidTransitionError extends WorkflowError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

export class UnauthorizedApproverError extends WorkflowError {
  constructor(approver: string) {
    super(`"${approver}" is not an authorized approver for this step`);
    this.name = "UnauthorizedApproverError";
  }
}

export class DuplicateVoteError extends WorkflowError {
  constructor(approver: string) {
    super(`"${approver}" has already voted on this approval`);
    this.name = "DuplicateVoteError";
  }
}

export class UnknownActionHandlerError extends WorkflowError {
  constructor(name: string) {
    super(`No action handler registered for "${name}"`);
    this.name = "UnknownActionHandlerError";
  }
}
