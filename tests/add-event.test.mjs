import test from "node:test";
import assert from "node:assert/strict";
import {
  extractEventWithGemini,
  extractUrls,
  fetchWebpageContext,
  hasDisallowedHtmlTags,
  insertEventIntoData,
  isPrivateOrLocalHost,
  isSafeHttpUrl,
  parseIssueForm,
  truncateDescriptionWithLineBreaks,
  validateEventInput,
} from "../scripts/add-event.mjs";

const SAMPLE_COMMUNITIES = [
  { name: "GDG Kaohsiung", color: "#EA4335", description: "Google Developer Group" },
  { name: "PyLadies Kaohsiung", color: "#FA3C0A", description: "Python women community" },
];

test("isPrivateOrLocalHost blocks IPv4 private, reserved, multicast, broadcast and local hostnames", () => {
  for (const host of [
    "",
    "localhost",
    "localhost.",
    "sub.localhost",
    "printer.local",
    "metadata.google.internal",
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
  ]) {
    assert.equal(isPrivateOrLocalHost(host), true, `expected ${host} to be blocked`);
  }

  for (const host of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "kktix.cc"]) {
    assert.equal(isPrivateOrLocalHost(host), false, `expected ${host} to be allowed`);
  }
});

test("isPrivateOrLocalHost blocks IPv6 mapped hex, NAT64, multicast, ULA, and full fe80::/10", () => {
  // Simulate Node URL normalization of IPv4-mapped IPv6
  assert.equal(new URL("http://[::ffff:127.0.0.1]/").hostname, "[::ffff:7f00:1]");

  for (const host of [
    "::",
    "::1",
    "[::1]",
    "::ffff:127.0.0.1",
    "[::ffff:7f00:1]",
    "[::ffff:a00:1]", // 10.0.0.1
    "[::ffff:a9fe:a9fe]", // 169.254.169.254
    "[::ffff:e000:1]", // 224.0.0.1
    "[::ffff:ffff:ffff]", // 255.255.255.255
    "64:ff9b::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b::808:808",
    "64:ff9b:1::1",
    "fe80::1",
    "fe90::1",
    "fea0::1",
    "febf::1",
    "fe80::1%eth0",
    "fc00::1",
    "fd12:3456:789a::1",
    "ff00::1",
    "ff02::1",
  ]) {
    assert.equal(isPrivateOrLocalHost(host), true, `expected ${host} to be blocked`);
  }

  for (const host of ["2001:4860:4860::8888", "[::ffff:808:808]", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateOrLocalHost(host), false, `expected ${host} to be allowed`);
  }
});

