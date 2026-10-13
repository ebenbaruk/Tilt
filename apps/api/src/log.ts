// Structured JSON logs (spec §11.1). Callers never pass tokens, codes or other secrets.

type Fields = Record<string, unknown>;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const log = {
  info(msg: string, fields: Fields = {}): void {
    console.info(JSON.stringify({ level: "info", time: new Date().toISOString(), msg, ...fields }));
  },
  warn(msg: string, fields: Fields = {}): void {
    console.warn(JSON.stringify({ level: "warn", time: new Date().toISOString(), msg, ...fields }));
  },
  error(msg: string, error: unknown, fields: Fields = {}): void {
    console.error(
      JSON.stringify({ level: "error", time: new Date().toISOString(), msg, error: errorMessage(error), ...fields }),
    );
  },
};
