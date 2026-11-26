import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMUNITY_ALIASES as CORE_COMMUNITY_ALIASES,
  EVENT_MODES,
  MODES,
  communityIdOf,
  escapeHtml,
  isMakeup,
  normalizeEvents,
  parseToken,
  signPayload,
  stampKey,
  stripTags,
  verifyToken,
} from "../2027/passport/core-v2.js";
import { COMMUNITY_ALIASES as MCP_COMMUNITY_ALIASES } from "../mcp/lib.js";

test("normalizeEvents handles 2026 flat format, 2027 grouped format, and malformed entries", () => {
  assert.deepEqual(normalizeEvents(null), []);
  assert.deepEqual(normalizeEvents("bad"), []);

  const raw = [
    null,
    42,
    {
      date: "2026-12-20",
      community: "GDG Kaohsiung",
      title: "年底聚會",
      color: "#EA4335",
    },
    {
      community: "PyLadies Kaohsiung",
      color: "#FA3C0A",
      mode: "online",
      events: [
        null,
        { title: "missing date" },
        { date: "2027-01-10", title: "線上讀書會" },
        { date: "2027-02-15", title: "混合黑客松", mode: "hybrid", link: "https://example.com" },
        { date: "2027-03-01", title: "無效 mode 回退", mode: "telepathy" },
      ],
    },
  ];

  const out = normalizeEvents(raw);
  assert.equal(out.length, 4);

  assert.deepEqual(out[0], {
    date: "2026-12-20",
    community: "GDG Kaohsiung",
    title: "年底聚會",
    color: "#EA4335",
    link: "#",
    mode: "onsite",
  });

  assert.equal(out[1].community, "PyLadies Kaohsiung");
  assert.equal(out[1].mode, "online"); // 繼承外層 mode
  assert.equal(out[1].link, "#");

  assert.equal(out[2].mode, "hybrid");
  assert.equal(out[2].link, "https://example.com");

  assert.equal(out[3].mode, "onsite"); // 非法 mode 回退 onsite
});

test("communityIdOf resolves canonical and alias names", () => {
  const registry = {
    byName: new Map([
      ["GDG Kaohsiung", "gdg-kaohsiung"],
      ["UIUX Kaohsiung", "uiux-kaohsiung"],
    ]),
  };
  assert.equal(communityIdOf(registry, "GDG Kaohsiung"), "gdg-kaohsiung");
  assert.equal(communityIdOf(registry, "UIUX.Kaohsiung"), "uiux-kaohsiung");
  assert.equal(communityIdOf(registry, "Unknown"), null);
});

test("escapeHtml, stripTags, and EVENT_MODES / MODES behave as expected", () => {
  assert.equal(escapeHtml(`<a href="x">'&</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;");
  assert.equal(stripTags("第一行<br>第二行<br /><b>粗體</b>"), "第一行 第二行 粗體");
  assert.deepEqual(Object.keys(EVENT_MODES), ["onsite", "online", "hybrid"]);
  assert.deepEqual(Object.keys(MODES), ["onsite", "online"]);
});

test("signPayload and verifyToken validate ECDSA P-256 tokens and time windows", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const pubJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const community = {
    id: "gdg-kaohsiung",
    name: "GDG Kaohsiung",
    publicKeys: [{ kid: "2027a", jwk: { kty: pubJwk.kty, crv: pubJwk.crv, x: pubJwk.x, y: pubJwk.y } }],
  };
  const registry = {
    byId: new Map([[community.id, community]]),
  };

  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    c: "gdg-kaohsiung",
    k: "2027a",
    e: "2027-01-15",
    t: "新年小聚",
    d: "2027-01-15",
    m: "onsite",
    iat: nowSec,
    nbf: nowSec - 60,
    exp: nowSec + 300,
    r: 1,
    n: "abc123",
  };

  const token = await signPayload(pair.privateKey, payload);
  const parsed = parseToken(token);
  assert.equal(parsed.payload.c, "gdg-kaohsiung");
  assert.equal(isMakeup(parsed.payload), true);
  assert.equal(stampKey(parsed.payload), "gdg-kaohsiung|2027-01-15");

  const verified = await verifyToken(token, registry, { checkTime: true });
  assert.equal(verified.community.name, "GDG Kaohsiung");

  await assert.rejects(
    () => verifyToken(token, registry, { checkTime: true, now: (nowSec + 1000) * 1000 }),
    /過期/,
  );
});

test("COMMUNITY_ALIASES in core-v2.js and mcp/lib.js stay in sync", () => {
  assert.deepEqual(CORE_COMMUNITY_ALIASES, MCP_COMMUNITY_ALIASES);
});
