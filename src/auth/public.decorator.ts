import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Marks a route (or controller) as reachable without a session. The global
// SessionGuard still parses the cookie and attaches req.authSession when valid,
// so public routes can introspect auth state — they just aren't required to.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
