// =============================================================
// FILE:    scripts/mgnCodegen.js
// PROJECT: Zengine.site × Modulign Standard DAG-OR v3.0
// AUTHOR:  © 2026 Zengine™ / Vincent Gonzalez
// VERSION: v1.0.0
// DATE:    2026-03-29
//
// Generates canonical MGN· codes for live stream observations.
// Called by scrapeStreams.js for every scraped stream.
//
// DECISION PROTOCOL (automated, observer: %ALG):
//   Step 1: Determine Domain from category + title
//   Step 2: Determine Subdomain from title keywords
//   Step 3: Determine Realm (always SR/ for surface streams)
//   Step 4: Determine Locus (G1/G2/G3/G4) from location data
//   Step 5: Assign Node (sequential Base-36 per locus scope)
//   Step 6: Assign Scale (|HMN| for all standard webcams)
//   Step 7: Assign Medium (:VID default, :SEN for sensor data)
//   Step 8: Assign Continuum (~CYC or ~TRN based on category)
//
// OUTPUT per stream:
//   mgn_code     — full canonical MGN address string
//   mgn_segments — parsed segment object for DB storage
//   confidence   — automated classification confidence (0-1)
//   reasoning    — Decision Protocol reasoning record
// =============================================================

'use strict';

// ===== DOMAIN MAP =====
// READS: category string  WRITES: domain + subdomain codes
var DOMAIN_MAP = {
  'city':     { domain: 'URB', subdomain_default: 'STR' },
  'nature':   { domain: 'NAT', subdomain_default: 'UNK' },
  'wildlife': { domain: 'NAT', subdomain_default: 'UNK' },
  'traffic':  { domain: 'TRN', subdomain_default: 'ROD' },
  'space':    { domain: 'NAT', subdomain_default: 'OBS' }
};

// ===== SUBDOMAIN RULES =====
// READS: title string  WRITES: subdomain code
// Applied after domain is known. First match wins.
var SUBDOMAIN_RULES = [
  // URB subdomains
  { pattern: /street|road|avenue|blvd|intersection|crosswalk|sidewalk/i, domain: 'URB', sub: 'STR' },
  { pattern: /park|plaza|square|garden|waterfront/i,                     domain: 'URB', sub: 'PKS' },
  { pattern: /skyline|overview|aerial|rooftop/i,                         domain: 'URB', sub: 'SKY' },
  { pattern: /campus|university|college|hospital/i,                      domain: 'URB', sub: 'CMP' },
  { pattern: /memorial|monument|landmark|heritage/i,                     domain: 'URB', sub: 'MEM' },
  { pattern: /construction|demolition/i,                                 domain: 'URB', sub: 'CNX' },
  { pattern: /times square|shibuya|abbey road|strip|boulevard/i,         domain: 'URB', sub: 'STR' },
  // NAT subdomains
  { pattern: /beach|surf|coast|shore|sand|bondi|miami|malibu/i,          domain: 'NAT', sub: 'CST' },
  { pattern: /ocean|sea|pelagic|maldive|pacific|atlantic/i,              domain: 'NAT', sub: 'OCN' },
  { pattern: /forest|woodland|jungle|rainforest|amazon/i,                domain: 'NAT', sub: 'FOR' },
  { pattern: /river|lake|wetland|marsh|delta/i,                          domain: 'NAT', sub: 'RVR' },
  { pattern: /mountain|alpine|peak|glacier|fuji|alps/i,                  domain: 'NAT', sub: 'MTN' },
  { pattern: /aurora|northern lights|sky|cloud|atmosphere|storm|weather/i, domain: 'NAT', sub: 'ATM' },
  { pattern: /polar|arctic|antarctic|penguin.*colony/i,                  domain: 'NAT', sub: 'POL' },
  { pattern: /volcano|geothermal|geyser|yellowstone/i,                   domain: 'NAT', sub: 'GEO' },
  { pattern: /canyon|desert|arid|badland/i,                              domain: 'NAT', sub: 'DST' },
  { pattern: /waterfall|falls|niagara/i,                                 domain: 'NAT', sub: 'RVR' },
  { pattern: /safari|savanna|watering hole|africam/i,                    domain: 'NAT', sub: 'FOR' },
  { pattern: /coral|reef|aquarium|jellyfish|shark/i,                     domain: 'NAT', sub: 'OCN' },
  { pattern: /observatory|telescope|space.*cam|iss|nasa/i,               domain: 'NAT', sub: 'OBS' },
  // TRN subdomains
  { pattern: /train|rail|metro|subway|tram|commuter/i,                   domain: 'TRN', sub: 'RAL' },
  { pattern: /highway|motorway|freeway|traffic|road|bridge.*traffic/i,   domain: 'TRN', sub: 'ROD' },
  { pattern: /airport|runway|terminal|flight/i,                          domain: 'TRN', sub: 'AIR' },
  { pattern: /port|harbour|harbor|ship|ferry|maritime/i,                 domain: 'TRN', sub: 'SEA' },
  // EVT subdomains
  { pattern: /concert|festival|performance/i,                            domain: 'EVT', sub: 'MUS' },
  { pattern: /sports|stadium|game|match/i,                               domain: 'EVT', sub: 'SPT' }
];

