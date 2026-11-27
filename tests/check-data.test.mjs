import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateYearData } from "../scripts/check-data.mjs";

test("validateYearData passes on repository 2027 and 2026 (--events-structure)", async () => {
  const res2027 = await validateYearData("2027");
  assert.equal(res2027.errors.length, 0);

  const res2026 = await validateYearData("2026", { eventsStructureOnly: true });
  assert.equal(res2026.errors.length, 0);
});

test("validateYearData catches grouped duplicate groups, empty title, unsafe link, bad color, and null entries without throwing", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ccard-check-"));
  try {
    await writeFile(
      path.join(tmpDir, "data.json"),
      JSON.stringify({
        communities: [{ name: "GDG Kaohsiung", color: "#EA4335" }],
        rewards: [],
      }),
    );
    await writeFile(
      path.join(tmpDir, "stamps.json"),
      JSON.stringify({
        communities: [{ id: "gdg-kaohsiung", name: "GDG Kaohsiung", publicKeys: [] }],
        partners: [],
      }),
    );
    await writeFile(
      path.join(tmpDir, "events.json"),
      JSON.stringify([
        null,
        {
          community: "GDG Kaohsiung",
          color: "#EA4335",
          events: [
            null,
            { date: "2027-01-10", title: "   ", link: "javascript:alert(1)", color: "red" },
          ],
        },
        {
          community: "GDG Kaohsiung",
          color: "#EA4335",
          events: [],
        },
        {
          community: " GDG Kaohsiung ",
          color: "#EA4335",
          events: [],
        },
      ]),
    );

    const res = await validateYearData(tmpDir);
    const msgs = res.errors.map((e) => e.msg);
    assert.ok(msgs.some((m) => m.includes("活動項目必須是物件")), "null item caught");
    assert.ok(msgs.some((m) => m.includes("events[0] 活動項目必須是物件")), "null sub-event caught");
    assert.ok(msgs.some((m) => m.includes("缺少 title")), "empty sub-event title caught");
    assert.ok(msgs.some((m) => m.includes("link 必須是有效的")), "unsafe sub-event link caught");
    assert.ok(msgs.some((m) => m.includes("color 格式不正確")), "invalid sub-event color caught");
    assert.ok(msgs.some((m) => m.includes("重複的社群分組")), "duplicate community group caught");
    assert.ok(msgs.some((m) => m.includes("含有多餘前後空白")), "whitespace in group community caught");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("validateYearData handles null entries in flat events format with unknown communities without throwing", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ccard-check-flat-"));
  try {
    await writeFile(
      path.join(tmpDir, "data.json"),
      JSON.stringify({
        communities: [{ name: "GDG Kaohsiung", color: "#EA4335" }],
        rewards: [],
      }),
    );
    await writeFile(
      path.join(tmpDir, "stamps.json"),
      JSON.stringify({
        communities: [{ id: "gdg-kaohsiung", name: "GDG Kaohsiung", publicKeys: [] }],
        partners: [],
      }),
    );
    await writeFile(
      path.join(tmpDir, "events.json"),
      JSON.stringify([
        null,
        {
          date: "2026-05-01",
          community: "Unknown Org",
          title: "Test Event",
          link: "https://example.com",
          color: "#123456",
        },
      ]),
    );

    const res = await validateYearData(tmpDir);
    const msgs = res.errors.map((e) => e.msg);
    assert.ok(msgs.some((m) => m.includes("活動項目必須是物件")));
    assert.ok(msgs.some((m) => m.includes("不在 data.json communities 或 stamps.json partners 中")));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("validateYearData warns on tracking noise params and external utm_source without failing", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ccard-check-utm-"));
  try {
    await writeFile(
      path.join(tmpDir, "data.json"),
      JSON.stringify({
        communities: [{ name: "GDG Kaohsiung", color: "#EA4335" }],
        rewards: [],
      }),
    );
    await writeFile(
      path.join(tmpDir, "stamps.json"),
      JSON.stringify({
        communities: [{ id: "gdg-kaohsiung", name: "GDG Kaohsiung", publicKeys: [] }],
        partners: [],
      }),
    );
    await writeFile(
      path.join(tmpDir, "events.json"),
      JSON.stringify([
        {
          community: "GDG Kaohsiung",
          color: "#EA4335",
          events: [
            { date: "2027-01-10", title: "FB Link", link: "https://example.com/a?fbclid=123" },
            { date: "2027-01-11", title: "External UTM", link: "https://example.com/b?utm_source=other" },
          ],
        },
      ]),
    );

    const res = await validateYearData(tmpDir);
    assert.equal(res.errors.length, 0);
    const warnMsgs = res.warnings.map((w) => w.msg);
    assert.ok(warnMsgs.some((m) => m.includes("追蹤雜訊參數")));
    assert.ok(warnMsgs.some((m) => m.includes("外部 utm_source=other")));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
