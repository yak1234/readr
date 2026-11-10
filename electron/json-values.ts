// Reading values out of parsed JSON files, which may hold anything.

export const isObject = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x);

/** The value if it is a string, else "". */
export const str = (v: unknown): string => (typeof v === "string" ? v : "");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Whether `v` is an id the app made with crypto.randomUUID (a live session's or sentence's). */
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
