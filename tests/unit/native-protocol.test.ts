import { describe, expect, it } from "vitest";
import { encodeNativeMessage, NativeMessageDecoder } from "../../apps/native-host/src/native-protocol";

describe("Native Messaging 帧", () => {
  it("支持拆包与连续消息", () => {
    const first = encodeNativeMessage({ id: 1 });
    const second = encodeNativeMessage({ id: 2 });
    const decoder = new NativeMessageDecoder();
    expect(decoder.push(first.subarray(0, 3))).toEqual([]);
    expect(decoder.push(Buffer.concat([first.subarray(3), second]))).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
