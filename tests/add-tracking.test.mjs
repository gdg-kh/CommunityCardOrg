import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  TARGETS,
  UTM,
  addTrackingParams,
  createStats,
  processTrackingFiles,
  resolveCampaign,
  walk,
} from "../scripts/add-tracking.mjs";

test("TARGETS includes 2026 and 2027 events.json, data.json, and 2027/stamps.json", () => {
  assert.deepEqual(TARGETS, [
    "2026/events.json",
    "2026/data.json",
    "2027/events.json",
    "2027/data.json",
    "2027/stamps.json",
  ]);
});

test("resolveCampaign maps files and sections to specific utm_campaign values", () => {
  assert.equal(resolveCampaign("2026/events.json[0].link"), "calendar_2026");
  assert.equal(resolveCampaign("2027/events.json[0].events[0].link"), "calendar_2027");
  assert.equal(resolveCampaign("2026/data.json.communities[0].link"), "communities_2026");
  assert.equal(resolveCampaign("2026/data.json.sponsors[0].link"), "sponsors_2026");
  assert.equal(resolveCampaign("2026/data.json.rewards[0].link"), "rewards_2026");
  assert.equal(resolveCampaign("2027/data.json.communities[0].link"), "communities_2027");
  assert.equal(resolveCampaign("2027/data.json.sponsors[0].link"), "sponsors_2027");
  assert.equal(resolveCampaign("2027/data.json.rewards[0].link"), "rewards_2027");
  assert.equal(resolveCampaign("2027/stamps.json.partners[0].link"), "partners_2027");
  assert.equal(resolveCampaign("/tmp/ccard-tracking-xyz/2027/events.json[0].events[0].link"), "calendar_2027");
  assert.equal(resolveCampaign("C:\\repo\\2027\\data.json.communities[0].link"), "communities_2027");
  assert.equal(resolveCampaign("unknown.link"), UTM.utm_campaign);
});

test("walk transforms 2027 grouped events.json and preserves existing query/hash/utm_source", () => {
  const stats = createStats();
  const input = [
    {
      community: "GDG Kaohsiung",
      color: "#EA4335",
      events: [
        {
          date: "2027-01-15",
          title: "聚會 A",
          link: "https://gdg.community.dev/e/abc/?ref=home#register",
          mode: "hybrid",
        },
        {
          date: "2027-02-20",
          title: "已有 UTM",
          link: "https://example.com/event?utm_source=custom",
          mode: "online",
        },
        {
          date: "2027-03-01",
          title: "無連結",
          link: "#",
        },
        {
          date: "2027-03-05",
          title: "非 HTTP",
          link: "mailto:hello@example.com",
        },
      ],
    },
  ];

  const out = walk(input, "2027/events.json", stats);
  assert.equal(stats.errors.length, 0);
  assert.equal(stats.added, 1);
  assert.equal(stats.preservedExistingUtm, 1);
  assert.equal(stats.skippedPlaceholder, 1);
  assert.equal(stats.skippedNonHttp, 1);

  const u = new URL(out[0].events[0].link);
  assert.equal(u.origin, "https://gdg.community.dev");
  assert.equal(u.pathname, "/e/abc/");
  assert.equal(u.hash, "#register");
  assert.equal(u.searchParams.get("ref"), "home");
  assert.equal(u.searchParams.get("utm_source"), UTM.utm_source);
  assert.equal(u.searchParams.get("utm_medium"), UTM.utm_medium);
  assert.equal(u.searchParams.get("utm_campaign"), "calendar_2027");

  // Idempotent on second pass
  const stats2 = createStats();
  const out2 = walk(out, "2027/events.json", stats2);
  assert.equal(stats2.added, 0);
  assert.equal(stats2.preservedExistingUtm, 2);
  assert.equal(out2[0].events[0].link, out[0].events[0].link);
});

test("processTrackingFiles updates temp 2026 & 2027 JSON files cleanly", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ccard-tracking-"));
  try {
    await mkdir(path.join(tmpDir, "2027"), { recursive: true });
    const evPath = path.join(tmpDir, "2027", "events.json");
    const dataPath = path.join(tmpDir, "2027", "data.json");

    await writeFile(
      evPath,
      JSON.stringify([
        { community: "GDG Kaohsiung", color: "#EA4335", events: [{ date: "2027-01-10", title: "T", link: "https://example.com/a" }] },
      ]),
    );
    await writeFile(
      dataPath,
      JSON.stringify({
        communities: [{ name: "GDG Kaohsiung", link: "https://example.com/comm" }],
      }),
    );

    const stats = await processTrackingFiles([evPath, dataPath]);
    assert.equal(stats.errors.length, 0);
    assert.equal(stats.added, 2);

    const updatedEv = JSON.parse(await readFile(evPath, "utf8"));
    const updatedData = JSON.parse(await readFile(dataPath, "utf8"));
    assert.match(updatedEv[0].events[0].link, /utm_source=community-card\.org/);
    assert.match(updatedEv[0].events[0].link, /utm_campaign=calendar_2027/);
    assert.match(updatedData.communities[0].link, /utm_source=community-card\.org/);
    assert.match(updatedData.communities[0].link, /utm_campaign=communities_2027/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  // Test invalid URL error recording
  const errStats = createStats();
  addTrackingParams("not a url", "test.link", errStats);
  assert.equal(errStats.errors.length, 1);
});
