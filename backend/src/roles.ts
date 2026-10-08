export const ROLE_TL = 'ТЛ';
export const ROLE_QA = 'QA';

export type Role = typeof ROLE_TL | typeof ROLE_QA;

export function isRole(value: unknown): value is Role {
  return value === ROLE_TL || value === ROLE_QA;
}
