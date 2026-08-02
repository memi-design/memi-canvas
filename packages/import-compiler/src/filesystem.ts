export interface PositionalReader {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesRead: number }>;
}

export async function readBoundedBytes(
  reader: PositionalReader,
  maxFileBytes: number,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(maxFileBytes + 1);
  let total = 0;

  while (total < buffer.byteLength) {
    const { bytesRead } = await reader.read(
      buffer,
      total,
      buffer.byteLength - total,
      total,
    );
    if (bytesRead === 0) {
      break;
    }
    total += bytesRead;
    if (total > maxFileBytes) {
      throw new Error(`Import file byte budget exceeded.`);
    }
  }

  return buffer.subarray(0, total);
}
