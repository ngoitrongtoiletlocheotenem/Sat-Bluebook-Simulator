export type DesmosBridgeMessage =
  | { type: 'pathwise-desmos-bridge-ready' }
  | { type: 'pathwise-desmos-ready' }
  | { type: 'pathwise-desmos-error' };

export function desmosApiVersion(version?: string) {
  const value = version?.trim().replace(/^v/, '');
  return value && /^1\.\d+$/.test(value) ? value : '1.12';
}

/** The frame has an opaque sandbox origin; callers must verify event.source. */
export function isDesmosBridgeMessage(value: unknown): value is DesmosBridgeMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  return ['pathwise-desmos-bridge-ready', 'pathwise-desmos-ready', 'pathwise-desmos-error'].includes(
    String(value.type),
  );
}