// ===== LOCATION MAP =====
// READS: title + tags  WRITES: { realm, g1, g2, g3, g4 }
// Covers all bootstrap entries + common scraped patterns.
var LOCATION_MAP = [
  // USA cities
  { pattern: /new york|nyc|times square|manhattan|brooklyn/i,   g1:'NA', g2:'US', g3:'NY', g4:'NYC' },
  { pattern: /los angeles|la beach|santa monica|malibu|hollywood/i, g1:'NA', g2:'US', g3:'CA', g4:'LAX' },
  { pattern: /miami|south beach|florida.*beach/i,               g1:'NA', g2:'US', g3:'FL', g4:'MIA' },
  { pattern: /chicago|windy city/i,                              g1:'NA', g2:'US', g3:'IL', g4:'CHI' },
  { pattern: /san francisco|bay area|golden gate/i,              g1:'NA', g2:'US', g3:'CA', g4:'SFO' },
  { pattern: /las vegas|vegas strip/i,                           g1:'NA', g2:'US', g3:'NV', g4:'LAS' },
  { pattern: /seattle|space needle/i,                            g1:'NA', g2:'US', g3:'WA', g4:'SEA' },
  { pattern: /new orleans|french quarter/i,                      g1:'NA', g2:'US', g3:'LA', g4:'MSY' },
  { pattern: /hawaii|honolulu|north shore|maui/i,                g1:'NA', g2:'US', g3:'HI', g4:'HNL' },
  { pattern: /alaska|bears.*alaska|brooks falls/i,               g1:'NA', g2:'US', g3:'AK', g4:'ANC' },
  { pattern: /yellowstone|grand canyon|niagara/i,                g1:'NA', g2:'US', g3:'WY', g4:'YNP' },
  { pattern: /fort myers|naples.*florida/i,                      g1:'NA', g2:'US', g3:'FL', g4:'FMY' },
  { pattern: /hurricane.*center|noaa/i,                          g1:'NA', g2:'US', g3:'FL', g4:'HRC' },
  { pattern: /nasa|kennedy space/i,                              g1:'NA', g2:'US', g3:'FL', g4:'KSC' },
  { pattern: /spacex/i,                                          g1:'NA', g2:'US', g3:'TX', g4:'BCA' },
  // Europe
  { pattern: /london|abbey road|uk cam|british/i,                g1:'WE', g2:'GB', g3:'ENG', g4:'LON' },
  { pattern: /paris|eiffel|france/i,                             g1:'WE', g2:'FR', g3:'IDF', g4:'PAR' },
  { pattern: /barcelona|la rambla/i,                             g1:'WE', g2:'ES', g3:'CAT', g4:'BCN' },
  { pattern: /amsterdam|netherlands|canal.*dutch/i,              g1:'WE', g2:'NL', g3:'NH', g4:'AMS' },
  { pattern: /dublin|temple bar|ireland/i,                       g1:'WE', g2:'IE', g3:'L', g4:'DUB' },
  { pattern: /rome|colosseum|italy.*rome/i,                      g1:'WE', g2:'IT', g3:'LAZ', g4:'ROM' },
  { pattern: /venice|grand canal/i,                              g1:'WE', g2:'IT', g3:'VEN', g4:'VCE' },
  { pattern: /prague|czech/i,                                    g1:'WE', g2:'CZ', g3:'PR', g4:'PRG' },
  { pattern: /dubrovnik|croatia/i,                               g1:'WE', g2:'HR', g3:'DBK', g4:'DBV' },
  { pattern: /santorini|athens|greece/i,                         g1:'WE', g2:'GR', g3:'ATT', g4:'ATH' },
  { pattern: /alps|swiss|switzerland/i,                          g1:'WE', g2:'CH', g3:'VD', g4:'GVA' },
  { pattern: /canary island/i,                                   g1:'WE', g2:'ES', g3:'CN', g4:'TFN' },
  // Asia
  { pattern: /tokyo|shibuya|japan/i,                             g1:'EA', g2:'JP', g3:'TKY', g4:'TOK' },
  { pattern: /mount fuji|fuji/i,                                 g1:'EA', g2:'JP', g3:'SZO', g4:'FUJ' },
  { pattern: /hong kong|harbour.*hong/i,                         g1:'EA', g2:'HK', g3:'HK', g4:'HKG' },
  { pattern: /seoul|korea/i,                                     g1:'EA', g2:'KR', g3:'SEL', g4:'SEL' },
  { pattern: /beijing|china(?!.*hong)/i,                         g1:'EA', g2:'CN', g3:'BJ', g4:'BEJ' },
  { pattern: /singapore/i,                                       g1:'SE', g2:'SG', g3:'SG', g4:'SIN' },
  { pattern: /maldive/i,                                         g1:'SC', g2:'MV', g3:'MV', g4:'MLE' },
  // Oceania
  { pattern: /sydney|bondi|opera house/i,                        g1:'OC', g2:'AU', g3:'NSW', g4:'SYD' },
  { pattern: /australia(?!.*sydney)/i,                           g1:'OC', g2:'AU', g3:'VIC', g4:'MEL' },
  // Americas
  { pattern: /amazon|brazil/i,                                   g1:'SA', g2:'BR', g3:'AM', g4:'MNS' },
  // Africa
  { pattern: /africa|safari|nkorho|savanna|africam/i,            g1:'AF', g2:'ZA', g3:'LP', g4:'CPT' },
  // Polar / Special
  { pattern: /iceland|northern lights|aurora/i,                  g1:'WE', g2:'IS', g3:'IS', g4:'REY' },
  { pattern: /antarctic|penguin.*colony/i,                       g1:'PL', g2:'AQ', g3:'AQ', g4:'MCM' },
  { pattern: /arctic|polar.*bear/i,                              g1:'PL', g2:'NO', g3:'SVA', g4:'LYR' },
  // Space — special realm handling
  { pattern: /iss|international space station/i,  realm:'OR', g1:'L1', g2:'ISS', g3:'ISS', g4:'ISS' },
  { pattern: /james webb|jwst/i,                  realm:'OR', g1:'L2', g2:'JWT', g3:'JWT', g4:'JWT' },
  { pattern: /spacex.*facility|launch.*pad/i,     realm:'SR', g1:'NA', g2:'US', g3:'TX', g4:'BCA' },
  { pattern: /moon/i,                             realm:'LN', g1:'LN', g2:'LN', g3:'LN', g4:'LNS' },
  { pattern: /nasa(?!.*kennedy)/i,                realm:'OR', g1:'NA', g2:'US', g3:'FL', g4:'KSC' }
];

