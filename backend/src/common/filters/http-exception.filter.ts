import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
  } from '@nestjs/common';
  import { Request, Response } from 'express';
  import { Logger } from 'nestjs-pino';
  
  @Catch()
  export class HttpExceptionFilter implements ExceptionFilter {
    constructor(private readonly logger: Logger) {}
  
    catch(exception: unknown, host: ArgumentsHost) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<Response>();
      const request = ctx.getRequest<Request>();
  
      const status =
        exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;
  
      const message =
        exception instanceof HttpException
          ? exception.getResponse()
          : 'Internal server error';
  
      this.logger.error(
        {
          status,
          path: request.url,
          method: request.method,
          exception,
        },
        'Unhandled exception',
      );
  
      response.status(status).json({
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        requestId: request.headers['x-request-id'] ?? null,
        message,
      });
    }
  }
  
