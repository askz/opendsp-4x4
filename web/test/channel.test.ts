import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestChannel, ProtocolError } from "../src/transport/channel.ts";
import { Command, ReplyCode } from "../src/protocol/commands.ts";
import { getVersionFrame, getLevelsFrame, readChannelFrame, levelDbFrame, muteFrame, recallPresetFrame } from "../src/protocol/control.ts";
import { buildRequest } from "../src/protocol/frame.ts";
import { MockDsp } from "../src/transport/mock.ts";

async function openChannel(device = new MockDsp()): Promise<{ device: MockDsp; channel: RequestChannel }> {
  await device.open();
  return { device, channel: new RequestChannel(device) };
}

const isProtocolError = (kind: string) => (error: unknown) => error instanceof ProtocolError && error.kind === kind;

test("resolves with the reply whose code matches, ignoring stray reports", async () => {
  const { device, channel } = await openChannel();
  const pending = channel.request(getVersionFrame());
  device.emit(Command.READBACK_LEVELS, new Array(27).fill(0)); // a foreign/late meter reply arrives first
  const reply = await pending;
  assert.equal(reply.code, Command.GET_VERSION);
  assert.equal(new TextDecoder().decode(reply.data), "4x4MINIPRO V010");
  assert.equal(channel.stats.strayReports, 1);
});

test("an indexed query ignores a reply carrying a different index", async () => {
  const { device, channel } = await openChannel();
  const pending = channel.request(readChannelFrame(3));
  device.emit(Command.REPLY_CHANNEL, [2, ...new Array(50).fill(0)]);
  const reply = await pending;
  assert.equal(reply.data[0], 3);
  assert.equal(channel.stats.strayReports, 1);
});

test("reports with a bad checksum are ignored and counted", async () => {
  const { device, channel } = await openChannel();
  const pending = channel.request(getVersionFrame());
  const corrupt = new Uint8Array(64);
  corrupt.set([0x10, 0x02, 0x01, 0x00, 0x01, 0x13, 0x10, 0x03, 0x00]);
  device.emitRaw(corrupt);
  await pending;
  assert.equal(channel.stats.badReports, 1);
});

test("a dropped transaction is retried and then succeeds", async () => {
  const { device, channel } = await openChannel();
  device.dropNext = 1;
  const reply = await channel.request(getVersionFrame(), { timeoutMs: 30 });
  assert.equal(reply.code, Command.GET_VERSION);
  assert.equal(device.received.length, 2);
  assert.equal(channel.stats.retries, 1);
});

test("rejects with a timeout after the last attempt", async () => {
  const { device, channel } = await openChannel();
  device.unresponsive = true;
  await assert.rejects(channel.request(getVersionFrame(), { timeoutMs: 20, attempts: 2 }), isProtocolError("timeout"));
  assert.equal(device.received.length, 2);
  assert.equal(channel.stats.failures, 1);
});

test("a NAK rejects immediately without retrying", async () => {
  const { device, channel } = await openChannel();
  await assert.rejects(channel.request(buildRequest(0x7f)), isProtocolError("rejected"));
  assert.equal(device.received.length, 1);
});

test("never has two frames in flight (the device would drop the second)", async () => {
  const { device, channel } = await openChannel(new MockDsp({ latencyMs: { [Command.LEVEL]: 5 } }));
  await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((chan) => channel.request(levelDbFrame(chan, -3))));
  assert.equal(device.droppedWhileBusy, 0);
  assert.equal(device.received.length, 8);
});

test("control requests go before queued background requests", async () => {
  const { device, channel } = await openChannel();
  const background = [0, 1, 2].map(() => channel.request(getLevelsFrame(), { lane: "background" }));
  const control = channel.request(muteFrame(4, true));
  await Promise.all([...background, control]);
  // the first background poll was already in flight; the mute overtakes the other two
  assert.deepEqual(device.receivedCodes(), [Command.READBACK_LEVELS, Command.MUTE, Command.READBACK_LEVELS, Command.READBACK_LEVELS]);
});

test("queued writes sharing a coalesce key collapse into the latest frame", async () => {
  const { device, channel } = await openChannel();
  const values = [-10, -9, -8, -7, -6, -5];
  const results = await Promise.all(values.map((db) => channel.request(levelDbFrame(4, db), { coalesceKey: "level:4" })));
  assert.equal(results.length, values.length);
  assert.ok(results.every((reply) => reply.code === ReplyCode.ACK));
  // first frame was in flight immediately; the other five collapsed into the last value
  assert.equal(device.received.length, 2);
  assert.deepEqual(Array.from(device.received[1]!.slice(0, 9)), Array.from(levelDbFrame(4, -5).slice(0, 9)));
  assert.equal(channel.stats.coalesced, 4);
});

test("slow commands get a long reply window instead of being re-sent", async () => {
  const { device, channel } = await openChannel(new MockDsp({ latencyMs: { [Command.RECALL_PRESET]: 400 } }));
  const reply = await channel.request(recallPresetFrame(2));
  assert.equal(reply.code, ReplyCode.ACK);
  assert.equal(device.received.length, 1);
  assert.equal(device.activePreset, 2);
});

test("close rejects in-flight and queued requests, and later requests", async () => {
  const { device, channel } = await openChannel(new MockDsp({ latencyMs: { [Command.GET_VERSION]: 50 } }));
  const inFlight = channel.request(getVersionFrame());
  const queued = channel.request(getLevelsFrame(), { lane: "background" });
  channel.close("unplugged");
  await assert.rejects(inFlight, isProtocolError("closed"));
  await assert.rejects(queued, isProtocolError("closed"));
  await assert.rejects(channel.request(getVersionFrame()), isProtocolError("closed"));
  assert.equal(device.received.length, 1);
});

test("a failed OS write rejects with an io error", async () => {
  const device = new MockDsp();
  const channel = new RequestChannel(device); // never opened: write throws
  await assert.rejects(channel.request(getVersionFrame()), isProtocolError("io"));
});
