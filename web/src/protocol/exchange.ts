// Request/reply rules, measured on hardware (4x4MINIPRO V010 20230106A):
//  - queries echo their code (0x27 READ_CHANNEL answers 0x24); indexed queries echo the index;
//  - every write is acked with 0x01, an unknown opcode is answered 0x02, a bad checksum is ignored;
//  - one transaction at a time: a frame sent while the device is busy is silently dropped;
//  - round trip is typically ~9 ms (≤ 40 ms), but recall takes ~0.66 s and store ~2.2 s.
import { Command, ReplyCode } from "./commands.ts";
import { requestCode, requestData, type Reply } from "./frame.ts";

const QUERY_REPLY_CODE: Readonly<Record<number, number>> = {
  [Command.GET_STATUS]: Command.GET_STATUS,
  [Command.GET_VERSION]: Command.GET_VERSION,
  [Command.GET_VERSION_FW]: Command.GET_VERSION_FW,
  [Command.GET_ACTIVE_PRESET]: Command.GET_ACTIVE_PRESET,
  [Command.GET_FLAGS_BLOCK]: Command.GET_FLAGS_BLOCK,
  [Command.GET_CONFIG]: Command.GET_CONFIG,
  [Command.READ_PRESET_NAME]: Command.READ_PRESET_NAME,
  [Command.READ_CHANNEL]: Command.REPLY_CHANNEL,
  [Command.READBACK_LEVELS]: Command.READBACK_LEVELS,
};

const INDEXED_QUERIES: ReadonlySet<number> = new Set([Command.READ_CHANNEL, Command.READ_PRESET_NAME]);

const FAST_REPLY_TIMEOUT_MS = 150;
const SLOW_REPLY_TIMEOUT_MS: Readonly<Record<number, number>> = {
  [Command.RECALL_PRESET]: 1500,
  [Command.STORE_PRESET]: 4000,
};

/** The reply code the device answers a request code with. */
export function expectedReplyCode(code: number): number {
  return QUERY_REPLY_CODE[code] ?? ReplyCode.ACK;
}

/** How long to wait for the reply to one attempt of a request. */
export function replyTimeoutMs(code: number): number {
  return SLOW_REPLY_TIMEOUT_MS[code] ?? FAST_REPLY_TIMEOUT_MS;
}

/** Predicate recognising the reply to a specific request frame. */
export function replyMatcher(frame: Uint8Array): (reply: Reply) => boolean {
  const code = requestCode(frame);
  const expected = expectedReplyCode(code);
  if (!INDEXED_QUERIES.has(code)) return (reply) => reply.code === expected;
  const index = requestData(frame)[0];
  return (reply) => reply.code === expected && reply.data[0] === index;
}
