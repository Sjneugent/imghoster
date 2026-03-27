import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId: number;
    username: string;
    isAdmin: boolean;
    csrfToken: string;
    captchaText: string | null;
    captchaExpiresAt: number | null;
  }
}

declare module 'express' {
  interface Request {
    apiTokenAuthenticated?: boolean;
    apiTokenId?: number;
    user?: {
      id: number;
      is_admin: boolean | number;
    };
  }
}
