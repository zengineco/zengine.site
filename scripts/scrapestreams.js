// =============================================================
// WORKFLOW STACK
// File:    scripts/scrapeStreams.js
// Project: zengine.site — Live Stream Atlas
// Author:  © 2026 Zengine™
// Version: v1.0.0
// Date:    2026-03-29
//
// BOOT ORDER:
//   1. Load source configs (SOURCES array)
//   2. Run each scraper in sequence
//   3. Validate all collected streams (HEAD/GET probe)
//   4. Deduplicate by URL
//   5. Merge with bootstrap fallback (data/streams-bootstrap.json)
//   6. Write output to data/streams.json
//
// SOURCES:
//   - Earthcam.com   : embed iframes (type: embed)
//   - Windy.com      : embed iframes (type: embed)
//   - Insecam.org    : MJPEG img src (type: mjpeg)
//   - Opentopia.com  : MJPEG img src (type: mjpeg)
//   - Camhacker.com  : MJPEG img src (type: mjpeg)
//
// OUTPUT: data/streams.json
//   [{ id, title, category, type, url, tags, source, addedAt }]
//
// DEPENDENCIES:
//   node-fetch@2   (CommonJS compatible)
//   cheerio        (HTML parsing)
//
// NOTES:
//   - All scraping is of publicly accessible pages
//   - MJPEG streams are public cameras with no auth
//   - Validation probes with 5s timeout, drops dead streams
//   - Rate limiting: 1.5s delay between requests per source
// =============================================================

'use strict';

var fs      = require('fs');
var path    = require('path');
var fetch   = require('node-fetch');
var cheerio = require('cheerio');

// ===== CONFIG BLOCK =====
var OUTPUT_PATH    = path.join(__dirname, '..', 'data', 'streams.json');
var BOOTSTRAP_PATH = path.join(__dirname, '..', 'data', 'streams-bootstrap.json');
var MAX_STREAMS    = 200;   // hard cap on output
var PROBE_TIMEOUT  = 5000;  // ms — stream validation timeout
var REQUEST_DELAY  = 1500;  // ms — delay between requests per source
var MIN_STREAMS    = 30;    // if scraper yields fewer, merge bootstrap

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ZengineCamBot/1.0; +https://zengine.site)',
  'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

// ===== UTILITY =====

// READS: ms  WRITES: Promise (resolves after delay)
function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// READS: url string  WRITES: string (sanitized)
function cleanUrl(url) {
  try {
    url = url.trim();
    if (url.startsWith('//')) { url = 'http:' + url; }
    return url;
  } catch(e) {
    return url;
  }
}

// READS: title string  WRITES: string (category)
function inferCategory(title) {
  var t = (title || '').toLowerCase();
  if (/beach|surf|ocean|coast|bay|sea/.test(t))    return 'nature';
  if (/mountain|forest|river|lake|park|wild/.test(t)) return 'nature';
  if (/traffic|highway|road|bridge|car|vehicle/.test(t)) return 'traffic';
  if (/airport|runway|plane|flight/.test(t))        return 'traffic';
  if (/train|subway|metro|rail/.test(t))            return 'traffic';
  if (/animal|bird|bear|wolf|deer|cam|zoo/.test(t)) return 'wildlife';
  if (/space|nasa|iss|rocket|moon/.test(t))         return 'space';
  if (/city|street|square|plaza|town|down/.test(t)) return 'city';
  return 'city';
}

// READS: url  WRITES: boolean (true if reachable)
async function probeStream(url, type) {
  try {
    var controller = new (require('abort-controller'))();
    var timer = setTimeout(function() { controller.abort(); }, PROBE_TIMEOUT);
    var method = (type === 'mjpeg') ? 'GET' : 'HEAD';
    var res = await fetch(url, {
      method:  method,
      headers: HEADERS,
      signal:  controller.signal
    });
    clearTimeout(timer);
    // MJPEG: accept 200. Embed pages: accept 200 or 301/302
    return (res.status >= 200 && res.status < 400);
  } catch(e) {
    return false;
  }
}

// READS: streams array  WRITES: deduped array (by url)
function deduplicate(streams) {
  var seen = {};
  return streams.filter(function(s) {
    var key = s.url;
    if (seen[key]) { return false; }
    seen[key] = true;
    return true;
  });
}

