// =============================================================
// FILE:    scripts/scrapers/scrapeWindyAPI.js
// PROJECT: Zengine.site — Live Stream Atlas
// VERSION: v1.0.0 · 2026-03-30
//
// Pulls webcams from Windy's public API.
// No API key required for basic listing endpoint.
// Returns streams in standard zengine stream format.
//
// WINDY API NOTES:
//   - /webcams/api/v3/webcams returns paginated results
//   - limit max = 100 per request
//   - orderby=popularity gives best-quality cams first
//   - category filter available: outdoor, indoor, traffic, etc.
//   - player embed URL: webcam.windy.com/webcam/[ID]/player
//
// USAGE: called from scrapeStreams.js main()
// =============================================================

'use strict';

var fetch = require('node-fetch');

var WINDY_BASE    = 'https://api.windy.com/webcams/api/v3/webcams';
var WINDY_FIELDS  = 'webcams:player,location,category,title,status';
var REQUEST_DELAY = 800; // ms between paginated requests

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

// READS: Windy category string  WRITES: zengine category string
function mapWindyCategory(cat) {
  if (!cat) { return 'city'; }
  var c = (cat.label || cat || '').toLowerCase();
  if (/traffic|road|highway|freeway/.test(c)) { return 'traffic'; }
  if (/nature|outdoor|mountain|forest|beach|ocean|lake|river|volcano|glacier/.test(c)) { return 'nature'; }
  if (/animal|wildlife|bird|zoo/.test(c)) { return 'wildlife'; }
  if (/weather|sky|storm/.test(c)) { return 'nature'; }
  return 'city';
}

// READS: Windy location object  WRITES: tag array
function buildTags(location, category) {
  var tags = ['windy'];
  if (location) {
    if (location.city)    { tags.push(location.city.toLowerCase()); }
    if (location.country) { tags.push(location.country.toLowerCase()); }
    if (location.region)  { tags.push(location.region.toLowerCase()); }
  }
  if (category) { tags.push(category); }
  // Deduplicate
  return tags.filter(function(t, i) { return t && tags.indexOf(t) === i; });
}

// READS: Windy API  WRITES: stream objects array
// Pulls up to maxCams cameras sorted by popularity
async function scrapeWindyAPI(maxCams) {
  maxCams = maxCams || 500;
  var results   = [];
  var pageSize  = 100;
  var pages     = Math.ceil(maxCams / pageSize);
  var offset    = 0;

  console.log('[WindyAPI] Pulling up to ' + maxCams + ' cams...');

  for (var p = 0; p < pages; p++) {
    try {
      var url = WINDY_BASE +
        '?limit=' + pageSize +
        '&offset=' + offset +
        '&orderby=popularity' +
        '&show=' + WINDY_FIELDS +
        '&status=active';

      var res  = await fetch(url, {
        headers: {
          'User-Agent': 'ZengineCamBot/1.1 (+https://zengine.site)',
          'Accept':     'application/json'
        }
      });

      if (!res.ok) {
        console.error('[WindyAPI] HTTP ' + res.status + ' on page ' + p);
        break;
      }

      var data = await res.json();

      if (!data.webcams || !data.webcams.length) {
        console.log('[WindyAPI] No more results at offset ' + offset);
        break;
      }

      data.webcams.forEach(function(cam) {
        // Skip if no embed player URL
        var embedUrl = cam.player && (
          cam.player.live  && cam.player.live.embed  ||
          cam.player.day   && cam.player.day.embed   ||
          cam.player.month && cam.player.month.embed
        );

        // Fallback: construct player URL from webcam ID
        if (!embedUrl && cam.webcamId) {
          embedUrl = 'https://webcam.windy.com/webcam/' + cam.webcamId + '/player';
        }

        if (!embedUrl) { return; }

        var loc      = cam.location || {};
        var catLabel = cam.category && cam.category[0];
        var category = mapWindyCategory(catLabel);
        var title    = cam.title || (loc.city + ', ' + loc.country) || 'Windy Cam';

        results.push({
          title:       title.substring(0, 80),
          category:    category,
          stream_type: 'embed',
          url:         embedUrl,
          tags:        buildTags(loc, category),
          source:      'windy'
        });
      });

      console.log('[WindyAPI] Page ' + (p+1) + ' — total so far: ' + results.length);
      offset += pageSize;

      if (results.length >= maxCams) { break; }
      await sleep(REQUEST_DELAY);

    } catch(e) {
      console.error('[WindyAPI] Error on page ' + p + ': ' + e.message);
      break;
    }
  }

  console.log('[WindyAPI] Final count: ' + results.length);
  return results;
}

module.exports = { scrapeWindyAPI: scrapeWindyAPI };
