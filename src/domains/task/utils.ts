export function advanceDueDate(
  dueDateStr: string | Date,
  interval: string,
  count: number
): Date {
  const current = new Date(dueDateStr);
  const now = new Date();

  if (current >= now) return current;

  while (current < now) {
    switch (interval) {
      case 'days':
        current.setDate(current.getDate() + count);
        break;
      case 'weeks':
        current.setDate(current.getDate() + count * 7);
        break;
      case 'months':
        current.setMonth(current.getMonth() + count);
        break;
      case 'years':
        current.setFullYear(current.getFullYear() + count);
        break;
      default:
        // fallback to push 1 day if invalid
        current.setDate(current.getDate() + 1);
        break;
    }
  }
  return current;
}
