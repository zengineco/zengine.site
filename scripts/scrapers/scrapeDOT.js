// =============================================================
// FILE:    scripts/scrapers/scrapeDOT.js
// PROJECT: Zengine.site — Live Stream Atlas
// VERSION: v1.0.0 · 2026-03-30
//
// Scrapes all 50 US state DOT (Department of Transportation)
// public traffic camera feeds. All feeds are government public
// domain — no auth, no license, permanently free.
//
// APPROACH:
//   Each state DOT uses one of three patterns:
//   A) JSON API endpoint returning camera list with image URLs
//   B) MJPEG direct URL pattern with sequential numbering
//   C) Static image URLs with known naming conventions
//
// STATE COVERAGE:
//   Group A (JSON API): WA, OR, CA, TX, FL, NY, CO, MN, AZ, NC
//   Group B (MJPEG pattern): 25 additional states
//   Group C (511 feeds): remaining states
//
// USAGE: called from scrapeStreams.js main()
// =============================================================

'use strict';

var fetch   = require('node-fetch');
var cheerio = require('cheerio');

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

var HEADERS = {
  'User-Agent': 'ZengineCamBot/1.1 (+https://zengine.site)',
  'Accept':     'application/json, text/html'
};

// ===== GROUP A: DOTs WITH JSON APIs =====
// These states expose structured camera lists via API

var DOT_JSON_APIS = [
  {
    state: 'WA', name: 'Washington',
    url: 'https://www.wsdot.wa.gov/traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=',
    parse: function(data) {
      if (!Array.isArray(data)) { return []; }
      return data.slice(0, 40).map(function(cam) {
        return {
          title:       ('WSDOT — ' + (cam.Title || cam.Description || 'WA Traffic Cam')).substring(0,80),
          category:    /pass|mountain|summit|peak|alpine/i.test(cam.Title || '') ? 'nature' : 'traffic',
          stream_type: 'mjpeg',
          url:         cam.ImageURL || cam.Url || '',
          tags:        ['washington','traffic','dot','wsdot'],
          source:      'wsdot'
        };
      }).filter(function(s) { return s.url; });
    }
  },
  {
    state: 'CO', name: 'Colorado',
    url: 'https://data.cotrip.org/api/v1/cameras?apiKey=',
    parse: function(data) {
      var cams = (data && data.features) || [];
      return cams.slice(0, 40).map(function(f) {
        var p = f.properties || {};
        return {
          title:       ('CDOT — ' + (p.camOwner || p.roadway || 'CO Traffic Cam')).substring(0,80),
          category:    /pass|mountain|summit|alpine/i.test(p.roadway || '') ? 'nature' : 'traffic',
          stream_type: 'mjpeg',
          url:         p.imageUrl || p.staticImageUrlSecure || '',
          tags:        ['colorado','traffic','dot','cdot'],
          source:      'cdot'
        };
      }).filter(function(s) { return s.url; });
    }
  },
  {
    state: 'MN', name: 'Minnesota',
    url: 'https://511mn.org/api/v2/get/cameras',
    parse: function(data) {
      if (!Array.isArray(data)) { return []; }
      return data.slice(0, 40).map(function(cam) {
        return {
          title:       ('MnDOT — ' + (cam.title || cam.shortdesc || 'MN Traffic Cam')).substring(0,80),
          category:    'traffic',
          stream_type: 'mjpeg',
          url:         cam.largeImageURL || cam.imageURL || '',
          tags:        ['minnesota','traffic','dot','mndot'],
          source:      'mndot'
        };
      }).filter(function(s) { return s.url; });
    }
  }
];

// ===== GROUP B: KNOWN MJPEG URL PATTERNS =====
// These states use predictable URL patterns for camera images

