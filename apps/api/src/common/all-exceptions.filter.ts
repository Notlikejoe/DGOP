import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  buildErrorExperience,
  normalizeHttpMessage,
  prismaErrorExperience,
  publicErrorLabel,
  statusToErrorCode,
} from './error-experience.logic';

/** Normalized error shape returned for every failed request. */
interface ErrorBody {
  statusCode: number;
  code: string;
  error: string;
  message: string | string[];
  userMessage: string;
  retryable: boolean;
  method: string;
  path: string;
  timestamp: string;
  requestId: string;
  correlationId: string;
}

/**
 * Catches every unhandled exception and returns a consistent JSON envelope.
 * Known Prisma errors are mapped to sensible HTTP codes; anything unexpected
 * becomes a generic 500 so internal details never leak to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const requestId = this.header(req, 'x-request-id') ?? randomUUID();
    const correlationId = this.header(req, 'x-correlation-id') ?? requestId;
    const { status, error, code, message, userMessage, retryable } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${req.method} ${req.url} -> ${status} ${code} requestId=${requestId}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (status >= HttpStatus.BAD_REQUEST) {
      this.logger.warn(`${req.method} ${req.url} -> ${status} ${code} requestId=${requestId}`);
    }

    const body: ErrorBody = {
      statusCode: status,
      code,
      error,
      message,
      userMessage,
      retryable,
      method: req.method,
      path: req.url,
      timestamp: new Date().toISOString(),
      requestId,
      correlationId,
    };
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-correlation-id', correlationId);
    res.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    error: string;
    code: string;
    message: string | string[];
    userMessage: string;
    retryable: boolean;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message = normalizeHttpMessage(
        typeof response === 'string'
          ? response
          : (response as { message?: string | string[] }).message,
        exception.message || publicErrorLabel(status),
      );
      const error =
        typeof response === 'object' && response !== null && 'error' in response
          ? String((response as { error: unknown }).error)
          : publicErrorLabel(status);
      const experience = buildErrorExperience(status, message, statusToErrorCode(status));
      return { ...experience, error };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return prismaErrorExperience(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return buildErrorExperience(HttpStatus.BAD_REQUEST, 'Invalid request payload', 'VAL-400');
    }

    // Multer (file upload) errors, e.g. LIMIT_FILE_SIZE.
    if (exception instanceof Error && exception.name === 'MulterError') {
      const code = (exception as { code?: string }).code;
      const message =
        code === 'LIMIT_FILE_SIZE' ? 'The uploaded file is too large' : 'File upload failed';
      return buildErrorExperience(HttpStatus.BAD_REQUEST, message, 'INT-400');
    }

    return buildErrorExperience(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'An unexpected error occurred',
      'SYS-500',
    );
  }

  private header(req: Request, name: string): string | null {
    const value = req.headers[name];
    if (Array.isArray(value)) return value[0] ?? null;
    if (typeof value === 'string' && value.trim()) return value;
    return null;
  }
}
