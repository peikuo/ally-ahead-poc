// Page memory only. Kept separate from contract modules so rebuilding a workspace
// contract does not recreate the auth event channel during Vite hot updates.
export const accessEvents = new EventTarget();
let csrf: string | null = null;
export const getCsrfToken = () => csrf;
export function setCsrfToken(value: string | null) { csrf = value; }
