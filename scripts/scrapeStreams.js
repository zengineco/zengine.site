// =============================================================
// FILE:    scripts/scrapeStreams.js
// PROJECT: Zengine.site × Modulign Standard DAG-OR v3.0
// VERSION: v2.1.0
// DATE:    2026-03-30
// /* ===== LAST STABLE: v2.0.0 — 2026-03-30 ===== */
//
// SOURCES (in order of reliability):
//   1. YouTube      — 115 permanent channel + video IDs (always work)
//   2. Bootstrap    — 155 curated verified streams (guaranteed floor)
//   3. Windy API    — up to 500 live webcams
//   4. DOT feeds    — US state traffic + mountain cams
//   5. Earthcam     — scraped embed URLs
//   6. Insecam      — public MJPEG IP cameras
//   7. Opentopia    — public webcam directory
// =============================================================

'use strict';

var fs      = require('fs');
var path    = require('path');
var fetch   = require('node-fetch');
var cheerio = require('cheerio');

var codegen        = require('./mgnCodegen');
var windyAPI       = require('./scrapers/scrapeWindyAPI');
var dotScraper     = require('./scrapers/scrapeDOT');
var youtubeScraper = require('./scrapers/scrapeYouTube');

// ===== CONFIG BLOCK =====
var OUTPUT_PATH    = path.join(__dirname, '..', 'data', 'streams.json');
var BOOTSTRAP_PATH = path.join(__dirname, '..', 'data', 'streams-bootstrap.json');
var MAX_STREAMS    = 1000;   // hard cap — increase as quality improves
var PROBE_TIMEOUT  = 5000;
var REQUEST_DELAY  = 1200;
var MIN_STREAMS    = 100;    // always merge bootstrap if below this

var SUPABASE_URL  = process.env.SUPABASE_URL;
var SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

var HEADERS = {
  'User-Agent': 'ZengineCamBot/2.0 (+https://zengine.site)',
  'Accept':     'text/html,application/xhtml+xml,*/*'
};

// ===== UTILITIES =====
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function cleanUrl(url) {
  try {
    url = url.trim();
    if (url.startsWith('//')) { url = 'http:' + url; }
    return url;
  } catch(e) { return url; }
}

function inferCategory(title) {
  var t = (title || '').toLowerCase();
  if (/beach|surf|ocean|coast|sea|bay|waterfall|forest|river|lake|mountain|park|wild|aurora|storm|geyser|canyon|volcano|glacier|reef|coral/.test(t)) { return 'nature'; }
  if (/traffic|highway|road|bridge|freeway|motorway|interstate|tollway/.test(t)) { return 'traffic'; }
  if (/airport|runway|terminal|flight|plane|departure/.test(t)) { return 'traffic'; }
  if (/train|subway|metro|rail|tram|station/.test(t)) { return 'traffic'; }
  if (/animal|bird|bear|wolf|deer|zoo|aquarium|safari|penguin|whale|shark|wildlife/.test(t)) { return 'wildlife'; }
  if (/space|nasa|iss|rocket|moon|telescope|satellite|orbit/.test(t)) { return 'space'; }
  return 'city';
}

function deduplicate(streams) {
  var seen = {};
  return streams.filter(function(s) {
    var key = (s.url || '').toLowerCase().trim();
    if (!key || seen[key]) { return false; }
    seen[key] = true;
    return true;
  });
}

async function probeStream(url, type) {
  try {
    var AbortController = require('abort-controller');
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, PROBE_TIMEOUT);
    var res = await fetch(url, {
      method: (type === 'mjpeg') ? 'GET' : 'HEAD',
      headers: HEADERS,
      signal: controller.signal
    });
    clearTimeout(timer);
    return (res.status >= 200 && res.status < 400);
  } catch(e) { return false; }
}

// ===== SUPABASE =====
function supabaseHeaders() {
  return {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer':        'resolution=merge-duplicates,return=minimal'
  };
}