// ===== CONTINUUM RULES =====
// READS: category  WRITES: continuum code
function inferContinuum(category, title) {
  var t = (title || '').toLowerCase();
  if (/storm|hurricane|eruption|earthquake/i.test(t)) { return 'TRN'; } // transient event
  if (/rush hour|peak|event|concert|game/i.test(t))   { return 'CYC'; } // cyclical
  if (category === 'traffic')   { return 'CYC'; }
  if (category === 'wildlife')  { return 'CYC'; }
  if (category === 'nature')    { return 'STC'; } // mostly static
  if (category === 'space')     { return 'STC'; }
  return 'CYC'; // default: cyclical for city/urban feeds
}

// ===== NODE COUNTER =====
// READS: locus key  WRITES: Base-36 node string
// Nodes are locally scoped per locus (G1/G2/G3/G4)
var nodeCounters = {};
var BASE36_CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // excl O and I

function toBase36(n) {
  if (n === 0) { return '0000'; }
  var result = '';
  while (n > 0) {
    result = BASE36_CHARS[n % 36] + result;
    n = Math.floor(n / 36);
  }
  while (result.length < 4) { result = '0' + result; }
  return result.substring(0, 4);
}

// READS: locus string  WRITES: 4-char Base-36 node
function nextNode(locus) {
  if (!nodeCounters[locus]) { nodeCounters[locus] = 0; }
  nodeCounters[locus]++;
  return toBase36(nodeCounters[locus]);
}