test("fetchWebpageContext checks DNS resolution before fetch and cancels 3xx response bodies", async () => {
  let fetchCalled = false;
  const blockedResult = await fetchWebpageContext("https://evil.example.com/event", {
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("should not fetch");
    },
  });
  assert.equal(fetchCalled, false);
  assert.match(blockedResult, /略過不安全或私有網址/);

  // Redirect chain: public -> 302 -> private DNS -> cancels 302 body and stops
  let canceled = false;
  let hops = 0;
  const redirectBlocked = await fetchWebpageContext("https://public.example.com/start", {
    lookup: async (host) => {
      if (host === "public.example.com") return [{ address: "93.184.216.34", family: 4 }];
      return [{ address: "10.0.0.5", family: 4 }];
    },
    fetchImpl: async () => {
      hops++;
      return {
        status: 302,
        ok: false,
        headers: new Headers({ location: "https://internal.example.com/admin" }),
        body: {
          cancel: async () => {
            canceled = true;
          },
        },
      };
    },
  });
  assert.equal(hops, 1);
  assert.equal(canceled, true);
  assert.match(redirectBlocked, /略過不安全或私有網址/);

  // Normal public fetch with redirect
  let redirectCanceled = false;
  const okResult = await fetchWebpageContext("https://public.example.com/a", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (u) => {
      if (u.endsWith("/a")) {
        return {
          status: 301,
          ok: false,
          headers: new Headers({ location: "/b" }),
          body: {
            cancel: async () => {
              redirectCanceled = true;
            },
          },
        };
      }
      return new Response("<html><head><title>活動標題</title></head><body>Hello</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });
  assert.equal(redirectCanceled, true);
  assert.match(okResult, /網頁標題: 活動標題/);
});

test("extractUrls splits adjacent Chinese text, fullwidth punctuation, single quotes, and back-to-back URLs", () => {
  const urls = extractUrls(
    "活動報名（https://kktix.cc/events/abc?x=1），詳見https://a.example.com/x活動介紹https://b.example.com/y。單引號 'https://c.example.com/z' 維基 https://en.wikipedia.org/wiki/Foo_(bar) 讚！",
  );
  assert.deepEqual(urls, [
    "https://kktix.cc/events/abc?x=1",
    "https://a.example.com/x",
    "https://b.example.com/y",
    "https://c.example.com/z",
    "https://en.wikipedia.org/wiki/Foo_(bar)",
  ]);
});

test("fetchWebpageContext reports excessive redirects cleanly after 4 hops", async () => {
  let hops = 0;
  const res = await fetchWebpageContext("https://public.example.com/loop", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => {
      hops++;
      return {
        status: 302,
        ok: false,
        headers: new Headers({ location: `/loop?n=${hops}` }),
        body: { cancel: async () => {} },
      };
    },
  });
  assert.equal(hops, 4);
  assert.match(res, /重新導向次數過多/);
});

test("extractEventWithGemini falls back to extractUrls when AI link is non-URL placeholder", async () => {
  const parsedForm = parseIssueForm("活動詳見 https://kktix.cc/events/fallback");
  const extracted = await extractEventWithGemini({
    issueTitle: "test",
    parsedForm,
    webpageContexts: [],
    communities: SAMPLE_COMMUNITIES,
    apiKey: "fake-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      year: "2027",
                      community: "GDG Kaohsiung",
                      mode: "onsite",
                      date: "2027-06-01",
                      title: "Fallback Test",
                      description: "測試",
                      link: "無",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  assert.equal(extracted.link, "https://kktix.cc/events/fallback");
});

test("extractEventWithGemini handles thought parts, year auto-inference, link fallback, and timeout", async () => {
  const parsedForm = parseIssueForm(`### 活動網址或內容 (Content)

請參考 https://kktix.cc/events/devfest2027

### 目標年度 (Year)

自動判斷 (依活動日期)
`);
  assert.equal(parsedForm.year, "");

  const extracted = await extractEventWithGemini({
    issueTitle: "[新增活動] ",
    parsedForm,
    webpageContexts: [],
    communities: SAMPLE_COMMUNITIES,
    apiKey: "fake-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "thinking about 2026 vs 2027..." },
                  {
                    text: JSON.stringify({
                      year: "2026", // AI 誤判年份
                      community: "GDG Kaohsiung",
                      mode: "hybrid",
                      date: "2027-03-15",
                      title: "DevFest Preview",
                      description: "年度開發者聚會",
                      link: "#", // AI 回傳 #，應 fallback 到 extractUrls
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  assert.equal(extracted.year, "2027");
  assert.equal(extracted.link, "https://kktix.cc/events/devfest2027");
  assert.equal(extracted.mode, "hybrid");

  await assert.rejects(
    () =>
      extractEventWithGemini({
        issueTitle: "test",
        parsedForm,
        webpageContexts: [],
        communities: SAMPLE_COMMUNITIES,
        apiKey: "fake-key",
        timeoutMs: 20,
        fetchImpl: (_url, init) =>
          new Promise((_, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      }),
    /aborted/,
  );
});

test("validateEventInput rejects unclosed tags, attributed <br>, bad dates, and enforces 50-char limit", () => {
  assert.equal(hasDisallowedHtmlTags("<img src=x onerror=alert(1)", { allowBr: false }), true);
  assert.equal(hasDisallowedHtmlTags('<br onmouseover="alert(1)">', { allowBr: true }), true);
  assert.equal(hasDisallowedHtmlTags("<br/onload=alert(1)>", { allowBr: true }), true);
  assert.equal(hasDisallowedHtmlTags("<<br>img src=x>", { allowBr: true }), true);
  assert.equal(hasDisallowedHtmlTags("A<br>B<br />C", { allowBr: true }), false);

  assert.throws(
    () =>
      validateEventInput(
        {
          year: "2027",
          community: "GDG Kaohsiung",
          date: "2027-01-10",
          title: "Meetup <img src=x onerror=alert(1)",
        },
        SAMPLE_COMMUNITIES,
      ),
    /HTML 標籤/,
  );

  assert.throws(
    () =>
      validateEventInput(
        {
          year: "2027",
          community: "GDG Kaohsiung",
          date: "2027-01-10",
          title: "Meetup",
          description: 'hello<br onmouseover="alert(1)">world',
        },
        SAMPLE_COMMUNITIES,
      ),
    /HTML 標籤/,
  );

  assert.throws(
    () =>
      validateEventInput(
        {
          year: "2027",
          community: "GDG Kaohsiung",
          date: "2027-02-30",
          title: "Meetup",
        },
        SAMPLE_COMMUNITIES,
      ),
    /日期格式或曆日不正確/,
  );

  const ok = validateEventInput(
    {
      year: "2027",
      community: "GDG Kaohsiung",
      mode: "online",
      date: "2027-04-01",
      title: "  Spring Talk  ",
      description: `第一行\n${"字".repeat(50)}`,
      link: "https://gdg.community.dev/e/123/",
    },
    SAMPLE_COMMUNITIES,
  );
  assert.equal(ok.title, "Spring Talk");
  assert.equal(ok.description.startsWith("第一行<br>"), true);
  assert.equal(ok.description.endsWith("…"), true);
  assert.equal([...ok.description.replace(/<br>/g, "")].length, 50);

  assert.equal(truncateDescriptionWithLineBreaks("  甲\r\n乙<br />丙  ", 50), "甲<br>乙<br>丙");
  assert.equal(isSafeHttpUrl("javascript:alert(1)"), false);
});

test("insertEventIntoData supports 2027 grouped and 2026 flat formats and rejects duplicates", () => {
  const grouped = [];
  const ev = {
    year: "2027",
    community: "GDG Kaohsiung",
    color: "#EA4335",
    mode: "hybrid",
    date: "2027-05-20",
    title: "I/O Extended",
    description: "分享會",
    link: "https://example.com",
  };
  insertEventIntoData(grouped, ev);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].events.length, 1);

  assert.throws(() => insertEventIntoData(grouped, { ...ev, title: "  i/o extended " }), /請勿重複新增/);

  const flat = [];
  insertEventIntoData(flat, { ...ev, year: "2026", date: "2026-12-20" });
  assert.equal(flat.length, 1);
  assert.equal(Array.isArray(flat[0].events), false);
});
