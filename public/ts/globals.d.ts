/**
 * Ambient type declarations for the imghoster frontend.
 * This file is NOT a module – all declarations here are globally visible.
 */

/* ── Shared data shapes ────────────────────────────────────────────────────── */

interface User {
  id: number;
  username: string;
  isAdmin: boolean;
  csrfToken?: string;
  realName?: string;
}

interface ApiToken {
  id: number;
  label: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface Image {
  id: number;
  slug: string;
  original_name: string;
  username: string;
  size: number;
  view_count: number;
  created_at: string;
  comment?: string;
  tags?: string;
  visibility?: string;
  expires_at?: string;
}

interface AlbumImage {
  id: number;
  slug: string;
}

interface Album {
  id: number;
  name: string;
  description?: string;
  images?: AlbumImage[];
}

interface StatRow {
  slug: string;
  username?: string;
  view_count: number;
  last_viewed: string;
  created_at: string;
}

interface TimelineRow {
  day: string;
  views: number;
}

/* ── App module interface ───────────────────────────────────────────────────── */

interface AppModule {
  api<T = any>(path: string, options?: RequestInit): Promise<T>;
  showAlert(el: HTMLElement, message: string, type?: string): void;
  hideAlert(el: HTMLElement): void;
  copyText(text: string, btn: HTMLElement): Promise<void>;
  formatBytes(bytes: number): string;
  formatDate(str: string | null | undefined): string;
  requireAuth(adminOnly?: boolean): Promise<User | null>;
  logout(): Promise<void>;
  initNavbar(me: User): void;
  csrfHeader(): Record<string, string>;
  getApiToken(): string;
  setApiToken(token: string): void;
  apiAuthHeader(): Record<string, string>;
}
