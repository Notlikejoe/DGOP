import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type DgopErrorCode =
  | 'VAL-400'
  | 'VAL-422'
  | 'SES-401'
  | 'PER-403'
  | 'BUS-404'
  | 'BUS-409'
  | 'RATE-429'
  | 'INT-400'
  | 'SYS-500';

export type ErrorExperience = {
  status: number;
  error: string;
  code: DgopErrorCode;
  message: string | string[];
  userMessage: string;
  retryable: boolean;
};

const HTTP_ERROR_LABELS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

export const ERROR_CATALOG: Record<DgopErrorCode, { userMessage: string; retryable: boolean }> = {
  'VAL-400': {
    userMessage: 'Some fields need correction before this can be saved.',
    retryable: false,
  },
  'VAL-422': {
    userMessage: 'The request was understood, but one or more values are not valid for this workflow.',
    retryable: false,
  },
  'SES-401': {
    userMessage: 'Your session is no longer active. Sign in again to continue.',
    retryable: false,
  },
  'PER-403': {
    userMessage: 'You do not have access to complete this action. Ask an administrator or data owner for access.',
    retryable: false,
  },
  'BUS-404': {
    userMessage: 'The record was not found or is outside your visible governance scope.',
    retryable: false,
  },
  'BUS-409': {
    userMessage: 'This action conflicts with an existing governance record. Review the existing item and try again.',
    retryable: false,
  },
  'RATE-429': {
    userMessage: 'Too many requests were sent in a short time. Wait a moment and try again.',
    retryable: true,
  },
  'INT-400': {
    userMessage: 'The file or import payload could not be processed. Review the import issues and try again.',
    retryable: false,
  },
  'SYS-500': {
    userMessage: 'The platform could not complete this request. Try again or share the request ID with support.',
    retryable: true,
  },
};

export function statusToErrorCode(status: number): DgopErrorCode {
  if (status === HttpStatus.UNAUTHORIZED) return 'SES-401';
  if (status === HttpStatus.FORBIDDEN) return 'PER-403';
  if (status === HttpStatus.NOT_FOUND) return 'BUS-404';
  if (status === HttpStatus.CONFLICT) return 'BUS-409';
  if (status === HttpStatus.UNPROCESSABLE_ENTITY) return 'VAL-422';
  if (status === HttpStatus.TOO_MANY_REQUESTS) return 'RATE-429';
  if (status >= HttpStatus.INTERNAL_SERVER_ERROR) return 'SYS-500';
  return 'VAL-400';
}

export function publicErrorLabel(status: number): string {
  return HTTP_ERROR_LABELS[status] ?? 'Error';
}

export function normalizeHttpMessage(message: unknown, fallback: string): string | string[] {
  if (Array.isArray(message)) {
    return message.map((item) => String(item)).filter(Boolean);
  }
  if (typeof message === 'string' && message.trim()) return message;
  return fallback;
}

export function prismaErrorExperience(exception: Prisma.PrismaClientKnownRequestError): ErrorExperience {
  if (exception.code === 'P2002') {
    return buildErrorExperience(HttpStatus.CONFLICT, 'A record with the same unique value already exists', 'BUS-409');
  }
  if (exception.code === 'P2025') {
    return buildErrorExperience(HttpStatus.NOT_FOUND, 'The requested record was not found', 'BUS-404');
  }
  return buildErrorExperience(HttpStatus.BAD_REQUEST, 'The request could not be processed', 'VAL-400');
}

export function buildErrorExperience(
  status: number,
  message: string | string[],
  code = statusToErrorCode(status),
): ErrorExperience {
  const catalog = ERROR_CATALOG[code];
  return {
    status,
    error: publicErrorLabel(status),
    code,
    message,
    userMessage: catalog.userMessage,
    retryable: catalog.retryable,
  };
}
