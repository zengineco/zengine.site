// =============================================================
// FILE:    js/streamFetch.js
// PROJECT: Zengine.site — Live Stream Atlas Frontend
// AUTHOR:  © 2026 Zengine™
// VERSION: v1.0.0
// DATE:    2026-03-29
//
// Fetches live streams from Supabase (primary) with JSON
// fallback (data/streams.json) if Supabase is unavailable.
//
// SUPABASE_ANON_KEY is safe to expose in client JS.
// It is READ-ONLY via RLS policy — no write access possible.
//
// USAGE:
//   <script src="js/streamFetch.js"></script>
//   ZengineCam.init({ onStreams: function(streams) { renderTV(streams); } });
// =============================================================

var ZengineCam = (function() {
  'use strict';

  // ===== CONFIG =====
  // DECISION: anon key is public-safe. RLS enforces SELECT-only.
  // Replace these with your actual project values.
  var SUPABASE_URL      = 'https://YOUR_PROJECT_REF.supabase.co';
  var SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';
  var JSON_FALLBACK     = '/data/streams.json';

  // ===== FETCH FROM SUPABASE =====
  // READS: mgn_observation_registry JOIN streams view
  // WRITES: nothing (anon key = read only)
  function fetchFromSupabase() {
    return fetch(
      SUPABASE_URL + '/rest/v1/streams_with_mgn?is_active=eq.true&order=id.asc',
      {
        headers: {
          'apikey':        SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
        }
      }
    )
    .then(function(res) {
      if (!res.ok) { throw new Error('Supabase returned ' + res.status); }
      return res.json();
    })
    .then(function(rows) {
      // Normalize to standard stream format
      return rows.map(function(row) {
        return {
          id:          row.id,
          title:       row.title,
          category:    row.category,
          stream_type: row.stream_type,
          url:         row.url,
          tags:        row.tags || [],
          source:      row.source,
          mgn_code:    row.mgn_code || '',
          gsi_id:      row.gsi_id  || '',
          // Parsed segments for display
          mgn_domain:    row.mgn_domain,
          mgn_subdomain: row.mgn_subdomain,
          mgn_g1:        row.mgn_g1,
          mgn_g2:        row.mgn_g2,
          mgn_g3:        row.mgn_g3,
          mgn_g4:        row.mgn_g4,
          mgn_scale:     row.mgn_scale,
          mgn_medium:    row.mgn_medium,
          confidence:    row.confidence
        };
      });
    });
  }

  // ===== FETCH FROM JSON FALLBACK =====
  // READS: /data/streams.json  WRITES: nothing
  function fetchFromJSON() {
    return fetch(JSON_FALLBACK)
      .then(function(res) {
        if (!res.ok) { throw new Error('JSON fallback ' + res.status); }
        return res.json();
      });
  }

  // ===== RENDER HELPERS =====

  // READS: stream object  WRITES: HTML string for a channel card
  function renderChannelCard(stream) {
    var mgnDisplay = stream.mgn_code
      ? '<div class="mgn-code" title="Modulign DAG-OR v3.0 address">' +
          '<span class="mgn-prefix">MGN·</span>' +
          stream.mgn_code.replace(/^MGN·/, '') +
        '</div>'
      : '';

    if (stream.stream_type === 'embed') {
      return (
        '<div class="channel-card" data-id="' + stream.id + '" data-category="' + stream.category + '">' +
        '<div class="channel-frame">' +
        '<iframe src="' + stream.url + '" ' +
          'allow="autoplay; fullscreen" allowfullscreen ' +
          'loading="lazy" ' +
          'onerror="this.parentElement.innerHTML=\'<div class=dead-stream>Signal Lost</div>\'">' +
        '</iframe>' +
        '</div>' +
        '<div class="channel-info">' +
        '<div class="channel-title">' + escapeHtml(stream.title) + '</div>' +
        '<div class="channel-meta">' +
          '<span class="channel-source">' + escapeHtml(stream.source) + '</span>' +
          '<span class="channel-id">#' + stream.id + '</span>' +
        '</div>' +
        mgnDisplay +
        '</div>' +
        '</div>'
      );
    }

    if (stream.stream_type === 'mjpeg') {
      // MJPEG streams render live in <img> tags natively
      return (
        '<div class="channel-card" data-id="' + stream.id + '" data-category="' + stream.category + '">' +
        '<div class="channel-frame mjpeg">' +
        '<img src="' + stream.url + '" alt="' + escapeHtml(stream.title) + '" ' +
          'loading="lazy" ' +
          'onerror="this.parentElement.innerHTML=\'<div class=dead-stream>Signal Lost</div>\'">' +
        '</div>' +
        '<div class="channel-info">' +
        '<div class="channel-title">' + escapeHtml(stream.title) + '</div>' +
        '<div class="channel-meta">' +
          '<span class="channel-source">' + escapeHtml(stream.source) + '</span>' +
          '<span class="channel-id">#' + stream.id + '</span>' +
        '</div>' +
        mgnDisplay +
        '</div>' +
        '</div>'
      );
    }

    return '';
  }

  // READS: string  WRITES: HTML-escaped string
  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ===== PUBLIC API =====

  // READS: config { onStreams, onError, container }
  // WRITES: calls onStreams(streams[]) or renders into container
  function init(config) {
    config = config || {};

    fetchFromSupabase()
      .catch(function(err) {
        console.warn('[ZengineCam] Supabase unavailable (' + err.message + ') — falling back to JSON');
        return fetchFromJSON();
      })
      .then(function(streams) {
        if (typeof config.onStreams === 'function') {
          config.onStreams(streams);
        }
        if (config.container) {
          var el = typeof config.container === 'string'
            ? document.querySelector(config.container)
            : config.container;
          if (el) {
            el.innerHTML = streams.map(renderChannelCard).join('');
          }
        }
      })
      .catch(function(err) {
        console.error('[ZengineCam] Both sources failed: ' + err.message);
        if (typeof config.onError === 'function') {
          config.onError(err);
        }
      });
  }

  // Filter streams by category
  // READS: streams[], category string  WRITES: filtered array
  function filterByCategory(streams, category) {
    if (!category || category === 'all') { return streams; }
    return streams.filter(function(s) { return s.category === category; });
  }

  // Group streams by MGN domain
  // READS: streams[]  WRITES: { URB: [], NAT: [], TRN: [], ... }
  function groupByDomain(streams) {
    return streams.reduce(function(acc, s) {
      var domain = s.mgn_domain || 'UNK';
      if (!acc[domain]) { acc[domain] = []; }
      acc[domain].push(s);
      return acc;
    }, {});
  }

  return {
    init:             init,
    fetchFromSupabase: fetchFromSupabase,
    fetchFromJSON:    fetchFromJSON,
    renderChannelCard: renderChannelCard,
    filterByCategory: filterByCategory,
    groupByDomain:    groupByDomain
  };

})();
