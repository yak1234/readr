// Errors that crossed Electron's IPC arrive wrapped as
// "Error invoking remote method 'name': Error: message"; people only need the message.

const IPC_WRAPPER = /^Error invoking remote method '[^']*': (Error: )?/;

export function cleanIpcError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(IPC_WRAPPER, "");
}
