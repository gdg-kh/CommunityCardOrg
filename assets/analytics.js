(function () {
  "use strict";

  var DEFAULT_GA_ID = "G-KCNJBYW13R";
  var DEFAULT_ALLOWED_HOSTS = ["community-card.org", "www.community-card.org"];
  var UTM_PARAMS = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
  ]);

  function kebabToSnake(str) {
    return String(str || "").replace(/-/g, "_");
  }

  function sanitizeLocation(href, keepParams) {
    try {
      var url = new URL(href);
      url.hash = "";
      url.pathname = url.pathname.replace(/\/index\.html$/i, "/");

      var keepSet = new Set(UTM_PARAMS);
      if (Array.isArray(keepParams)) {
        for (var i = 0; i < keepParams.length; i++) {
          var p = String(keepParams[i] || "").trim();
          if (p) keepSet.add(p);
        }
      } else if (keepParams && typeof keepParams.forEach === "function") {
        keepParams.forEach(function (p) {
          var s = String(p || "").trim();
          if (s) keepSet.add(s);
        });
      }

      var keys = Array.from(url.searchParams.keys());
      for (var j = 0; j < keys.length; j++) {
        if (!keepSet.has(keys[j])) {
          url.searchParams.delete(keys[j]);
        }
      }
      return url.toString();
    } catch (e) {
      return "";
    }
  }

  function isTrackingEnabled(loc, allowedHosts) {
    if (!loc) return false;
    var proto = loc.protocol;
    if (proto !== "https:" && proto !== "http:") return false;
    var hosts =
      allowedHosts instanceof Set
        ? allowedHosts
        : new Set(Array.isArray(allowedHosts) ? allowedHosts : DEFAULT_ALLOWED_HOSTS);
    return hosts.has(loc.hostname);
  }

  function detectEnvironment(win, nav) {
    var w = win || (typeof window !== "undefined" ? window : {});
    var n = nav || (typeof navigator !== "undefined" ? navigator : {});
    var ua = String(n.userAgent || "");

    var standalone = false;
    try {
      standalone = Boolean(
        (w.matchMedia &&
          (w.matchMedia("(display-mode: standalone)").matches ||
            w.matchMedia("(display-mode: minimal-ui)").matches ||
            w.matchMedia("(display-mode: fullscreen)").matches ||
            w.matchMedia("(display-mode: window-controls-overlay)").matches)) ||
          n.standalone === true,
      );
    } catch (e) {
      standalone = false;
    }

    var inAppBrowser = "none";
    if (/\bLine\//i.test(ua)) inAppBrowser = "LINE";
    else if (/FBAN|FBAV|FB_IAB/.test(ua)) inAppBrowser = "Facebook";
    else if (/Instagram/.test(ua)) inAppBrowser = "Instagram";
    else if (/Messenger/.test(ua)) inAppBrowser = "Messenger";

    var isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (n.platform === "MacIntel" && Number(n.maxTouchPoints || 0) > 1);
    var isAndroid = /Android/i.test(ua);
    var platformOS = isIOS ? "iOS" : isAndroid ? "Android" : "Desktop";

    return {
      display_mode: standalone ? "standalone" : "browser",
      in_app_browser: inAppBrowser,
      platform_os: platformOS,
    };
  }

  var scriptEl =
    typeof document !== "undefined"
      ? document.currentScript || document.querySelector('script[src*="analytics.js"]')
      : null;

  var dataset = (scriptEl && scriptEl.dataset) || {};
  var gaId = dataset.gaId || DEFAULT_GA_ID;
  var allowedHostsRaw = dataset.allowedHosts
    ? dataset.allowedHosts.split(",")
    : DEFAULT_ALLOWED_HOSTS;
  var allowedHosts = new Set(
    allowedHostsRaw
      .map(function (h) {
        return h.trim();
      })
      .filter(Boolean),
  );
  var siteYear = dataset.year || "";
  var pageType = dataset.pageType || "";
  var contentGroup =
    dataset.contentGroup ||
    (pageType === "organizer" || pageType === "verify" ? "tools" : pageType);
  var keepParams = (dataset.keepParams || "")
    .split(",")
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
  var autoPageView = dataset.autoPageView !== "false";

  var trackingActive =
    typeof window !== "undefined" &&
    typeof location !== "undefined" &&
    isTrackingEnabled(location, allowedHosts);

  function callGtag() {
    if (!trackingActive || typeof window === "undefined" || typeof window.gtag !== "function") {
      return;
    }
    window.gtag.apply(window, arguments);
  }

  function buildCleanParams(params) {
    var out = {};
    if (siteYear) out.site_year = siteYear;
    if (pageType) out.page_type = pageType;
    if (params && typeof params === "object") {
      var keys = Object.keys(params);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = params[k];
        if (v !== null && v !== undefined) {
          out[k] = v;
        }
      }
    }
    return out;
  }

  function trackEvent(name, params, options) {
    try {
      if (!trackingActive || !name) return;
      var payload = buildCleanParams(params);
      if (options && options.beacon) {
        payload.transport_type = "beacon";
      }
      callGtag("event", String(name), payload);
    } catch (e) {}
  }

  function trackPageView(overrides) {
    try {
      if (!trackingActive) return;
      var base = {
        page_location: sanitizeLocation(location.href, keepParams),
        page_title: typeof document !== "undefined" ? document.title : "",
        content_group: contentGroup,
      };
      var payload = buildCleanParams(base);
      if (overrides && typeof overrides === "object") {
        var keys = Object.keys(overrides);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var v = overrides[k];
          if (v !== null && v !== undefined) {
            payload[k] = v;
          }
        }
      }
      callGtag("event", "page_view", payload);
    } catch (e) {}
  }

  function trackError(errorSource, errorCode) {
    trackEvent("app_error", {
      error_source: String(errorSource || "unknown"),
      error_code: String(errorCode || "unknown"),
    });
  }

  if (typeof window !== "undefined") {
    window.trackEvent = trackEvent;
    window.trackPageView = trackPageView;
    window.trackError = trackError;
    window.ccardAnalytics = {
      sanitizeLocation: sanitizeLocation,
      isTrackingEnabled: isTrackingEnabled,
      detectEnvironment: detectEnvironment,
      kebabToSnake: kebabToSnake,
    };
  }

  if (trackingActive && typeof document !== "undefined") {
    try {
      window.dataLayer = window.dataLayer || [];
      if (typeof window.gtag !== "function") {
        window.gtag = function () {
          window.dataLayer.push(arguments);
        };
      }

      var tagScript = document.createElement("script");
      tagScript.async = true;
      tagScript.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(gaId);
      if (document.head) {
        document.head.appendChild(tagScript);
      }

      window.gtag("js", new Date());

      var env = detectEnvironment(window, navigator);
      window.gtag("set", "user_properties", env);

      var debugMode = false;
      try {
        debugMode = new URL(location.href).searchParams.get("ga_debug") === "1";
      } catch (e) {}

      var configParams = {
        page_location: sanitizeLocation(location.href, keepParams),
        content_group: contentGroup,
        site_year: siteYear,
        page_type: pageType,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        send_page_view: autoPageView,
      };
      if (debugMode) {
        configParams.debug_mode = true;
      }
      window.gtag("config", gaId, configParams);

      try {
        var redirectFrom = window.sessionStorage && window.sessionStorage.getItem("ccard_redirect_from");
        if (redirectFrom) {
          window.sessionStorage.removeItem("ccard_redirect_from");
          trackEvent("redirect_landed", { from_path: redirectFrom });
        }
      } catch (e) {}
    } catch (e) {}
  }

  if (typeof document !== "undefined") {
    document.addEventListener(
      "click",
      function (e) {
        try {
          var target = e.target;
          var el = target && target.closest ? target.closest("[data-ga-event]") : null;
          if (!el) return;
          var eventName = el.getAttribute("data-ga-event");
          if (!eventName) return;

          var params = {};
          var attrs = el.attributes;
          for (var i = 0; i < attrs.length; i++) {
            var attr = attrs[i];
            if (attr.name.indexOf("data-ga-") === 0 && attr.name !== "data-ga-event") {
              var key = kebabToSnake(attr.name.slice(8));
              if (key) params[key] = attr.value;
            }
          }

          var useBeacon = false;
          if (el.tagName === "A") {
            var href = el.getAttribute("href") || "";
            var targetAttr = el.getAttribute("target") || "";
            if (href && !/^javascript:/i.test(href) && targetAttr !== "_blank") {
              useBeacon = true;
            }
          }

          trackEvent(eventName, params, { beacon: useBeacon });
        } catch (err) {}
      },
      true,
    );
  }
})();
