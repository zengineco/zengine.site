// =============================================================
// FILE:    scripts/scrapeStreams.js
// PROJECT: Zengine.site × Modulign Standard DAG-OR v3.0
// AUTHOR:  © 2026 Zengine™
// VERSION: v1.1.0
// DATE:    2026-03-29
// /* ===== LAST STABLE: v1.0.0 — 2026-03-29 ===== */
//
// BOOT ORDER:
//   1. Load source configs
//   2. Run each scraper in sequence
//   3. Validate MJPEG streams
//   4. Deduplicate by URL
//   5. Generate MGN code for each stream (mgnCodegen.js)
//   6. Upsert to Supabase: mgn_observation_registry + streams
//   7. Write output to data/streams.json (frontend fallback)
//   8. Merge bootstrap if below MIN_STREAMS
//
// ENV VARS REQUIRED (set as GitHub repo secrets):
//   SUPABASE_URL              — your project URL
//   SUPABASE_SERVICE_ROLE_KEY — write access key (NEVER commit this)
//
// SUPABASE READS use service_role (write access, bypasses RLS)
// FRONTEND READS use anon key (SELECT only, enforced by RLS)
// =============================================================

'use strict';

var fs       = require('fs');
var path     = require('path');
var fetch    = require('node-fetch');
var cheerio  = require('cheerio');
var codegen  = require('./mgnCodegen');

// ===== CONFIG BLOCK =====
var OUTPUT_PATH    = path.join(__dirname, '..', 'data', 'streams.json');
var BOOTSTRAP_PATH = path.join(__dirname, '..', 'data', 'streams-bootstrap.json');
var MAX_STREAMS    = 200;
var PROBE_TIMEOUT  = 5000;
var REQUEST_DELAY  = 1500;
var MIN_STREAMS    = 30;

var SUPABASE_URL  = process.env.SUPABASE_URL;
var SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
// DECISION: service_role key used here for upsert writes.
// This key is stored ONLY as a GitHub repo secret — never in code or repo.
// Frontend uses anon key (read-only via RLS) stored in client JS.

var SCRAPER_AGENT = 'ZengineCamBot/1.1 (+https://zengine.site)';

