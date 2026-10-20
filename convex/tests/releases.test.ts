import { expect, test } from "bun:test";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { CHECKLIST } from "../releases";
import { asReceiver, expectCode, makeTest, setUp, type T } from "./harness.setup";

const hex = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

async function upload(t: T, versionCode: number, body = `apk ${versionCode}`) {
  const bytes = new TextEncoder().encode(body);
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes])));
  return {
    versionCode,
    versionName: `1.${versionCode}`,
    commit: "abc",
    sha256: await hex(bytes),
    size: bytes.length,
    storageId,
    notes: "",
    minSupported: null,
  };
}

const files = (t: T) =>
  t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);

test("candidates are checked against storage and replace each other", async () => {
  const t = makeTest();
  const op = await setUp(t);
  const bad = await upload(t, 101);
  expect(
    await t.mutation(internal.releases.recordCandidate, { ...bad, sha256: "00".repeat(32) }),
  ).toMatchObject({ ok: false });
  expect(await files(t)).toBe(0);

  await t.mutation(internal.releases.recordCandidate, await upload(t, 101));
  await t.mutation(internal.releases.recordCandidate, await upload(t, 102));
  const list = await op.query(api.releases.list, {});
  expect(list.candidate).toMatchObject({ versionCode: 102, status: "candidate" });
  expect(list.candidate?.url).toBeString();
  expect(await files(t)).toBe(1);
});

test("promote needs the checklist, tells every Receiver, and keeps two releases", async () => {
  const t = makeTest();
  const op = await setUp(t);
  const { receiverId, code } = await op.mutation(api.receivers.createPending, { name: "A" });
  await t.action(api.receiverAuth.pair, { code });
  const promote = async (versionCode: number) => {
    const r = await t.mutation(internal.releases.recordCandidate, await upload(t, versionCode));
    if (!r.ok) throw new Error(r.reason);
    await op.mutation(api.releases.promote, { releaseId: r.id, checklist: [...CHECKLIST] });
  };

  const recorded = await t.mutation(internal.releases.recordCandidate, await upload(t, 101));
  if (!recorded.ok) throw new Error(recorded.reason);
  const first = recorded.id;
  await expectCode(
    op.mutation(api.releases.promote, { releaseId: first, checklist: ["pair", "three-scans"] }),
    "CHECKLIST_INCOMPLETE",
  );
  await op.mutation(api.releases.promote, { releaseId: first, checklist: [...CHECKLIST] });
  expect((await asReceiver(t, receiverId).query(api.control.mine, {}))?.release).toMatchObject({
    versionCode: 101,
    versionName: "1.101",
  });
  expect(await asReceiver(t, receiverId).query(api.releases.downloadUrl, {})).toMatchObject({
    versionCode: 101,
  });

  await promote(102);
  await promote(103);
  const list = await op.query(api.releases.list, {});
  expect(list.promoted.map((r) => r.versionCode)).toEqual([103, 102]);
  expect(await files(t)).toBe(2);
  expect(
    await t.mutation(internal.releases.recordCandidate, await upload(t, 103, "again")),
  ).toMatchObject({ ok: false });

  // A Receiver paired now learns of the release at once.
  const late = await op.mutation(api.receivers.createPending, { name: "B" });
  await t.action(api.receiverAuth.pair, { code: late.code });
  expect(
    (await asReceiver(t, late.receiverId as Id<"receivers">).query(api.control.mine, {}))?.release
      ?.versionCode,
  ).toBe(103);
});
