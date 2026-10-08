import { InjectionToken } from '@angular/core';
import { Role } from './models';

export const APPLY_ROUTES = new InjectionToken<(role: Role | null) => void>('APPLY_ROUTES');
