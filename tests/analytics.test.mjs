import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

function createDomSandbox({
  href = "https://community-card.org/2027/index.html?fbclid=abc&utm_source=fb&openExternalBrowser=1#secret",
  dataset = { year: "2027", pageType: "calendar" },
  redirectFrom = null,
  userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Line/14.0",
  standalone = false,
} = {}) {
  const url = new URL(href);
  const appendedScripts = [];
  const clickListeners = [];
  const storageMap = new Map();
  if (redirectFrom) storageMap.set("ccard_redirect_from", redirectFrom);

  const windowObj = {
    dataLayer: undefined,
    gtag: undefined,
    location: {
      href: url.href,
      protocol: url.protocol,
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
    },
    matchMedia: (query) => ({
      matches: standalone && query === "(display-mode: standalone)",
    }),
    sessionStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: (k) => storageMap.delete(k),
    },
  };

  const documentObj = {
    title: "2027 高雄社群名牌卡 - 社群月曆",
    currentScript: { dataset },
    querySelector: () => ({ dataset }),
    head: {
      appendChild: (el) => appendedScripts.push(el),
    },
    createElement: (tag) => ({ tagName: tag.toUpperCase(), async: false, src: "" }),
    addEventListener: (type, fn, capture) => {
      if (type === "click") clickListeners.push({ fn, capture });
    },
  };

  const context = {
    window: windowObj,
    document: documentObj,
    location: windowObj.location,
    navigator: {
      userAgent,
      platform: "iPhone",
      maxTouchPoints: 0,
      standalone: false,
    },
    URL,
    Set,
    Array,
    Date,
    Object,
    String,
    Number,
    Boolean,
    encodeURIComponent,
  };
  vm.createContext(context);
  return { context, windowObj, appendedScripts, clickListeners, storageMap };
}

test("assets/analytics.js blocks non-allowlisted hosts (localhost / file / fork) and runs silently", async () => {
  const code = await readFile("assets/analytics.js", "utf8");

  for (const href of [
    "http://localhost:8080/2027/index.html",
    "http://127.0.0.1:3000/2026/calendar.html",
    "file:///Users/test/2026/index.html",
    "https://taipei-card.org/2027/index.html",
  ]) {
    const { context, windowObj, appendedScripts } = createDomSandbox({ href });
    vm.runInContext(code, context);
    assert.equal(appendedScripts.length, 0, `${href} should not load gtag.js`);
    assert.equal(windowObj.gtag, undefined);
    assert.doesNotThrow(() => {
      windowObj.trackEvent("test_ev", { a: 1 });
      windowObj.trackPageView({ page_title: "x" });
      windowObj.trackError("src", "code");
    });
  }
});

test("assets/analytics.js sanitizes location, enforces privacy config, handles redirect_landed and click delegation", async () => {
  const code = await readFile("assets/analytics.js", "utf8");
  const { context, windowObj, appendedScripts, clickListeners, storageMap } = createDomSandbox({
    href: "https://community-card.org/2027/index.html?fbclid=xyz&openExternalBrowser=1&utm_source=fb&c=gdg&ga_debug=1#token=123",
    dataset: {
      year: "2027",
      pageType: "passport",
      keepParams: "c",
      autoPageView: "false",
    },
    redirectFrom: "/2027/calendar.html",
  });

  vm.runInContext(code, context);

  assert.equal(appendedScripts.length, 1);
  assert.match(appendedScripts[0].src, /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-KCNJBYW13R$/);

  const calls = windowObj.dataLayer.map((args) => Array.from(args));
  const setUserProps = calls.find((c) => c[0] === "set" && c[1] === "user_properties");
  assert.deepEqual(JSON.parse(JSON.stringify(setUserProps[2])), {
    display_mode: "browser",
    in_app_browser: "LINE",
    platform_os: "iOS",
  });

  const configCall = calls.find((c) => c[0] === "config");
  assert.equal(configCall[1], "G-KCNJBYW13R");
  assert.equal(
    configCall[2].page_location,
    "https://community-card.org/2027/?utm_source=fb&c=gdg",
  );
  assert.equal(configCall[2].allow_google_signals, false);
  assert.equal(configCall[2].allow_ad_personalization_signals, false);
  assert.equal(configCall[2].send_page_view, false);
  assert.equal(configCall[2].debug_mode, true);
  assert.equal(configCall[2].content_group, "passport");
  assert.equal(configCall[2].site_year, "2027");

  // redirect_landed fired once and cleared
  assert.equal(storageMap.has("ccard_redirect_from"), false);
  const redirectEv = calls.find((c) => c[0] === "event" && c[1] === "redirect_landed");
  assert.ok(redirectEv);
  assert.equal(redirectEv[2].from_path, "/2027/calendar.html");

  // manual trackPageView
  windowObj.trackPageView({ page_title: "自訂標題", community_id: "gdg" });
  const pvCall = windowObj.dataLayer.map((a) => Array.from(a)).find((c) => c[0] === "event" && c[1] === "page_view");
  assert.equal(pvCall[2].page_title, "自訂標題");
  assert.equal(pvCall[2].community_id, "gdg");

  // click delegation with same-tab beacon
  assert.equal(clickListeners.length, 1);
  assert.equal(clickListeners[0].capture, true);
  const fakeAnchor = {
    tagName: "A",
    attributes: [
      { name: "data-ga-event", value: "passport_community_click" },
      { name: "data-ga-community-id", value: "gdg-kaohsiung" },
      { name: "data-ga-stamp-count", value: "3" },
    ],
    getAttribute(name) {
      if (name === "data-ga-event") return "passport_community_click";
      if (name === "href") return "?c=gdg-kaohsiung";
      if (name === "target") return "";
      return null;
    },
  };
  clickListeners[0].fn({
    target: {
      closest: (sel) => (sel === "[data-ga-event]" ? fakeAnchor : null),
    },
  });
  const clickEv = windowObj.dataLayer
    .map((a) => Array.from(a))
    .find((c) => c[0] === "event" && c[1] === "passport_community_click");
  assert.ok(clickEv);
  assert.equal(clickEv[2].community_id, "gdg-kaohsiung");
  assert.equal(clickEv[2].stamp_count, "3");
  assert.equal(clickEv[2].transport_type, "beacon");
});