var HEADERS = {
  'User-Agent': SCRAPER_AGENT,
  'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

// ===== SUPABASE CLIENT =====
// Minimal REST client — no SDK needed, keeps deps lean
// READS: url, key  WRITES: Supabase REST API

function supabaseHeaders() {
  return {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer':        'return=minimal'
  };
}

// READS: table, rows[]  WRITES: Supabase upsert
// Returns: { ok: boolean, error: string|null }
async function supabaseUpsert(table, rows, conflictColumn) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[Supabase] Missing env vars — skipping upsert to ' + table);
    return { ok: false, error: 'Missing env vars' };
  }
  try {
    var url = SUPABASE_URL + '/rest/v1/' + table +
              '?on_conflict=' + conflictColumn;
    var res = await fetch(url, {
      method:  'POST',
      headers: Object.assign({}, supabaseHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body:    JSON.stringify(rows)
    });
    if (!res.ok) {
      var errText = await res.text();
      console.error('[Supabase] Upsert error on ' + table + ': ' + errText);
      return { ok: false, error: errText };
    }
    return { ok: true, error: null };
  } catch(e) {
    console.error('[Supabase] Upsert exception on ' + table + ': ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ===== UTILITIES =====

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function cleanUrl(url) {
  try {
    url = url.trim();
    if (url.startsWith('//')) { url = 'http:' + url; }
    return url;
  } catch(e) { return url; }
}

function inferCategory(title) {
  var t = (title || '').toLowerCase();
  if (/beach|surf|ocean|coast|bay|sea|waterfall|forest|river|lake|mountain|park|wild|aurora|storm|geyser|canyon/.test(t)) return 'nature';
  if (/traffic|highway|road|bridge.*car|airport|runway|train|subway|metro|rail/.test(t)) return 'traffic';
  if (/animal|bird|bear|wolf|deer|zoo|aquarium|safari|penguin|whale|shark|reef|coral/.test(t)) return 'wildlife';
  if (/space|nasa|iss|rocket|moon|telescope|satellite/.test(t)) return 'space';
  return 'city';
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

function deduplicate(streams) {
  var seen = {};
  return streams.filter(function(s) {
    if (seen[s.url]) { return false; }
    seen[s.url] = true;
    return true;
  });
}

// ===== SCRAPERS (unchanged from v1.0.0) =====

async function scrapeEarthcam() {
  var results = [];
  var pages = [
    { url: 'https://www.earthcam.com/usa/',    category: 'city',   tag: 'usa' },
    { url: 'https://www.earthcam.com/world/',  category: 'city',   tag: 'world' },
    { url: 'https://www.earthcam.com/nature/', category: 'nature', tag: 'nature' },
    { url: 'https://www.earthcam.com/beaches/', category: 'nature', tag: 'beach' }
  ];
  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    try {
      console.log('[Earthcam] Fetching ' + page.url);
      var res  = await fetch(page.url, { headers: HEADERS });
      var html = await res.text();
      var $    = cheerio.load(html);
      $('a[href*="/cams/"]').each(function() {
        var href  = $(this).attr('href') || '';
        var title = $(this).attr('title') || $(this).text().trim() || 'Earthcam Stream';
        if (!href || href.length < 5) { return; }
        var fullUrl  = href.startsWith('http') ? href : 'https://www.earthcam.com' + href;
        var embedUrl = fullUrl.replace('/cams/', '/embed/');
        results.push({ title: title.substring(0,80), category: page.category,
          stream_type:'embed', url: embedUrl, tags:[page.tag,'earthcam'], source:'earthcam' });
      });
      await sleep(REQUEST_DELAY);
    } catch(e) { console.error('[Earthcam] Error: ' + e.message); }
  }
  console.log('[Earthcam] ' + results.length + ' candidates');
  return results;
}

async function scrapeWindy() {
  var results = [];
  try {
    console.log('[Windy] Fetching webcam list...');
    var res  = await fetch(
      'https://api.windy.com/webcams/api/v3/webcams?limit=50&orderby=popularity&show=webcams:player,location,category',
      { headers: HEADERS }
    );
    var data = await res.json();
    if (data && data.webcams) {
      data.webcams.forEach(function(cam) {
        var embedUrl = cam.player && cam.player.day && cam.player.day.embed;
        if (!embedUrl) { return; }
        var loc   = cam.location || {};
        var title = cam.title || (loc.city + ', ' + loc.country) || 'Windy Cam';
        var tags  = ['windy'];
        if (loc.country) { tags.push(loc.country.toLowerCase().substring(0,3)); }
        results.push({ title: title.substring(0,80), category: inferCategory(title),
          stream_type:'embed', url: cleanUrl(embedUrl), tags: tags, source:'windy' });
      });
    }
  } catch(e) { console.error('[Windy] Error: ' + e.message); }
  console.log('[Windy] ' + results.length + ' candidates');
  return results;
}

async function scrapeInsecam() {
  var results = [];
  var pages = [
    { url: 'https://www.insecam.org/en/bytag/Nature/',  category: 'nature',   tag: 'nature' },
    { url: 'https://www.insecam.org/en/bytag/Street/',  category: 'city',     tag: 'street' },
    { url: 'https://www.insecam.org/en/bytag/Animals/', category: 'wildlife', tag: 'animals' },
    { url: 'https://www.insecam.org/en/bytag/Traffic/', category: 'traffic',  tag: 'traffic' },
    { url: 'https://www.insecam.org/en/bycountry/US/',  category: 'city',     tag: 'usa' },
    { url: 'https://www.insecam.org/en/bycountry/JP/',  category: 'city',     tag: 'japan' },
    { url: 'https://www.insecam.org/en/bycountry/FR/',  category: 'city',     tag: 'france' }
  ];
  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    try {
      console.log('[Insecam] Fetching ' + page.url);
      var res  = await fetch(page.url, { headers: HEADERS });
      var html = await res.text();
      var $    = cheerio.load(html);
      $('img[src^="http://"]').each(function() {
        var src   = $(this).attr('src') || '';
        var title = $(this).attr('alt') || ('Insecam ' + page.tag);
        if (!/:\d{2,5}\/|\/video|\/mjpeg|\/stream|\.cgi/.test(src)) { return; }
        results.push({ title: title.substring(0,80), category: page.category,
          stream_type:'mjpeg', url: cleanUrl(src), tags:[page.tag,'insecam','ipcam'], source:'insecam' });
      });
      await sleep(REQUEST_DELAY);
    } catch(e) { console.error('[Insecam] Error: ' + e.message); }
  }
  console.log('[Insecam] ' + results.length + ' candidates');
  return results;
}

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
      $('a[href*="/webcam/"]').each(function() {
        var href  = $(this).attr('href') || '';
        var title = $(this).text().trim() || 'Opentopia Cam';
        if (!href) { return; }
        var fullUrl = href.startsWith('http') ? href : 'https://www.opentopia.com' + href;
        results.push({ title: title.substring(0,80), category: page.category,
          stream_type:'embed', url: cleanUrl(fullUrl), tags:[page.tag,'opentopia'], source:'opentopia' });
      });
      await sleep(REQUEST_DELAY);
    } catch(e) { console.error('[Opentopia] Error: ' + e.message); }
  }
  console.log('[Opentopia] ' + results.length + ' candidates');
  return results;
}

