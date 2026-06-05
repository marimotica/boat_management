// Work item status metadata shared by the board and the lifecycle sheet. Kept
// as a tiny pure module so labels and column ordering are defined once and can
// be unit-tested independently of the Lit components. The status strings mirror
// WorkItemStatus on the backend (the backend remains the source of truth for
// which transitions are legal).

export const WORK_STATUS = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  REVIEW: "review",
  BLOCKED: "blocked",
  DEFERRED: "deferred",
  DONE: "done",
  CANCELLED: "cancelled",
} as const;

export type WorkStatus = (typeof WORK_STATUS)[keyof typeof WORK_STATUS];

const LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  blocked: "Blocked",
  deferred: "Deferred",
  done: "Done",
  cancelled: "Cancelled",
};

// Columns shown on the board, in lifecycle order. Cancelled work is terminal
// and intentionally omitted: it is not actionable and would only add noise.
export const BOARD_COLUMNS: { status: WorkStatus; label: string }[] = [
  { status: WORK_STATUS.TODO, label: LABELS.todo },
  { status: WORK_STATUS.IN_PROGRESS, label: LABELS.in_progress },
  { status: WORK_STATUS.REVIEW, label: LABELS.review },
  { status: WORK_STATUS.BLOCKED, label: LABELS.blocked },
  { status: WORK_STATUS.DEFERRED, label: LABELS.deferred },
  { status: WORK_STATUS.DONE, label: LABELS.done },
];

export function statusLabel(status: string): string {
  return LABELS[status] ?? status;
}