test("all 14 business HTML pages load ../assets/analytics.js, have unique year-prefixed titles, and no inline gtag.js", async () => {
  const businessPages = [
    { file: "2025/index.html", year: "2025" },
    { file: "2025/makeCommunityCard.html", year: "2025" },
    { file: "2026/index.html", year: "2026" },
    { file: "2026/calendar.html", year: "2026" },
    { file: "2026/communities.html", year: "2026" },
    { file: "2026/rewards.html", year: "2026" },
    { file: "2026/sponsors.html", year: "2026" },
    { file: "2027/index.html", year: "2027" },
    { file: "2027/passport.html", year: "2027" },
    { file: "2027/checkin.html", year: "2027" },
    { file: "2027/communities.html", year: "2027" },
    { file: "2027/sponsors.html", year: "2027" },
    { file: "2027/organizer.html", year: "2027" },
    { file: "2027/verify.html", year: "2027" },
  ];

  const titles = new Set();
  for (const { file, year } of businessPages) {
    const html = await readFile(file, "utf8");
    assert.ok(html.includes('src="../assets/analytics.js"'), `${file} must load ../assets/analytics.js`);
    assert.equal(html.includes("googletagmanager.com/gtag/js"), false, `${file} must not inline gtag.js`);
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    assert.ok(m, `${file} must have <title>`);
    const title = m[1].trim();
    assert.ok(title.startsWith(year), `${file} title "${title}" should start with ${year}`);
    assert.equal(titles.has(title), false, `duplicate title found: ${title}`);
    titles.add(title);
  }
});

test("redirect pages preserve search/hash, record redirect source, and do not load gtag.js", async () => {
  for (const file of ["index.html", "2027/calendar.html"]) {
    const html = await readFile(file, "utf8");
    assert.equal(html.includes("googletagmanager.com/gtag/js"), false, `${file} must not load gtag.js`);
    assert.ok(html.includes("window.location.search + window.location.hash"), `${file} must preserve search & hash`);
    assert.ok(html.includes("ccard_redirect_from"), `${file} must record redirect source`);
  }
});

test("hash-sensitive pages clear location.hash before loading analytics.js", async () => {
  for (const file of ["2027/passport.html", "2027/checkin.html", "2027/verify.html"]) {
    const html = await readFile(file, "utf8");
    const clearIdx = html.indexOf("history.replaceState");
    const analyticsIdx = html.indexOf("assets/analytics.js");
    assert.ok(clearIdx !== -1 && analyticsIdx !== -1 && clearIdx < analyticsIdx, `${file} must clear hash before loading analytics.js`);
  }
});

test("calendar outbound links do not use noreferrer and tool buttons have type=button", async () => {
  for (const file of ["2026/calendar.html", "2027/index.html"]) {
    const html = await readFile(file, "utf8");
    assert.equal(html.includes('rel="noopener noreferrer"'), false, `${file} should use rel="noopener" without noreferrer`);
  }
  const org = await readFile("2027/organizer.html", "utf8");
  for (const id of ["unlock", "generate", "sign", "mk-sign"]) {
    assert.ok(new RegExp(`<button[^>]*type="button"[^>]*id="${id}"`).test(org), `organizer.html #${id} must have type="button"`);
  }
  const ver = await readFile("2027/verify.html", "utf8");
  assert.ok(/<button[^>]*type="button"[^>]*id="check"/.test(ver), 'verify.html #check must have type="button"');

  const passport = await readFile("2027/passport.html", "utf8");
  assert.equal(passport.match(/class="cardWrapper"/g)?.length, 1, "passport.html must have only 1 .cardWrapper");
});
