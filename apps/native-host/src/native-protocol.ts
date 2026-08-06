export {
  nativeRequestSchema as requestSchema,
  nativeResponseSchema as responseSchema
} from "@styleforge/contracts/native-messaging";
export type { NativeRequest, NativeResponse } from "@styleforge/contracts/native-messaging";

export function encodeNativeMessage(message: unknown) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export class NativeMessageDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > 1024 * 1024) throw new Error("Native Messaging 单条消息超过 1MB");
      if (this.buffer.length < length + 4) break;
      messages.push(JSON.parse(this.buffer.subarray(4, length + 4).toString("utf8")));
      this.buffer = this.buffer.subarray(length + 4);
    }
    return messages;
  }
}