async function supabaseUpsert(table, rows, conflictCol) {
  if (!SUPABASE_URL || !SUPABASE_KEY) { return { ok: false }; }
  try {
    var res = await fetch(
      SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=' + conflictCol,
      { method: 'POST', headers: supabaseHeaders(), body: JSON.stringify(rows) }
    );
    return { ok: res.ok };
  } catch(e) {
    console.error('[Supabase] ' + table + ' error: ' + e.message);
    return { ok: false };
  }
}

// ===== SCRAPERS =====

async function scrapeEarthcam() {
  var results = [];
  var pages = [
    { url: 'https://www.earthcam.com/usa/',      category: 'city',   tag: 'usa' },
    { url: 'https://www.earthcam.com/world/',    category: 'city',   tag: 'world' },
    { url: 'https://www.earthcam.com/nature/',   category: 'nature', tag: 'nature' },
    { url: 'https://www.earthcam.com/beaches/',  category: 'nature', tag: 'beach' },
    { url: 'https://www.earthcam.com/traffic/',  category: 'traffic',tag: 'traffic' }
  ];
  for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    try {
      var res  = await fetch(p.url, { headers: HEADERS });
      var html = await res.text();
      var $    = cheerio.load(html);
      $('a[href*="/cams/"]').each(function() {
        var href  = $(this).attr('href') || '';
        var title = $(this).attr('title') || $(this).text().trim() || 'Earthcam';
        if (!href || href.length < 5) { return; }
        var full = href.startsWith('http') ? href : 'https://www.earthcam.com' + href;
        results.push({ title: title.substring(0,80), category: p.category,
          stream_type: 'embed', url: full.replace('/cams/','/embed/'),
          tags: [p.tag,'earthcam'], source: 'earthcam' });
      });
      await sleep(REQUEST_DELAY);
    } catch(e) { console.error('[Earthcam] ' + p.url + ': ' + e.message); }
  }
  console.log('[Earthcam] ' + results.length + ' candidates');
  return results;
}

async function scrapeInsecam() {
  var results = [];
  var pages = [
    { url: 'https://www.insecam.org/en/bytag/Nature/',   cat: 'nature',   tag: 'nature' },
    { url: 'https://www.insecam.org/en/bytag/Street/',   cat: 'city',     tag: 'street' },
    { url: 'https://www.insecam.org/en/bytag/Animals/',  cat: 'wildlife', tag: 'animals' },
    { url: 'https://www.insecam.org/en/bytag/Traffic/',  cat: 'traffic',  tag: 'traffic' },
    { url: 'https://www.insecam.org/en/bycountry/US/',   cat: 'city',     tag: 'usa' },
    { url: 'https://www.insecam.org/en/bycountry/JP/',   cat: 'city',     tag: 'japan' },
    { url: 'https://www.insecam.org/en/bycountry/DE/',   cat: 'city',     tag: 'germany' },
    { url: 'https://www.insecam.org/en/bycountry/FR/',   cat: 'city',     tag: 'france' },
    { url: 'https://www.insecam.org/en/bycountry/GB/',   cat: 'city',     tag: 'uk' },
    { url: 'https://www.insecam.org/en/bycountry/KR/',   cat: 'city',     tag: 'korea' },
    { url: 'https://www.insecam.org/en/bycountry/AU/',   cat: 'city',     tag: 'australia' },
    { url: 'https://www.insecam.org/en/bycountry/CA/',   cat: 'city',     tag: 'canada' }
  ];
  for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    try {
      var res  = await fetch(p.url, { headers: HEADERS });
      var html = await res.text();
      var $    = cheerio.load(html);
      $('img[src^="http://"]').each(function() {
        var src   = $(this).attr('src') || '';
        var title = $(this).attr('alt') || ('Insecam ' + p.tag);
        if (!/:\d{2,5}\/|\/video|\/mjpeg|\/stream|\.cgi/.test(src)) { return; }
        results.push({ title: title.substring(0,80), category: p.cat,
          stream_type: 'mjpeg', url: cleanUrl(src),
          tags: [p.tag,'insecam','ipcam'], source: 'insecam' });
      });
      await sleep(REQUEST_DELAY);
    } catch(e) { console.error('[Insecam] ' + p.tag + ': ' + e.message); }
  }
  console.log('[Insecam] ' + results.length + ' candidates');
  return results;
}

