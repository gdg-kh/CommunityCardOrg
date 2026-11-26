import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function extractFunction(source, name) {
  const re = new RegExp(`(^[ \\t]*)function ${name}\\([\\s\\S]*?\\n\\1\\}`, "m");
  const m = source.match(re);
  assert.ok(m, `missing function ${name}`);
  return m[0];
}

for (const file of ["2026/calendar.html", "2027/index.html"]) {
  test(`${file} escapes HTML, validates URLs/colors, and sanitizes ICS output`, async () => {
    const html = await readFile(file, "utf8");
    const escapeHtmlSrc = extractFunction(html, "escapeHtml");
    const formatSafeDescriptionSrc = extractFunction(html, "formatSafeDescription");
    const safeHttpUrlSrc = extractFunction(html, "safeHttpUrl");
    const safeHexColorSrc = extractFunction(html, "safeHexColor");
    const escapeIcsTextSrc = extractFunction(html, "escapeIcsText");

    const fn = new Function(`
      ${escapeHtmlSrc}
      ${formatSafeDescriptionSrc}
      ${safeHttpUrlSrc}
      ${safeHexColorSrc}
      ${escapeIcsTextSrc}
      return { escapeHtml, formatSafeDescription, safeHttpUrl, safeHexColor, escapeIcsText };
    `);
    const helpers = fn();

    assert.equal(helpers.escapeHtml('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;");
    assert.equal(
      helpers.formatSafeDescription('<script>alert(1)</script><br><img src=x>'),
      "&lt;script&gt;alert(1)&lt;/script&gt;<br>&lt;img src=x&gt;",
    );
    assert.equal(helpers.safeHttpUrl("javascript:alert(1)"), "");
    assert.equal(helpers.safeHttpUrl("https://example.com/\r\nURL:https://evil"), "");
    assert.equal(helpers.safeHttpUrl("  https://www.facebook.com/share/p/1GYB2woQg3/"), "https://www.facebook.com/share/p/1GYB2woQg3/");
    assert.equal(helpers.safeHttpUrl("https://gdg.community.dev/e/123/"), "https://gdg.community.dev/e/123/");
    assert.equal(helpers.safeHexColor("red; background:url(x)"), "");
    assert.equal(helpers.safeHexColor("#EA4335"), "#EA4335");

    const icsSummary = helpers.escapeIcsText("Title\r\nATTACH:https://evil.example/a");
    assert.equal(icsSummary.includes("\r"), false);
    assert.equal(icsSummary.includes("\n"), false);

    const icsDesc = helpers.escapeIcsText("Line1;a,b\\c\r\nLine2", { allowNewlines: true });
    assert.equal(icsDesc.includes("\r"), false);
    assert.equal(icsDesc.includes("\n"), false);
    assert.equal(icsDesc, "Line1\\;a\\,b\\\\c\\nLine2");

    // Exercise actual downloadICS & getGoogleCalendarURL behavior with malicious event payload
    const getGoogleSrc = extractFunction(html, "getGoogleCalendarURL");
    const downloadIcsSrc = extractFunction(html, "downloadICS");
    const capturedBlobs = [];
    const createdAnchor = { href: "", download: "", click() {} };
    const icsRunner = new Function(
      "EVENT_MODES",
      "currentMonthEvents",
      "Blob",
      "URL",
      "document",
      `
      ${escapeHtmlSrc}
      ${formatSafeDescriptionSrc}
      ${safeHttpUrlSrc}
      ${safeHexColorSrc}
      ${escapeIcsTextSrc}
      ${getGoogleSrc}
      ${downloadIcsSrc}
      return { getGoogleCalendarURL, downloadICS };
      `,
    )(
      { onsite: "現場", online: "線上", hybrid: "混合" },
      [
        {
          date: "2027-01-15",
          community: "GDG\r\nKaohsiung",
          title: "Talk\r\nATTACH:https://evil.com/pwn",
          description: "Desc<br>Line2\r\nX-EVIL:1",
          link: "javascript:alert(1)",
          mode: "hybrid",
        },
      ],
      class FakeBlob {
        constructor(parts) {
          capturedBlobs.push(parts.join(""));
        }
      },
      {
        createObjectURL: () => "blob:mock",
        revokeObjectURL: () => {},
      },
      {
        createElement: () => createdAnchor,
        body: { appendChild() {}, removeChild() {} },
      },
    );

    const gUrl = icsRunner.getGoogleCalendarURL({
      date: "2027-01-15",
      community: "GDG Kaohsiung",
      title: "Talk",
      description: "A<br>B",
      link: "javascript:alert(1)",
      mode: "online",
    });
    assert.equal(gUrl.includes("javascript:"), false);

    icsRunner.downloadICS(0);
    assert.equal(capturedBlobs.length, 1);
    const icsText = capturedBlobs[0];
    assert.equal(icsText.includes("javascript:"), false);
    assert.equal(icsText.includes("\r\nATTACH:"), false);
    assert.equal(icsText.includes("\r\nX-EVIL:"), false);
    assert.equal(icsText.includes("URL:"), false);

    // Ensure renderCalendar / renderEventList do not inject raw event fields into HTML
    const renderCalendarSrc = extractFunction(html, "renderCalendar");
    const renderEventListSrc = extractFunction(html, "renderEventList");
    for (const [fnName, src] of [
      ["renderCalendar", renderCalendarSrc],
      ["renderEventList", renderEventListSrc],
    ]) {
      assert.equal(src.includes("${event.title}"), false, `${file} ${fnName} must not interpolate unescaped event.title`);
      assert.equal(src.includes("${event.community}"), false, `${file} ${fnName} must not interpolate unescaped event.community`);
      assert.equal(src.includes("${event.description}"), false, `${file} ${fnName} must not interpolate unescaped event.description`);
      assert.equal(src.includes("${event.link}"), false, `${file} ${fnName} must not interpolate unescaped event.link`);
      assert.equal(src.includes("${event.color}"), false, `${file} ${fnName} must not interpolate unescaped event.color`);
      assert.equal(src.includes("${holidayName}"), false, `${file} ${fnName} must not interpolate unescaped holidayName`);
    }
  });
}

test("2026/calendar.html and 2027/index.html do not highlight empty future cells as bg-upcoming when closestUpcomingDate is null", async () => {
  for (const file of ["2026/calendar.html", "2027/index.html"]) {
    const html = await readFile(file, "utf8");
    const getEventDateClassSrc = extractFunction(html, "getEventDateClass");

    const runWithClosest = (closest) =>
      new Function(
        "closestUpcomingDate",
        `${getEventDateClassSrc}
         return {
           firstFuture: getEventDateClass("2099-01-01"),
           secondFuture: getEventDateClass("2099-01-02"),
           closestAfter: closestUpcomingDate,
         };`,
      )(closest);

    const noUpcoming = runWithClosest(null);
    assert.equal(noUpcoming.firstFuture, "", `${file} should not highlight 2099-01-01 when no upcoming events`);
    assert.equal(noUpcoming.secondFuture, "", `${file} should not highlight 2099-01-02 when no upcoming events`);
    assert.equal(noUpcoming.closestAfter, null, `${file} must not mutate closestUpcomingDate`);

    const withUpcoming = runWithClosest("2099-01-02");
    assert.equal(withUpcoming.firstFuture, "");
    assert.equal(withUpcoming.secondFuture, " bg-upcoming");
  }
});

test("2027/organizer.html handles hybrid events with explicit makeup mode hint", async () => {
  const org = await readFile("2027/organizer.html", "utf8");
  assert.ok(org.includes('id="mk-hybrid-hint"'));
  assert.ok(org.includes('ev?.mode !== "hybrid"'));
});
