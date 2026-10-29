import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { DeviceRequest, routeNotFound } from './device-key.guard';

/**
 * Every failure on a device route becomes one of the replies the shortcut
 * acts on, so no SMS is ever lost or retried forever:
 *
 *   no valid key (or pairing that failed) → the stock 404, as if the route did not exist
 *   rate limited                          → { status: 'slow_down' }  keep the file, stop sending for now
 *   bad payload                           → { status: 'invalid' }    move the file aside, notify
 *   anything else (DB down, a bug)        → { status: 'retry' } 503  keep the file, try again later
 *
 * Request bodies are never logged: they hold bank SMS.
 */
@Catch()
export class DeviceReplyFilter implements ExceptionFilter {
  private readonly logger = new Logger('DeviceMemos');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<DeviceRequest>();
    const res = http.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    if (status < 500 && !req.device) {
      res.status(404).json(routeNotFound(req).getResponse());
      return;
    }
    if (exception instanceof ThrottlerException) {
      res.status(429).json({ status: 'slow_down' });
      return;
    }
    if (status < 500) {
      const body = (exception as HttpException).getResponse();
      const message = typeof body === 'object' && body !== null && 'message' in body ? body.message : undefined;
      res.status(status).json({ status: 'invalid', message });
      return;
    }
    this.logger.error(
      `Device request failed: ${exception instanceof Error ? exception.name : 'unknown error'}`,
    );
    res.status(503).json({ status: 'retry' });
  }
}
