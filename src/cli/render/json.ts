/** One stable envelope shape for every command's --json output. */
export interface JsonEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: number; name: string; message: string };
}

export function printJsonOk(data: unknown): void {
  const envelope: JsonEnvelope<unknown> = { ok: true, data };
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
}

export function printJsonError(code: number, name: string, message: string): void {
  const envelope: JsonEnvelope<never> = { ok: false, error: { code, name, message } };
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
}
