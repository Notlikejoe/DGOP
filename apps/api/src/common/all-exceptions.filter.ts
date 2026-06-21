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

/** Normalized error shape returned for every failed request. */
interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
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

    const { status, error, message } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${req.method} ${req.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      error,
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
    };
    res.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    error: string;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      const error =
        typeof response === 'object' && response !== null && 'error' in response
          ? String((response as { error: unknown }).error)
          : HttpStatus[status] ?? 'Error';
      return { status, error, message };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 unique constraint, P2025 record not found.
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'A record with the same unique value already exists',
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          error: 'Not Found',
          message: 'The requested record was not found',
        };
      }
      return {
        status: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'The request could not be processed',
      };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Invalid request payload',
      };
    }

    // Multer (file upload) errors, e.g. LIMIT_FILE_SIZE.
    if (exception instanceof Error && exception.name === 'MulterError') {
      const code = (exception as { code?: string }).code;
      const message =
        code === 'LIMIT_FILE_SIZE' ? 'The uploaded file is too large' : 'File upload failed';
      return { status: HttpStatus.BAD_REQUEST, error: 'Bad Request', message };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    };
  }
}
