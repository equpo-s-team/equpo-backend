type DateInput = Date | string;

function toDate(value: DateInput): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid task date value for Firestore sync');
  }
  return date;
}

export type TaskFirestoreSyncInput = {
  taskId: string;
  teamId: string;
  name?: string;
  description?: string | null;
  dueDate: DateInput;
  priority: string;
  createdAt: DateInput;
  updatedAt: DateInput;
  category: string[];
  status: string;
  isRecurring: boolean;
  recurringInterval: string | null;
  recurringCount: number | null;
  assignedUserId: string | null;
  assignedGroup: string | null;
};

export function buildTaskFirestoreDocument(input: TaskFirestoreSyncInput) {
  const createdAt = toDate(input.createdAt);
  const updatedAt = toDate(input.updatedAt);

  const payload: Record<string, unknown> = {
    dueDate: toDate(input.dueDate),
    priority: input.priority,
    createdAt,
    updatedAt,
    category: input.category,
    status: input.status,
    isRecurring: input.isRecurring,
    recurringInterval: input.recurringInterval,
    recurringCount: input.recurringCount,
    assignedUserId: input.assignedUserId,
    assignedGroup: input.assignedGroup,
  };

  if (input.name !== undefined) {
    payload.name = input.name;
  }
  if (input.description !== undefined) {
    payload.description = input.description;
  }

  return payload;
}
