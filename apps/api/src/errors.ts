import { errorEntry, type ApiErrorBody, type ErrorCode } from '@neuromep/shared';
import type { Response } from 'express';

/** Sends an error with its catalogue code and message (design doc Section 4). */
export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  extra: Record<string, unknown> = {},
): void {
  const body: ApiErrorBody = { code, error: errorEntry(code).message, ...extra };
  res.status(status).json(body);
}
