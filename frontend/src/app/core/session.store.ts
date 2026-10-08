import { Injectable, signal } from '@angular/core';
import { Role } from './models';

const ID_KEY = 'qa.session';
const LOGIN_KEY = 'qa.login';
const CHECK_KEY = 'qa.check';

@Injectable({ providedIn: 'root' })
export class SessionStore {
  readonly role = signal<Role | null>(null);
  readonly sessionId = signal<string | null>(null);
  readonly login = signal<string | null>(null);
  readonly lastCheckId = signal<string | null>(null);

  constructor() {
    this.sessionId.set(readStorage(ID_KEY));
    this.login.set(readStorage(LOGIN_KEY));
    this.lastCheckId.set(readStorage(CHECK_KEY));
  }

  establish(sessionId: string, role: Role, login: string): void {
    this.sessionId.set(sessionId);
    this.role.set(role);
    this.login.set(login);
    writeStorage(ID_KEY, sessionId);
    writeStorage(LOGIN_KEY, login);
  }

  setRole(role: Role): void {
    this.role.set(role);
  }

  rememberCheck(checkId: string): void {
    this.lastCheckId.set(checkId);
    writeStorage(CHECK_KEY, checkId);
  }

  clear(): void {
    this.role.set(null);
    this.sessionId.set(null);
    this.login.set(null);
    this.lastCheckId.set(null);
    removeStorage(ID_KEY);
    removeStorage(LOGIN_KEY);
    removeStorage(CHECK_KEY);
  }
}

function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* Session still lives in memory for this tab. */
  }
}

function removeStorage(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