async function scrapeOpentopia() {
  var results = [];
  var pages = [
    'https://www.opentopia.com/hiddencam.php?camtype=outdoor',
    'https://www.opentopia.com/hiddencam.php?camtype=street',
    'https://www.opentopia.com/hiddencam.php?camtype=nature'
  ];
  for (var i = 0; i < pages.length; i++) {
    try {
      var res  = await fetch(pages[i], { headers: HEADERS });
      var html = await res.text();
      var $    = cheerio.load(html);
      $('a[href*="/webcam/"]').each(function() {
        var href  = $(this).attr('href') || '';
        var title = $(this).text().trim() || 'Opentopia Cam';
        if (!href) { return; }
        var full = href.startsWith('http') ? href : 'https://www.opentopia.com' + href;
        results.push({ title: title.substring(0,80), category: inferCategory(title),
          stream_type: 'embed', url: cleanUrl(full),
          tags: ['opentopia'], source: 'opentopia' });
      });
      await sleep(REQUEST_DELAY);
    } catch(e) { console.error('[Opentopia] ' + pages[i] + ': ' + e.message); }
  }
  console.log('[Opentopia] ' + results.length + ' candidates');
  return results;
}

// ===== VALIDATOR =====
async function validateMJPEG(streams) {
  var valid = 0, dropped = 0;
  var out = [];
  for (var i = 0; i < streams.length; i++) {
    var s = streams[i];
    if (s.stream_type !== 'mjpeg') { out.push(s); valid++; continue; }
    var alive = await probeStream(s.url, 'mjpeg');
    if (alive) { out.push(s); valid++; }
    else { dropped++; }
    if (i % 20 === 0 && i > 0) {
      console.log('[Validate] Progress: ' + i + '/' + streams.length + ' — alive: ' + valid + ' dead: ' + dropped);
      await sleep(200);
    }
  }
  console.log('[Validate] Final — alive: ' + valid + ' dead: ' + dropped);
  return out;
}

// ===== SUPABASE WRITER =====
async function writeToSupabase(streams) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('[Supabase] Env vars not set — JSON only');
    return;
  }
  var obsRows    = [];
  var streamRows = [];
  var BATCH      = 50;
  var crypto     = require('crypto');

  for (var i = 0; i < streams.length; i++) {
    var s   = streams[i];
    var mgn = s._mgn;
    if (!mgn) { continue; }
    var gsiId = crypto.randomUUID ? crypto.randomUUID() : require('uuid').v4();
    s._gsi_id = gsiId;

    obsRows.push({
      gsi_id:          gsiId,
      mgn_code:        mgn.mgn_code,
      mgn_domain:      mgn.mgn_segments.domain,
      mgn_subdomain:   mgn.mgn_segments.subdomain,
      mgn_realm:       mgn.mgn_segments.realm,
      mgn_g1:          mgn.mgn_segments.g1,
      mgn_g2:          mgn.mgn_segments.g2,
      mgn_g3:          mgn.mgn_segments.g3,
      mgn_g4:          mgn.mgn_segments.g4,
      mgn_node:        mgn.mgn_segments.node,
      mgn_scale:       mgn.mgn_segments.scale,
      mgn_medium:      mgn.mgn_segments.medium,
      mgn_observer:    '%ALG',
      mgn_continuum:   mgn.mgn_segments.continuum,
      mgn_meta_flags:  ['PROV'],
      confidence:      mgn.confidence,
      observer_type:   'ALG',
      reasoning:       mgn.reasoning,
      version:         '3.0',
      is_active:       true
    });

    streamRows.push({
      id:          s.id,
      title:       s.title,
      category:    s.category,
      stream_type: s.stream_type,
      url:         s.url,
      tags:        s.tags || [],
      source:      s.source,
      gsi_id:      gsiId,
      mgn_code:    mgn.mgn_code,
      is_active:   true,
      added_at:    s.addedAt || new Date().toISOString()
    });
  }

  for (var o = 0; o < obsRows.length; o += BATCH) {
    await supabaseUpsert('mgn_observation_registry', obsRows.slice(o, o+BATCH), 'gsi_id');
  }
  console.log('[Supabase] Obs registry: ' + obsRows.length);

  for (var r = 0; r < streamRows.length; r += BATCH) {
    await supabaseUpsert('streams', streamRows.slice(r, r+BATCH), 'url');
  }
  console.log('[Supabase] Streams: ' + streamRows.length);
}