// ===== DOMAIN CLASSIFIER =====
// READS: stream { category, title, tags }
// WRITES: { domain, subdomain, confidence, reasoning }
function classifyDomain(stream) {
  var category = stream.category || 'city';
  var title    = stream.title    || '';
  var reasoning = [];

  // Step 1: base domain from category
  var domainEntry = DOMAIN_MAP[category] || DOMAIN_MAP['city'];
  var domain    = domainEntry.domain;
  var subdomain = domainEntry.subdomain_default;
  var confidence = 0.70; // base confidence for algorithmic classification
  reasoning.push('Domain ' + domain + ' inferred from category "' + category + '"');

  // Special: wildlife in NAT but EVT takes priority for event feeds
  if (category === 'wildlife') {
    domain = 'NAT';
    subdomain = 'UNK';
    reasoning.push('Wildlife category → NAT domain');
  }
  if (category === 'space') {
    domain = 'NAT';
    subdomain = 'OBS';
    reasoning.push('Space category → NAT·OBS');
  }

  // Step 2: refine subdomain from title keywords
  for (var i = 0; i < SUBDOMAIN_RULES.length; i++) {
    var rule = SUBDOMAIN_RULES[i];
    if (rule.domain === domain && rule.pattern.test(title)) {
      subdomain = rule.sub;
      confidence = Math.min(confidence + 0.10, 0.90);
      reasoning.push('Subdomain ' + rule.sub + ' matched pattern in title: "' + title + '"');
      break;
    }
  }

  // EVT override: if title strongly signals event context
  if (/\bconcert\b|\bfestival\b|\bgame\b|\bmatch\b|\blive event\b/i.test(title)) {
    domain    = 'EVT';
    subdomain = 'MUS';
    confidence = 0.75;
    reasoning.push('EVT override: event-context keyword detected in title');
  }

  return { domain: domain, subdomain: subdomain, confidence: confidence, reasoning: reasoning };
}

// ===== LOCATION CLASSIFIER =====
// READS: stream { title, tags }
// WRITES: { realm, g1, g2, g3, g4, confidence, reasoning }
function classifyLocation(stream) {
  var title    = stream.title || '';
  var tags     = (stream.tags || []).join(' ');
  var combined = title + ' ' + tags;
  var reasoning = [];

  for (var i = 0; i < LOCATION_MAP.length; i++) {
    var loc = LOCATION_MAP[i];
    if (loc.pattern.test(combined)) {
      reasoning.push('Location ' + [loc.g1, loc.g2, loc.g3, loc.g4].filter(Boolean).join('/') +
        ' matched pattern in: "' + combined.substring(0, 60) + '"');
      return {
        realm:     loc.realm || 'SR',
        g1:        loc.g1,
        g2:        loc.g2,
        g3:        loc.g3,
        g4:        loc.g4,
        confidence: 0.80,
        reasoning: reasoning
      };
    }
  }

  // No match — use UNK/UNK/UNK/UNK
  reasoning.push('Location could not be determined from title/tags — UNK assigned');
  return {
    realm: 'SR', g1: 'UNK', g2: 'UNK', g3: 'UNK', g4: 'UNK',
    confidence: 0.40,
    reasoning: reasoning
  };
}

// ===== MEDIUM CLASSIFIER =====
// READS: stream { stream_type, source }
// WRITES: medium code string
function classifyMedium(stream) {
  if (stream.stream_type === 'mjpeg')    { return 'VID'; } // MJPEG is video medium
  if (/sensor|seismic|weather/i.test(stream.title || '')) { return 'SEN'; }
  return 'VID'; // default
}