async function scrapeCamhacker() {
  var results = [];
  var pages = [
    { url: 'https://camhacker.com/?p=outdoor', category: 'nature', tag: 'outdoor' },
    { url: 'https://camhacker.com/?p=traffic', category: 'traffic', tag: 'traffic' },
    { url: 'https://camhacker.com/?p=city',    category: 'city',   tag: 'city' }
  ];
  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    try {
      console.log('[Camhacker] Fetching ' + page.url);
      var res  = await fetch(page.url, { headers: HEADERS });
      var html = await res.text();
      var $    = cheerio.load(html);
      $('img').each(function() {
        var src   = $(this).attr('src') || $(this).attr('data-src') || '';
        var title = $(this).attr('alt') || $(this).attr('title') || 'Camhacker Stream';
        if (!src || !/http/.test(src)) { return; }
        if (!/:\d{2,5}\/|\/video|\/mjpeg|\/stream|\.cgi|\/cgi-bin/.test(src)) { return; }
        results.push({ title: title.substring(0,80), category: page.category,
          stream_type:'mjpeg', url: cleanUrl(src), tags:[page.tag,'camhacker','ipcam'], source:'camhacker' });
      });
      await sleep(REQUEST_DELAY);
    } catch(e) { console.error('[Camhacker] Error: ' + e.message); }
  }
  console.log('[Camhacker] ' + results.length + ' candidates');
  return results;
}

// ===== VALIDATOR =====
async function validateStreams(streams) {
  var valid = [], dropped = 0;
  for (var i = 0; i < streams.length; i++) {
    var s = streams[i];
    if (s.stream_type === 'embed') { valid.push(s); continue; }
    var alive = await probeStream(s.url, s.stream_type);
    if (alive) { valid.push(s); } else { dropped++; }
    if (i % 10 === 0) { await sleep(500); }
  }
  console.log('[Validate] Kept ' + valid.length + ' / dropped ' + dropped);
  return valid;
}

// ===== SUPABASE WRITER =====
// READS: streams[]  WRITES: mgn_observation_registry + streams tables
async function writeToSupabase(streams) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('[Supabase] Env vars not set — skipping DB write (JSON fallback only)');
    return;
  }

  console.log('[Supabase] Writing ' + streams.length + ' streams...');
  var obsRows     = [];
  var streamRows  = [];
  var entityRows  = [];

  for (var i = 0; i < streams.length; i++) {
    var s   = streams[i];
    var mgn = s._mgn; // attached by main() after codegen
    if (!mgn) { continue; }

    var gsiId = require('crypto').randomUUID
      ? require('crypto').randomUUID()
      : require('uuid').v4();

    // DECISION: gsi_id generated here and stored on stream for FK reference.
    // This means each scrape run generates new GSI-IDs for new streams.
    // Existing streams are upserted by url (unique constraint).
    s._gsi_id = gsiId;

    // Observation Registry row
    obsRows.push({
      gsi_id:           gsiId,
      mgn_code:         mgn.mgn_code,
      mgn_domain:       mgn.mgn_segments.domain,
      mgn_subdomain:    mgn.mgn_segments.subdomain,
      mgn_realm:        mgn.mgn_segments.realm,
      mgn_g1:           mgn.mgn_segments.g1,
      mgn_g2:           mgn.mgn_segments.g2,
      mgn_g3:           mgn.mgn_segments.g3,
      mgn_g4:           mgn.mgn_segments.g4,
      mgn_node:         mgn.mgn_segments.node,
      mgn_scale:        mgn.mgn_segments.scale,
      mgn_medium:       mgn.mgn_segments.medium,
      mgn_observer:     '%' + mgn.mgn_segments.observer,
      mgn_continuum:    mgn.mgn_segments.continuum,
      mgn_meta_flags:   mgn.mgn_segments.meta_flags,
      confidence:       mgn.confidence,
      observer_type:    mgn.mgn_segments.observer,
      reasoning:        mgn.reasoning,
      version:          '3.0',
      is_active:        true
    });

    // Stream row
    streamRows.push({
      id:          s.id,
      title:       s.title,
      category:    s.category,
      stream_type: s.stream_type,
      url:         s.url,
      tags:        s.tags,
      source:      s.source,
      gsi_id:      gsiId,
      mgn_code:    mgn.mgn_code,
      is_active:   true,
      added_at:    s.addedAt || new Date().toISOString()
    });

    // Entity Registry row — one entity per stream source institution
    // e.g. Earthcam, Windy, NASA, explore.org as INST entities
    entityRows.push({
      entity_type:    'STRUC',    // physical camera/sensor structure
      entity_scope:   'LOC',
      display_name:   s.title,
      canonical_name: s.url,
      anchor_g1:      mgn.mgn_segments.g1,
      anchor_g2:      mgn.mgn_segments.g2,
      anchor_g3:      mgn.mgn_segments.g3,
      anchor_g4:      mgn.mgn_segments.g4,
      attributes:     { url: s.url, category: s.category, source: s.source, tags: s.tags },
      primary_gsi_id: gsiId,
      is_active:      true
    });
  }

  // Upsert in batches of 50
  var BATCH = 50;
  for (var start = 0; start < obsRows.length; start += BATCH) {
    var batch = obsRows.slice(start, start + BATCH);
    var result = await supabaseUpsert('mgn_observation_registry', batch, 'gsi_id');
    if (!result.ok) { console.error('[Supabase] obs batch ' + start + ' failed'); }
  }
  console.log('[Supabase] Observation registry: ' + obsRows.length + ' rows upserted');

  for (var start = 0; start < streamRows.length; start += BATCH) {
    var batch = streamRows.slice(start, start + BATCH);
    var result = await supabaseUpsert('streams', batch, 'url');
    if (!result.ok) { console.error('[Supabase] streams batch ' + start + ' failed'); }
  }
  console.log('[Supabase] Streams table: ' + streamRows.length + ' rows upserted');

  for (var start = 0; start < entityRows.length; start += BATCH) {
    var batch = entityRows.slice(start, start + BATCH);
    var result = await supabaseUpsert('mgn_entity_registry', batch, 'canonical_name');
    if (!result.ok) { console.error('[Supabase] entity batch ' + start + ' failed'); }
  }
  console.log('[Supabase] Entity registry: ' + entityRows.length + ' rows upserted');
}