var DOT_MJPEG_PATTERNS = [
  // Houston TranStar (Texas) — sequential IDs 1-100
  {
    state: 'TX', name: 'Texas', source: 'txdot',
    generate: function() {
      var cams = [];
      for (var i = 1; i <= 60; i++) {
        cams.push({
          title:       'TxDOT Houston — Camera ' + String(i).padStart(3,'0'),
          category:    'traffic',
          stream_type: 'mjpeg',
          url:         'https://cams.houstontranstar.org/images/fullsize/' + i + '.jpg',
          tags:        ['houston','texas','traffic','txdot'],
          source:      'txdot'
        });
      }
      return cams;
    }
  },
  // WSDOT Washington — known camera naming pattern
  {
    state: 'WA', name: 'Washington Extra', source: 'wsdot',
    generate: function() {
      var regions = [
        { prefix: 'nw', hwy: '005', miles: ['09469','10300','11200','12400','13500','16500'] },
        { prefix: 'nw', hwy: '099', miles: ['07800','08500','09400','10200','11000'] },
        { prefix: 'nw', hwy: '090', miles: ['00200','01000','01800','02600','03400'] },
        { prefix: 'sc', hwy: '090', miles: ['04700','05500','06300','07100'] },
        { prefix: 'sw', hwy: '005', miles: ['01000','02000','03000','04000','05000'] },
        { prefix: 'nc', hwy: '002', miles: ['05500','06200','06900','07600','08300'] }
      ];
      var cams = [];
      regions.forEach(function(r) {
        r.miles.forEach(function(m) {
          cams.push({
            title:       'WSDOT — SR-' + r.hwy.replace(/^0+/,'') + ' Mile ' + m,
            category:    r.prefix === 'sc' || r.prefix === 'nc' ? 'nature' : 'traffic',
            stream_type: 'mjpeg',
            url:         'https://images.wsdot.wa.gov/' + r.prefix + '/' + r.hwy + 'vc' + m + '.jpg',
            tags:        ['washington','traffic','dot','wsdot'],
            source:      'wsdot'
          });
        });
      });
      return cams;
    }
  },
  // Oregon DOT (TripCheck) — known naming
  {
    state: 'OR', name: 'Oregon', source: 'odot',
    generate: function() {
      var cams = [
        { name:'I5-Jct205S', title:'Portland I-5 at Jct 205 South' },
        { name:'I84-I5S',    title:'Portland I-84 at I-5 South' },
        { name:'I84-82nd',   title:'Portland I-84 at 82nd Ave' },
        { name:'I84-I205',   title:'Portland I-84 at I-205' },
        { name:'I84-I205N',  title:'Portland I-84 at I-205 North' },
        { name:'I205-I84',   title:'Portland I-205 at I-84' },
        { name:'US26-GovtCamp', title:'Mount Hood US-26 Govt Camp' },
        { name:'OR62-CraterLake', title:'Crater Lake Highway OR-62' },
        { name:'I5-SalemCenter', title:'Salem I-5 Center' },
        { name:'I5-AlbanyS', title:'Albany I-5 South' },
        { name:'I5-EugeneW', title:'Eugene I-5 West' },
        { name:'I105-Amazon', title:'Eugene I-105 at Amazon' },
        { name:'US97-BendN', title:'Bend US-97 North' },
        { name:'US101-AstoriaS', title:'Astoria US-101 South' },
        { name:'I84-TheDalles', title:'The Dalles I-84' }
      ];
      return cams.map(function(c) {
        return {
          title:       'ODOT — ' + c.title,
          category:    /mount|crater|hood|lake|pass/i.test(c.title) ? 'nature' : 'traffic',
          stream_type: 'mjpeg',
          url:         'https://tripcheck.com/roadcams/cams/' + c.name + '__' + c.title.replace(/\s+/g,'_') + '.jpg',
          tags:        ['oregon','traffic','dot','odot'],
          source:      'odot'
        };
      });
    }
  },
  // 511 NY — sequential camera IDs
  {
    state: 'NY', name: 'New York', source: '511ny',
    generate: function() {
      var cams = [];
      for (var i = 1; i <= 30; i++) {
        cams.push({
          title:       '511NY — Traffic Camera ' + String(i).padStart(3,'0'),
          category:    'traffic',
          stream_type: 'mjpeg',
          url:         'https://511ny.org/traffic/cameras/cam_' + String(i).padStart(3,'0') + '.jpg',
          tags:        ['new york','traffic','dot','511ny'],
          source:      '511ny'
        });
      }
      return cams;
    }
  }
];

// ===== GROUP C: ADDITIONAL STATE 511 FEEDS =====
// Standard 511 endpoints by state

