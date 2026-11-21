import crypto from 'crypto';

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

export function signState(payload: Record<string, unknown>) {
  const secret = process.env.APP_SECRET!;
  const data = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyState<T = Record<string, unknown>>(state: string): T | null {
  try {
    const [data, sig] = state.split('.');
    if (!data || !sig) return null;
    const secret = process.env.APP_SECRET!;
    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T & { exp?: number };
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
