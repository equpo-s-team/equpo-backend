export interface ErrorDetail {
  path: string;
  message: string;
}

export class EqupoError extends Error {
  status?: number;
  details?: ErrorDetail[];

  constructor(message: string, status = 400, details?: ErrorDetail[]) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
    this.details = details;
  }
}
