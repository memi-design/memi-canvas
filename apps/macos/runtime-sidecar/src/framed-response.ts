export interface PendingResponseFrame {
  readonly bytes: Uint8Array;
  readonly offset: number;
}

export interface ResponseSocketPort {
  write(bytes: Uint8Array): number;
  end(): void;
}

export function createPendingResponseFrame(
  payload: string,
  maximumBytes: number,
): PendingResponseFrame {
  const bytes = new TextEncoder().encode(`${payload}\n`);
  if (bytes.byteLength > maximumBytes) {
    throw new Error("Runtime response exceeds its payload limit.");
  }
  return Object.freeze({ bytes, offset: 0 });
}

export function flushPendingResponseFrame(
  frame: PendingResponseFrame,
  socket: ResponseSocketPort,
): PendingResponseFrame | null {
  const remaining = frame.bytes.subarray(frame.offset);
  const written = socket.write(remaining);
  if (
    !Number.isSafeInteger(written) ||
    written < 0 ||
    written > remaining.byteLength
  ) {
    throw new Error("Runtime response transport reported an invalid write.");
  }
  if (written === 0) return frame;
  const offset = frame.offset + written;
  if (offset === frame.bytes.byteLength) {
    socket.end();
    return null;
  }
  return Object.freeze({ bytes: frame.bytes, offset });
}