// ===== SCRAPERS =====

// READS: Earthcam category pages  WRITES: stream objects (type: embed)
// Earthcam uses <iframe> or data-src attributes in their cam listings
async function scrapeEarthcam() {
  var results = [];
  var pages = [
    { url: 'https://www.earthcam.com/usa/',      category: 'city',   tag: 'usa' },
    { url: 'https://www.earthcam.com/world/',     category: 'city',   tag: 'world' },
    { url: 'https://www.earthcam.com/nature/',    category: 'nature', tag: 'nature' },
    { url: 'https://www.earthcam.com/beaches/',   category: 'nature', tag: 'beach' }
  ];

  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    try {
      console.log('[Earthcam] Fetching ' + page.url);
      var res = await fetch(page.url, { headers: HEADERS });
      var html = await res.text();
      var $ = cheerio.load(html);

      // Earthcam listing: cam links are anchors with /cams/ path
      $('a[href*="/cams/"]').each(function() {
        var href  = $(this).attr('href') || '';
        var title = $(this).attr('title') || $(this).text().trim() || 'Earthcam Stream';
        if (!href || href.length < 5) { return; }
        var fullUrl = href.startsWith('http') ? href : 'https://www.earthcam.com' + href;
        // Build embed URL pattern for earthcam
        var embedUrl = fullUrl.replace('/cams/', '/embed/');
        results.push({
          id:       'ec-' + results.length,
          title:    title.substring(0, 80),
          category: page.category,
          type:     'embed',
          url:      embedUrl,
          tags:     [page.tag, 'earthcam'],
          source:   'earthcam',
          addedAt:  new Date().toISOString()
        });
      });

      await sleep(REQUEST_DELAY);
    } catch(e) {
      console.error('[Earthcam] Error on ' + page.url + ' — ' + e.message);
    }
  }

  console.log('[Earthcam] Collected ' + results.length + ' candidates');
  return results;
}

// READS: Windy webcam API  WRITES: stream objects (type: embed)
// Windy has a public webcam map API — no key required for basic listing
async function scrapeWindy() {
  var results = [];
  // Windy's public webcam API endpoint (no auth required for listing)
  var apiUrl = 'https://api.windy.com/webcams/api/v3/webcams?limit=50&orderby=popularity&show=webcams:player,location,category';

  try {
    console.log('[Windy] Fetching webcam list...');
    var res  = await fetch(apiUrl, { headers: HEADERS });
    var data = await res.json();

    if (data && data.webcams && data.webcams.length) {
      data.webcams.forEach(function(cam) {
        var embedUrl = cam.player && cam.player.day && cam.player.day.embed;
        if (!embedUrl) { return; }
        var loc = cam.location || {};
        var title = cam.title || (loc.city + ', ' + loc.country) || 'Windy Cam';
        var tags  = ['windy'];
        if (loc.country) { tags.push(loc.country.toLowerCase().substring(0,3)); }

        results.push({
          id:       'wy-' + results.length,
          title:    title.substring(0, 80),
          category: inferCategory(title),
          type:     'embed',
          url:      cleanUrl(embedUrl),
          tags:     tags,
          source:   'windy',
          addedAt:  new Date().toISOString()
        });
      });
    }
    console.log('[Windy] Collected ' + results.length + ' candidates');
  } catch(e) {
    console.error('[Windy] Error — ' + e.message);
  }

  return results;
}

