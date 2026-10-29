import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import type { PairedDevice } from '../database/entities/paired-device.entity';
import { PairedDevicesService } from './paired-devices.service';
import { bearerToken, looksLikeDeviceKey } from './device-credentials';

export type DeviceRequest = Request & { device?: PairedDevice };

/**
 * The 404 Nest gives a route that does not exist. Device routes answer every
 * caller without a valid key with exactly this, so a scanner cannot tell them
 * apart from nothing at all.
 */
export function routeNotFound(req: Request): NotFoundException {
  return new NotFoundException({
    message: `Cannot ${req.method} ${req.originalUrl ?? req.url}`,
    error: 'Not Found',
    statusCode: 404,
  });
}

/**
 * Lets a request through only with the bearer key of a paired, unrevoked
 * device, and attaches that device. It does not look at AUTH_DISABLED: the
 * local-dev bypass is for the web session, never for the phone's routes.
 */
@Injectable()
export class DeviceKeyGuard implements CanActivate {
  constructor(private readonly devices: PairedDevicesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DeviceRequest>();
    const key = bearerToken(req.headers.authorization);
    const device = looksLikeDeviceKey(key) ? await this.devices.authenticate(key) : null;
    if (!device) throw routeNotFound(req);
    req.device = device;
    return true;
  }
}
