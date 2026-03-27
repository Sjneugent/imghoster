import type { Database } from 'better-sqlite3';

interface DbAdapter {
  getRawDB(): Database;
}

export function getDB(): DbAdapter;
export function exportData(): Promise<Record<string, unknown[]>>;
export function importData(data: Record<string, unknown[]>): Promise<void>;
export function initDB(config?: Record<string, unknown>): Promise<void>;
export function closeDB(): Promise<void>;