// READS: Insecam category pages  WRITES: stream objects (type: mjpeg)
// Insecam lists publicly accessible IP cameras by country/category
async function scrapeInsecam() {
  var results = [];
  var pages = [
    { url: 'https://www.insecam.org/en/bytag/Nature/',    category: 'nature',   tag: 'nature' },
    { url: 'https://www.insecam.org/en/bytag/Street/',    category: 'city',     tag: 'street' },
    { url: 'https://www.insecam.org/en/bytag/Animals/',   category: 'wildlife', tag: 'animals' },
    { url: 'https://www.insecam.org/en/bytag/Traffic/',   category: 'traffic',  tag: 'traffic' },
    { url: 'https://www.insecam.org/en/bycountry/US/',    category: 'city',     tag: 'usa' },
    { url: 'https://www.insecam.org/en/bycountry/JP/',    category: 'city',     tag: 'japan' },
    { url: 'https://www.insecam.org/en/bycountry/FR/',    category: 'city',     tag: 'france' }
  ];

  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    try {
      console.log('[Insecam] Fetching ' + page.url);
      var res  = await fetch(page.url, { headers: HEADERS });
      var html = await res.text();
      var $    = cheerio.load(html);

      // Insecam listing: each cam is in a div with a camera image src
      // Pattern: <img src="http://[ip]:[port]/...">
      $('img[src^="http://"]').each(function() {
        var src   = $(this).attr('src') || '';
        var title = $(this).attr('alt') || $(this).closest('div').find('.camera-title').text().trim() || 'Public Cam';
        // Filter: must look like an IP cam URL (has port or /video/ or /mjpeg/)
        if (!/:\d{2,5}\/|\/video|\/mjpeg|\/stream|\.cgi/.test(src)) { return; }
        results.push({
          id:       'ic-' + results.length,
          title:    title.substring(0, 80) || ('Insecam ' + page.tag),
          category: page.category,
          type:     'mjpeg',
          url:      cleanUrl(src),
          tags:     [page.tag, 'insecam', 'ipcam'],
          source:   'insecam',
          addedAt:  new Date().toISOString()
        });
      });

      await sleep(REQUEST_DELAY);
    } catch(e) {
      console.error('[Insecam] Error on ' + page.url + ' — ' + e.message);
    }
  }

  console.log('[Insecam] Collected ' + results.length + ' candidates');
  return results;
}

// READS: Opentopia pages  WRITES: stream objects (type: mjpeg)
async function scrapeOpentopia() {
  var results = [];
  var pages = [
    { url: 'https://www.opentopia.com/hiddencam.php?camtype=outdoor', category: 'nature', tag: 'outdoor' },
    { url: 'https://www.opentopia.com/hiddencam.php?camtype=street',  category: 'city',   tag: 'street' }
  ];

  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    try {
      console.log('[Opentopia] Fetching ' + page.url);
      var res  = await fetch(page.url, { headers: HEADERS });
      var html = await res.text();
      var $    = cheerio.load(html);

      // Opentopia: cam pages linked from listing, cam image on detail page
      $('a[href*="/webcam/"]').each(function() {
        var href  = $(this).attr('href') || '';
        var title = $(this).text().trim() || 'Opentopia Cam';
        if (!href) { return; }
        var fullUrl = href.startsWith('http') ? href : 'https://www.opentopia.com' + href;
        // Store the page URL — validator will try to scrape the embed from detail
        results.push({
          id:       'ot-' + results.length,
          title:    title.substring(0, 80),
          category: page.category,
          type:     'embed',
          url:      cleanUrl(fullUrl),
          tags:     [page.tag, 'opentopia'],
          source:   'opentopia',
          addedAt:  new Date().toISOString()
        });
      });

      await sleep(REQUEST_DELAY);
    } catch(e) {
      console.error('[Opentopia] Error on ' + page.url + ' — ' + e.message);
    }
  }

  console.log('[Opentopia] Collected ' + results.length + ' candidates');
  return results;
}

// READS: Camhacker pages  WRITES: stream objects (type: mjpeg)
async function scrapeCamhacker() {
  var results = [];
  var pages = [
    { url: 'https://camhacker.com/?p=outdoor',  category: 'nature', tag: 'outdoor' },
    { url: 'https://camhacker.com/?p=traffic',  category: 'traffic', tag: 'traffic' },
    { url: 'https://camhacker.com/?p=city',     category: 'city',   tag: 'city' }
  ];

  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    try {
      console.log('[Camhacker] Fetching ' + page.url);
      var res  = await fetch(page.url, { headers: HEADERS });
      var html = await res.text();
      var $    = cheerio.load(html);

      // Camhacker: img tags with MJPEG-like src patterns
      $('img').each(function() {
        var src   = $(this).attr('src') || $(this).attr('data-src') || '';
        var title = $(this).attr('alt') || $(this).attr('title') || 'Camhacker Stream';
        if (!src || !/http/.test(src)) { return; }
        if (!/:\d{2,5}\/|\/video|\/mjpeg|\/stream|\.cgi|\/cgi-bin/.test(src)) { return; }
        results.push({
          id:       'ch-' + results.length,
          title:    title.substring(0, 80),
          category: page.category,
          type:     'mjpeg',
          url:      cleanUrl(src),
          tags:     [page.tag, 'camhacker', 'ipcam'],
          source:   'camhacker',
          addedAt:  new Date().toISOString()
        });
      });

      await sleep(REQUEST_DELAY);
    } catch(e) {
      console.error('[Camhacker] Error on ' + page.url + ' — ' + e.message);
    }
  }

  console.log('[Camhacker] Collected ' + results.length + ' candidates');
  return results;
}