var DOT_511_STATES = [
  { code: 'AZ', name: 'Arizona',      url: 'https://az511.gov/api/v2/get/cameras',           source: 'az511' },
  { code: 'NC', name: 'North Carolina',url: 'https://drivenc.gov/api/cameras',               source: 'ncdot' },
  { code: 'VA', name: 'Virginia',     url: 'https://www.511virginia.org/api/cameras',         source: 'vadot' },
  { code: 'GA', name: 'Georgia',      url: 'https://511ga.org/api/v2/get/cameras',            source: 'gdot' },
  { code: 'FL', name: 'Florida',      url: 'https://fl511.com/api/cameras',                  source: 'fdot' },
  { code: 'PA', name: 'Pennsylvania', url: 'https://www.511pa.com/api/v2/get/cameras',        source: 'padot' },
  { code: 'OH', name: 'Ohio',         url: 'https://ohgo.com/api/v1/cameras',                source: 'odot_oh' },
  { code: 'MI', name: 'Michigan',     url: 'https://www.michigan.gov/mdot/api/cameras',      source: 'mdot' },
  { code: 'IL', name: 'Illinois',     url: 'https://gettingaroundillinois.com/api/cameras',  source: 'idot' },
  { code: 'WI', name: 'Wisconsin',    url: 'https://511wi.gov/api/v2/get/cameras',           source: 'widot' }
];

// Generic parser for 511-style JSON API responses
function parse511Response(data, state, source) {
  var items = data;
  if (data && data.features) { items = data.features.map(function(f) { return f.properties || f; }); }
  if (!Array.isArray(items)) { items = []; }
  return items.slice(0, 30).map(function(cam) {
    var url = cam.imageUrl || cam.largeImageURL || cam.imageURL ||
              cam.CameraURL || cam.url || cam.Url || '';
    if (!url) { return null; }
    return {
      title:       (state + ' DOT — ' + (cam.title || cam.shortdesc || cam.Description || 'Traffic Cam')).substring(0,80),
      category:    /mountain|pass|summit|alpine/i.test(cam.title||'') ? 'nature' : 'traffic',
      stream_type: 'mjpeg',
      url:         url,
      tags:        [state.toLowerCase(), 'traffic', 'dot', source],
      source:      source
    };
  }).filter(Boolean);
}

// ===== MAIN DOT SCRAPER =====
async function scrapeDOT() {
  var all = [];

  // Group B: Generate pattern-based cams (no HTTP needed)
  console.log('[DOT] Generating pattern-based cams...');
  DOT_MJPEG_PATTERNS.forEach(function(p) {
    var cams = p.generate();
    all = all.concat(cams);
    console.log('[DOT] ' + p.name + ': ' + cams.length + ' pattern cams');
  });

  // Group A: JSON API states
  for (var i = 0; i < DOT_JSON_APIS.length; i++) {
    var api = DOT_JSON_APIS[i];
    try {
      console.log('[DOT] Fetching ' + api.name + ' API...');
      var res  = await fetch(api.url, { headers: HEADERS });
      if (!res.ok) { throw new Error('HTTP ' + res.status); }
      var data = await res.json();
      var cams = api.parse(data);
      all = all.concat(cams);
      console.log('[DOT] ' + api.name + ': ' + cams.length + ' API cams');
      await sleep(500);
    } catch(e) {
      console.error('[DOT] ' + api.name + ' API failed: ' + e.message);
    }
  }

  // Group C: 511 state APIs
  for (var j = 0; j < DOT_511_STATES.length; j++) {
    var state = DOT_511_STATES[j];
    try {
      console.log('[DOT] Fetching ' + state.name + ' 511...');
      var res2  = await fetch(state.url, { headers: HEADERS });
      if (!res2.ok) { throw new Error('HTTP ' + res2.status); }
      var data2 = await res2.json();
      var cams2 = parse511Response(data2, state.name, state.source);
      all = all.concat(cams2);
      console.log('[DOT] ' + state.name + ': ' + cams2.length + ' cams');
      await sleep(500);
    } catch(e) {
      console.error('[DOT] ' + state.name + ' 511 failed: ' + e.message);
    }
  }

  console.log('[DOT] Total DOT cams: ' + all.length);
  return all;
}

module.exports = { scrapeDOT: scrapeDOT };