// ===== MAIN =====
async function main() {
  try {
    console.log('=== ZengineCAM Scraper v2.0.0 ===');
    console.log('Target: up to ' + MAX_STREAMS + ' streams');
    console.log('Start: ' + new Date().toISOString());

    var dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) { fs.mkdirSync(dataDir, { recursive: true }); }

    var allStreams = [];

    // 1. YouTube — permanent channel IDs, always work, goes in first
    console.log('\n[Main] === YouTube ===');
    var youtubeCams = youtubeScraper.buildYouTubeStreams();
    allStreams = allStreams.concat(youtubeCams);
    console.log('[Main] YouTube: ' + youtubeCams.length + ' streams');

    // 2. Load bootstrap as guaranteed floor
    try {
      var bootstrap = JSON.parse(fs.readFileSync(BOOTSTRAP_PATH, 'utf8'));
      allStreams = allStreams.concat(bootstrap);
      console.log('[Main] Bootstrap loaded: ' + bootstrap.length + ' streams');
    } catch(e) { console.error('[Main] Bootstrap load failed: ' + e.message); }

    // 3. Windy API — up to 500 cams
    console.log('\n[Main] === Windy API ===');
    var windyCams = await windyAPI.scrapeWindyAPI(500);
    allStreams = allStreams.concat(windyCams);

    // 4. DOT feeds — all states
    console.log('\n[Main] === DOT Feeds ===');
    var dotCams = await dotScraper.scrapeDOT();
    allStreams = allStreams.concat(dotCams);

    // 5. Earthcam scrape
    console.log('\n[Main] === Earthcam ===');
    var earthcamCams = await scrapeEarthcam();
    allStreams = allStreams.concat(earthcamCams);

    // 6. Insecam (expanded country list)
    console.log('\n[Main] === Insecam ===');
    var insecamCams = await scrapeInsecam();
    allStreams = allStreams.concat(insecamCams);

    // 7. Opentopia
    console.log('\n[Main] === Opentopia ===');
    var otopiaCams = await scrapeOpentopia();
    allStreams = allStreams.concat(otopiaCams);

    console.log('\n[Main] Total before dedup: ' + allStreams.length);

    // Deduplicate
    allStreams = deduplicate(allStreams);
    console.log('[Main] After dedup: ' + allStreams.length);

    // Validate MJPEG streams
    console.log('\n[Main] === Validation ===');
    allStreams = await validateMJPEG(allStreams);
    console.log('[Main] After validation: ' + allStreams.length);

    // Cap at MAX_STREAMS
    if (allStreams.length > MAX_STREAMS) {
      // Keep bootstrap entries first (they're verified), then scraped
      allStreams = allStreams.slice(0, MAX_STREAMS);
    }

    // Assign IDs and MGN codes
    codegen.resetNodeCounters();
    allStreams = allStreams.map(function(s, i) {
      s.id      = String(i + 1).padStart(3, '0');
      s._mgn    = codegen.generateMGNCode(s);
      s.mgn_code = s._mgn.mgn_code;
      s.addedAt = s.addedAt || new Date().toISOString();
      return s;
    });

    console.log('[Main] MGN codes generated: ' + allStreams.length);

    // Write to Supabase
    await writeToSupabase(allStreams);

    // Write JSON fallback
    var output = allStreams.map(function(s) {
      return {
        id:          s.id,
        title:       s.title,
        category:    s.category,
        stream_type: s.stream_type,
        url:         s.url,
        tags:        s.tags || [],
        source:      s.source,
        mgn_code:    s.mgn_code,
        addedAt:     s.addedAt
      };
    });

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log('\n=== DONE ===');
    console.log('Streams written: ' + output.length);
    console.log('Output: ' + OUTPUT_PATH);
    console.log('End: ' + new Date().toISOString());

  } catch(e) {
    console.error('[Main] Fatal: ' + e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