// ===== MAIN =====
async function main() {
  try {
    console.log('=== ZengineCAM Scraper v1.1.0 ===');
    console.log('Start: ' + new Date().toISOString());

    var dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) { fs.mkdirSync(dataDir, { recursive: true }); }

    // Run all scrapers
    var allStreams = [];
    allStreams = allStreams
      .concat(await scrapeEarthcam())
      .concat(await scrapeWindy())
      .concat(await scrapeInsecam())
      .concat(await scrapeOpentopia())
      .concat(await scrapeCamhacker());

    console.log('Total candidates: ' + allStreams.length);

    allStreams = deduplicate(allStreams);
    console.log('After dedup: ' + allStreams.length);

    allStreams = await validateStreams(allStreams);

    if (allStreams.length > MAX_STREAMS) {
      allStreams = allStreams.slice(0, MAX_STREAMS);
    }

    // Bootstrap merge
    if (allStreams.length < MIN_STREAMS) {
      console.log('[Main] Below MIN_STREAMS — merging bootstrap...');
      try {
        var bootstrap    = JSON.parse(fs.readFileSync(BOOTSTRAP_PATH, 'utf8'));
        var existingUrls = {};
        allStreams.forEach(function(s) { existingUrls[s.url] = true; });
        bootstrap.forEach(function(s) {
          if (!existingUrls[s.url]) { allStreams.push(s); }
        });
        console.log('[Main] After bootstrap: ' + allStreams.length);
      } catch(e) { console.error('[Main] Bootstrap error: ' + e.message); }
    }

    // Assign clean IDs + generate MGN codes
    codegen.resetNodeCounters();
    allStreams = allStreams.map(function(s, i) {
      s.id      = String(i + 1).padStart(3, '0');
      s._mgn    = codegen.generateMGNCode(s);
      s.mgn_code = s._mgn.mgn_code;
      s.addedAt = s.addedAt || new Date().toISOString();
      return s;
    });

    console.log('[Main] MGN codes generated for ' + allStreams.length + ' streams');

    // Write to Supabase
    await writeToSupabase(allStreams);

    // Write JSON fallback (strips internal _mgn/_gsi_id fields)
    var outputStreams = allStreams.map(function(s) {
      return {
        id:          s.id,
        title:       s.title,
        category:    s.category,
        stream_type: s.stream_type,
        url:         s.url,
        tags:        s.tags,
        source:      s.source,
        mgn_code:    s.mgn_code,
        addedAt:     s.addedAt
      };
    });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(outputStreams, null, 2));
    console.log('JSON fallback: ' + OUTPUT_PATH);
    console.log('Total streams: ' + outputStreams.length);
    console.log('Done: ' + new Date().toISOString());

  } catch(e) {
    console.error('[Main] Fatal: ' + e.message);
    process.exit(1);
  }
}

main();