// ===== MAIN CODEGEN FUNCTION =====
// READS: stream object { id, title, category, stream_type, url, tags, source }
// WRITES: { mgn_code, mgn_segments, confidence, reasoning }
function generateMGNCode(stream) {
  try {
    var domainResult   = classifyDomain(stream);
    var locationResult = classifyLocation(stream);
    var medium         = classifyMedium(stream);
    var scale          = 'HMN'; // all standard webcams are human scale
    var continuum      = inferContinuum(stream.category, stream.title);
    var observer       = 'ALG'; // algorithmic observer — Decision Protocol automated

    // Special scale overrides
    if (/telescope|jwst|james webb|deep field|hubble/i.test(stream.title || '')) {
      scale = 'STL'; // stellar/solar system scale
    }
    if (/satellite|orbital|iss|space station/i.test(stream.title || '')) {
      scale = 'GEO'; // geological/planetary scale view from orbit
    }
    if (/microscop|cellular|dna|molecule/i.test(stream.title || '')) {
      scale = 'MLC'; // molecular/cellular scale
    }

    // Locus chain
    var realm = locationResult.realm;
    var locus = [locationResult.g1, locationResult.g2,
                 locationResult.g3, locationResult.g4]
                 .filter(Boolean).join('/');
    var locusKey = realm + '/' + locus;
    var node = nextNode(locusKey);

    // Build full MGN code
    // Required: MGN· DOM·SUB · REALM/G1/G2/G3/G4 · NOD
    // Recommended: |SCL| · :MED · ~DYN
    // Observer: %ALG (algorithmic)
    var parts = [
      'MGN',
      domainResult.domain + '\u00B7' + domainResult.subdomain,
      realm + '/' + locus,
      node,
      '|' + scale + '|',
      ':' + medium,
      '%' + observer,
      '~' + continuum
    ];

    var mgn_code = parts.join('\u00B7');
    // Unicode middle dot U+00B7 as separator per spec

    // Combined confidence (weighted average)
    var confidence = Number(
      ((domainResult.confidence * 0.5) + (locationResult.confidence * 0.5)).toFixed(3)
    );

    // Combined reasoning
    var allReasoning = domainResult.reasoning
      .concat(locationResult.reasoning)
      .concat([
        'Scale: |' + scale + '| — standard webcam, human-scale implied',
        'Medium: :' + medium + ' — stream type "' + (stream.stream_type || 'embed') + '"',
        'Observer: %ALG — Decision Protocol applied algorithmically by ZengineCamBot v1.0.0',
        'Continuum: ~' + continuum + ' — inferred from category "' + stream.category + '"',
        'Node: ' + node + ' — sequential Base-36 assignment within locus ' + locusKey
      ]);

    return {
      mgn_code: mgn_code,
      mgn_segments: {
        namespace:    'MGN',
        domain:       domainResult.domain,
        subdomain:    domainResult.subdomain,
        realm:        realm,
        g1:           locationResult.g1,
        g2:           locationResult.g2,
        g3:           locationResult.g3,
        g4:           locationResult.g4,
        node:         node,
        scale:        scale,
        medium:       medium,
        observer:     observer,
        continuum:    continuum,
        meta_flags:   ['PROV'], // algorithmic = provisional until human review
        confidence:   confidence
      },
      confidence: confidence,
      reasoning:  allReasoning.join(' | ')
    };
  } catch(e) {
    console.error('[MGN Codegen] Error for stream "' + (stream.title || '?') + '": ' + e.message);
    // Return minimal fallback code
    return {
      mgn_code: 'MGN\u00B7UNK\u00B7UNK\u00B7SR/UNK/UNK/UNK/UNK\u00B70000\u00B7|HMN|\u00B7:VID\u00B7%ALG\u00B7~CYC',
      mgn_segments: {
        namespace: 'MGN', domain: 'UNK', subdomain: 'UNK',
        realm: 'SR', g1: 'UNK', g2: 'UNK', g3: 'UNK', g4: 'UNK',
        node: '0000', scale: 'HMN', medium: 'VID',
        observer: 'ALG', continuum: 'CYC',
        meta_flags: ['PROV'], confidence: 0.1
      },
      confidence: 0.1,
      reasoning: 'Codegen error — fallback UNK code assigned'
    };
  }
}

// Reset node counters (call between scrape runs if needed)
function resetNodeCounters() {
  nodeCounters = {};
}

module.exports = { generateMGNCode: generateMGNCode, resetNodeCounters: resetNodeCounters };