// ===== VALIDATOR =====
// READS: streams array  WRITES: validated streams array (dead links removed)
async function validateStreams(streams) {
  var valid   = [];
  var dropped = 0;

  for (var i = 0; i < streams.length; i++) {
    var s = streams[i];
    // DECISION: skip validation for embed type — too slow to HEAD iframe pages.
    // Embed validity checked at render time by frontend onerror handler.
    if (s.type === 'embed') {
      valid.push(s);
      continue;
    }

    // MJPEG: probe the direct stream URL
    var alive = await probeStream(s.url, s.type);
    if (alive) {
      valid.push(s);
    } else {
      dropped++;
      console.log('[Validate] Dead: ' + s.url);
    }

    // Throttle to avoid hammering sources
    if (i % 10 === 0) { await sleep(500); }
  }

  console.log('[Validate] Kept ' + valid.length + ' / dropped ' + dropped);
  return valid;
}

// ===== MAIN =====
async function main() {
  try {
    console.log('=== ZengineCAM Scraper v1.0.0 ===');
    console.log('Start: ' + new Date().toISOString());

    // Ensure output directory exists
    var dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) { fs.mkdirSync(dataDir, { recursive: true }); }

    // Run all scrapers
    var allStreams = [];

    var earthcam  = await scrapeEarthcam();
    var windy     = await scrapeWindy();
    var insecam   = await scrapeInsecam();
    var opentopia = await scrapeOpentopia();
    var camhacker = await scrapeCamhacker();

    allStreams = allStreams
      .concat(earthcam)
      .concat(windy)
      .concat(insecam)
      .concat(opentopia)
      .concat(camhacker);

    console.log('Total candidates: ' + allStreams.length);

    // Deduplicate by URL
    allStreams = deduplicate(allStreams);
    console.log('After dedup: ' + allStreams.length);

    // Validate MJPEG streams (embed skipped)
    allStreams = await validateStreams(allStreams);

    // If we got enough, trim to MAX_STREAMS
    if (allStreams.length > MAX_STREAMS) {
      allStreams = allStreams.slice(0, MAX_STREAMS);
    }

    // If scraper yielded too few, merge with bootstrap
    if (allStreams.length < MIN_STREAMS) {
      console.log('[Main] Below MIN_STREAMS — merging bootstrap...');
      try {
        var bootstrap = JSON.parse(fs.readFileSync(BOOTSTRAP_PATH, 'utf8'));
        // Merge bootstrap entries not already in allStreams
        var existingUrls = {};
        allStreams.forEach(function(s) { existingUrls[s.url] = true; });
        bootstrap.forEach(function(s) {
          if (!existingUrls[s.url]) { allStreams.push(s); }
        });
        console.log('[Main] After bootstrap merge: ' + allStreams.length);
      } catch(e) {
        console.error('[Main] Bootstrap read failed — ' + e.message);
      }
    }

    // Assign clean sequential IDs
    allStreams = allStreams.map(function(s, i) {
      s.id = String(i + 1).padStart(3, '0');
      return s;
    });

    // Write output
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allStreams, null, 2));
    console.log('Output: ' + OUTPUT_PATH);
    console.log('Total streams written: ' + allStreams.length);
    console.log('Done: ' + new Date().toISOString());

  } catch(e) {
    console.error('[Main] Fatal: ' + e.message);
    process.exit(1);
  }
}

main();
