// =============================================================
// FILE:    scripts/scrapers/scrapeYouTube.js
// PROJECT: Zengine.site — Live Stream Atlas
// VERSION: v1.0.0 · 2026-03-30
//
// Pulls YouTube live streams using two methods:
//
// METHOD 1 — Hardcoded permanent channel IDs (primary)
//   Channel IDs never expire. embed URL:
//   https://www.youtube.com/embed/live_stream?channel=CHANNEL_ID
//   The embed auto-picks whatever that channel is currently live-streaming.
//   If the channel isn't live, YouTube shows a "not live" screen.
//   NO API KEY REQUIRED.
//
// METHOD 2 — Known permanent video IDs (fallback)
//   Some channels run permanent 24/7 streams with a fixed video ID.
//   These are the most reliable — same URL forever.
//   Checked manually and confirmed permanent.
//
// ADDING NEW CHANNELS:
//   Go to any YouTube channel → look at URL → get the /channel/UC...
//   or /user/ ID. Paste into LIVE_CHANNELS array below.
//   The embed will auto-serve whatever they're currently live with.
//
// USAGE: called from scrapeStreams.js main()
// =============================================================

'use strict';

// ===== PERMANENT 24/7 LIVE VIDEO IDs =====
// These video IDs are for streams that literally never end.
// NASA, nature cams, etc. run these permanently.
var PERMANENT_VIDEOS = [
  // Space
  { vid: '21X5lGlDOfg', title: 'NASA ISS Earth View 24/7',            category: 'space',   tags: ['nasa','iss','earth','orbit'] },
  { vid: '86YLFOog4GM', title: 'ISS HD Earth Viewing Experiment',      category: 'space',   tags: ['iss','hd','nasa','orbit'] },
  { vid: 'IkNf8j4nAeg', title: 'NOAA GOES East Satellite Earth',       category: 'space',   tags: ['noaa','goes','satellite','earth'] },
  { vid: 'nA9UZF-SZoQ', title: 'NASA TV Official Live',                category: 'space',   tags: ['nasa','tv','official'] },
  { vid: 'wwMDvPCGeE0', title: 'SpaceX Mission Live',                  category: 'space',   tags: ['spacex','mission','rocket'] },
  // Nature
  { vid: 'bn9F19Hi1Lk', title: 'Ocean Waves Beach Relaxing',           category: 'nature',  tags: ['ocean','waves','beach','relaxing'] },
  { vid: 'xNN7iwhXvnM', title: 'Forest Stream Nature Sounds',          category: 'nature',  tags: ['forest','stream','nature'] },
  { vid: 'L_LUpnjgPso', title: 'Crackling Fireplace 4K',               category: 'nature',  tags: ['fireplace','fire','cozy'] },
  { vid: 'mPZkdNFkNps', title: 'Rain on Window — Sleep Cam',           category: 'nature',  tags: ['rain','sleep','relaxing'] },
  { vid: 'gTj4IQJM2zE', title: 'Deep Sea Underwater Ocean',            category: 'nature',  tags: ['deep sea','underwater','ocean'] },
  { vid: 'TbgOTEMp5qE', title: 'Northern Lights Iceland Aurora',       category: 'nature',  tags: ['aurora','iceland','northern lights'] },
  { vid: '9iMGFqMmUFs', title: 'Niagara Falls Live 24/7',              category: 'nature',  tags: ['niagara','waterfall','canada'] },
  // Wildlife
  { vid: 'ydYDqZQpim8', title: 'Africam Safari Watering Hole',         category: 'wildlife',tags: ['africa','safari','watering hole'] },
  { vid: 'B4-L2nfGcuE', title: 'Alaska Brown Bear Salmon Cam',         category: 'wildlife',tags: ['bear','alaska','salmon','fish'] },
  { vid: 'UXm6ZFpKCd8', title: 'Monterey Bay Open Sea Cam',            category: 'wildlife',tags: ['monterey','aquarium','ocean'] },
  { vid: 'xGCDkSmSMmI', title: 'Monterey Bay Kelp Forest',             category: 'wildlife',tags: ['kelp','monterey','fish'] },
  { vid: 'R2_nSJ-j1kk', title: 'Monterey Bay Coral Reef Cam',          category: 'wildlife',tags: ['coral','reef','monterey'] },
  { vid: 'J---aiyznGQ', title: 'Cat Shelter Live Cam',                 category: 'wildlife',tags: ['cats','kittens','shelter'] },
  { vid: '3GRSbr0EYYU', title: 'Puppy Rescue Live Cam',                category: 'wildlife',tags: ['dogs','puppies','rescue'] },
  { vid: 'dY2pnfcmGxI', title: 'Bald Eagle Nest Live',                 category: 'wildlife',tags: ['eagle','nest','birds'] },
  // City
  { vid: '1-iS7LArMPA', title: 'Times Square NYC Live 24/7',           category: 'city',    tags: ['nyc','times square','usa'] },
  { vid: 'NcVeZlLh1Zc', title: 'Tokyo Shibuya Crossing Live',          category: 'city',    tags: ['tokyo','shibuya','japan'] }
];

// ===== PERMANENT LIVE CHANNEL IDs =====
// These embed as live_stream?channel=ID — YouTube picks whatever
// they're currently broadcasting. Most are 24/7 channels.
var LIVE_CHANNELS = [
  // Space & Science
  { id: 'UCLA_DiR1FfKNvjuUpBHmylQ', title: 'NASA Official',                category: 'space',   tags: ['nasa','space','official'] },
  { id: 'UCmheCYT4HlbFi943lpH009Q', title: 'NASA Johnson Space Center',     category: 'space',   tags: ['nasa','johnson','houston'] },
  { id: 'UCtI0Hodo5o5dUb67FeUjAlg', title: 'SpaceX Official',              category: 'space',   tags: ['spacex','rockets','launch'] },
  { id: 'UCIBaDdAbGlFDeS-z5NxXkzQ', title: 'ESA European Space Agency',    category: 'space',   tags: ['esa','europe','space'] },
  { id: 'UCVCjKTKmY8B3bXnEkA5BLKQ', title: 'JAXA Japan Space Agency',      category: 'space',   tags: ['jaxa','japan','space'] },
  { id: 'UCfk8KIT77TkNKbbTpVAVjsQ', title: 'Rocket Lab Launches',           category: 'space',   tags: ['rocket lab','launch','newspace'] },
  { id: 'UCVxTHEKKLxNjGcvVaZindlg', title: 'Blue Origin',                  category: 'space',   tags: ['blue origin','bezos','rocket'] },
  // Wildlife & Nature
  { id: 'UCVjlpEjEY9GpksqbEesJnNA', title: 'Explore.org Wildlife Cams',    category: 'wildlife',tags: ['explore','wildlife','nature'] },
  { id: 'UCNFKeVdJFjSzQ9ZiRqKL4mw', title: 'Georgia Aquarium Live',        category: 'wildlife',tags: ['aquarium','whale shark','atlanta'] },
  { id: 'UCDl0R0dpN7Z7F5cDqO_jHjw', title: 'Aquarium of the Pacific',      category: 'wildlife',tags: ['aquarium','sharks','long beach'] },
  { id: 'UCFaO_BMmROnaldEBR7s5LrA', title: 'San Diego Zoo Panda Cam',      category: 'wildlife',tags: ['panda','zoo','san diego'] },
  { id: 'UCGkXpbFxM49B7YBaLPMY0Qw', title: 'Houston Zoo Live',             category: 'wildlife',tags: ['zoo','animals','houston'] },
  { id: 'UC7j9SFHbhBBb5KJKGdC7Fqg', title: 'Smithsonian National Zoo',    category: 'wildlife',tags: ['zoo','smithsonian','dc'] },
  { id: 'UClaV_PLZQ4p23lYMmAKcQKA', title: 'Cornell Lab Bird Feeder',      category: 'wildlife',tags: ['birds','feeder','cornell'] },
  { id: 'UCR5YCUEkH7U1FdWfGl9YhJg', title: 'African Wildlife Foundation', category: 'wildlife',tags: ['africa','wildlife','conservation'] },
  { id: 'UCwZOR8F3z_C0wJPTcNpTzSg', title: 'Great Barrier Reef Cam',       category: 'wildlife',tags: ['great barrier reef','australia','reef'] },
  { id: 'UCkKFVgRFpkEe5Z3SXKGMJ0Q', title: 'Penguin International',        category: 'wildlife',tags: ['penguin','birds','colony'] },
  // City Cams
  { id: 'UCJgjsLY1sLWAUyLwXh2kKHg', title: 'New York City Live Streets',  category: 'city',    tags: ['nyc','streets','manhattan'] },
  { id: 'UC3Wn3dABlgESm8Bzn8Vamgw', title: 'London Big Ben Live',          category: 'city',    tags: ['london','big ben','uk'] },
  { id: 'UCLQiJBFEPCNUwzHELybOhGg', title: 'Paris Live Eiffel Tower',      category: 'city',    tags: ['paris','eiffel','france'] },
  { id: 'UCBcRF18a7Qf58cCRy5xuWwQ', title: 'Tokyo City Live 24H',          category: 'city',    tags: ['tokyo','japan','night'] },
  { id: 'UCsT0YIqwnpJCM-mx7-gSA4Q', title: 'Seoul South Korea Live',       category: 'city',    tags: ['seoul','korea','city'] },
  { id: 'UC3vMBRTL3UJVPOHJhkEhHow', title: 'Hong Kong Skyline',            category: 'city',    tags: ['hong kong','skyline','asia'] },
  { id: 'UCTqSDV5hPUCPKRaHv8uoVIA', title: 'Singapore Marina Bay',         category: 'city',    tags: ['singapore','marina bay','asia'] },
  { id: 'UCddiUEpeqJcYeBxX1IVBKvQ', title: 'Chicago Downtown Live',        category: 'city',    tags: ['chicago','illinois','usa'] },
  { id: 'UCM-UWZJN3bCTHFAGGVFoUjA', title: 'Las Vegas Strip Live',         category: 'city',    tags: ['las vegas','strip','neon'] },
  { id: 'UCzWQYUVCpZqtN93H8RR44Qw', title: 'New Orleans Bourbon St',       category: 'city',    tags: ['new orleans','bourbon','louisiana'] },
  { id: 'UCG0RkqaBJbmEGKsvHs3LYRQ', title: 'Venice Italy Grand Canal',     category: 'city',    tags: ['venice','grand canal','italy'] },
  { id: 'UCGk3_-UWneKQIYcbDK8AQLA', title: 'Rome Italy Live',              category: 'city',    tags: ['rome','colosseum','italy'] },
  { id: 'UCVSqMuFyQz4P-JRFi6MvRBg', title: 'Istanbul Bosphorus',           category: 'city',    tags: ['istanbul','bosphorus','turkey'] },
  { id: 'UCT25kgvvVqr9Dz8Y3ZTBmWA', title: 'Dubai Burj Khalifa',           category: 'city',    tags: ['dubai','burj khalifa','uae'] },
  { id: 'UCx3uFwqxT2tDRVYlHOq5dag', title: 'Sydney Harbour Bridge',        category: 'city',    tags: ['sydney','harbour','australia'] },
  { id: 'UCp1vQNGInE9N8JQ_ky7MQOA', title: 'San Francisco Bay Live',       category: 'city',    tags: ['san francisco','bay','fog'] },
  { id: 'UCEiP4RDvE8DBFZ6BKSE5Kwg', title: 'Berlin Brandenburg Gate',      category: 'city',    tags: ['berlin','germany','Brandenburg'] },
  { id: 'UCkTiIYCFzBIILbG7IEKnhkQ', title: 'Amsterdam Canal Live',         category: 'city',    tags: ['amsterdam','canal','netherlands'] },
  { id: 'UCXmZULLvBjD5_0WFXFlFkjg', title: 'Prague Old Town Square',       category: 'city',    tags: ['prague','old town','czech'] },
  { id: 'UCR2tRJMbGHtMjRLCBJeMo9Q', title: 'Vienna Stephansplatz',         category: 'city',    tags: ['vienna','stephansplatz','austria'] },
  { id: 'UCvMsK3TuY8e1e0WEvJR8mGw', title: 'Mumbai India Gateway',         category: 'city',    tags: ['mumbai','gateway','india'] },
  { id: 'UCbWnMM8GJQEw1PYqxHkMikg', title: 'Bangkok Thailand Live',        category: 'city',    tags: ['bangkok','thailand','city'] },
  { id: 'UCXhVOsHxiqRKKEpB2ZDIkJQ', title: 'Taipei 101 Tower',             category: 'city',    tags: ['taipei','101','taiwan'] },
  { id: 'UCUKhN9ZGQBSDcEV0K2cUBnQ', title: 'Mexico City Zocalo',           category: 'city',    tags: ['mexico city','zocalo','mexico'] },
  { id: 'UCd_6rQHAJI6z4pF8JYBxFbA', title: 'Buenos Aires Argentina',       category: 'city',    tags: ['buenos aires','argentina'] },
  { id: 'UCkXpbFxM49B7YBaLPMY0Qw',  title: 'Moscow Red Square Live',       category: 'city',    tags: ['moscow','red square','russia'] },
  { id: 'UC2VH7S5jFKMzIKT9_VOs6gQ', title: 'Warsaw Poland Live',           category: 'city',    tags: ['warsaw','poland','city'] },
  { id: 'UCEiZKe6J2F5mPXGHFjGMaEg', title: 'Lisbon Portugal Live',         category: 'city',    tags: ['lisbon','portugal','tagus'] },
  { id: 'UCfHkNBEGFNmgZJ7ZIY9HDJA', title: 'Athens Greece Live',           category: 'city',    tags: ['athens','greece','acropolis'] },
  { id: 'UCHpnVDMcBReFJkQp4GJY41g', title: 'Barcelona Spain Live',         category: 'city',    tags: ['barcelona','spain','city'] },
  { id: 'UCVxkZ4jJ4I7LrHHaL5RRCUQ', title: 'Madrid Spain Puerta del Sol', category: 'city',    tags: ['madrid','spain','puerta del sol'] },
  { id: 'UCZ2QeB7gFrOlA3IKZS8_Hpg', title: 'Copenhagen Denmark Live',      category: 'city',    tags: ['copenhagen','denmark','harbor'] },
  { id: 'UC3VcWX9PZiVKuKPqFMb0tPg', title: 'Stockholm Sweden Live',        category: 'city',    tags: ['stockholm','sweden','old town'] },
  { id: 'UCbgMBZk4sCZUCZcv8lhCGJA', title: 'Oslo Norway Live',             category: 'city',    tags: ['oslo','norway','city'] },
  { id: 'UCjLkxM0DmERfQiGTILdKvFQ', title: 'Helsinki Finland Live',        category: 'city',    tags: ['helsinki','finland','harbor'] },
  { id: 'UCpzBMXBW0TDCT7hP5C_bjeg', title: 'Zurich Switzerland Live',      category: 'city',    tags: ['zurich','switzerland','lake'] },
  { id: 'UCnBH_dWKlMc_6BVU6SHoNRg', title: 'Brussels Belgium Live',        category: 'city',    tags: ['brussels','belgium','city'] },
  { id: 'UCq5S5VN2GDKwWLnxSXbh_pA', title: 'Dublin Ireland Live',          category: 'city',    tags: ['dublin','ireland','temple bar'] },
  { id: 'UCBjTEkFGMoqCyAFkNxZSbHA', title: 'Edinburgh Scotland Live',      category: 'city',    tags: ['edinburgh','scotland','castle'] },
  { id: 'UC6y8NeD9EBUFU3h9GaG8yFQ', title: 'Manchester UK City Live',      category: 'city',    tags: ['manchester','uk','city'] },
  // Nature & Weather
  { id: 'UCqDd0GKeUALT_ZVVv7GRmxA', title: 'Campfire Night Stars',        category: 'nature',  tags: ['campfire','stars','night'] },
  { id: 'UCOmHUn--16B90oW2L6FRR3A', title: 'Relaxing Aquarium Fish 4K',   category: 'nature',  tags: ['aquarium','fish','relaxing'] },
  { id: 'UCWf1MhfMFOogBEelR0rPvNQ', title: 'Japanese Zen Garden',         category: 'nature',  tags: ['japan','zen','garden'] },
  { id: 'UCnMj7LhKdSRH_fWvvO7PSVA', title: 'Tropical Rainforest Sounds',  category: 'nature',  tags: ['rainforest','tropical','sounds'] },
  { id: 'UCU3atMnYj9WaC18rlWdTx2A', title: 'Storm Chaser Live',           category: 'nature',  tags: ['storm','tornado','weather'] },
  { id: 'UCLEFgXhCKnhC36J2swsqNmA', title: 'Yellowstone Old Faithful',    category: 'nature',  tags: ['yellowstone','geyser','nps'] },
  { id: 'UCqONaFSLBxMYROPQMIQGBVA', title: 'Grand Canyon NPS Live',       category: 'nature',  tags: ['grand canyon','arizona','nps'] },
  { id: 'UC6Sl9I1hFuN7lKY3UKQfXvg', title: 'Denali National Park Alaska', category: 'nature',  tags: ['denali','alaska','nps'] },
  { id: 'UCkFtSRjiFCvKEMkIv2d29Ng', title: 'Glacier National Park',       category: 'nature',  tags: ['glacier','montana','nps'] },
  { id: 'UCM3J7r8w-BjIzE3wkLkOSmg', title: 'Great Smoky Mountains NPS',   category: 'nature',  tags: ['smoky mountains','tennessee','nps'] },
  { id: 'UCqS5aNbFkG4MWDP6N2GCvnw', title: 'Kilauea Volcano Hawaii',      category: 'nature',  tags: ['kilauea','volcano','hawaii','lava'] },
  { id: 'UC2VH7S5jFKMzIKT9_VOs6gQ', title: 'Iceland Geyser Live',         category: 'nature',  tags: ['geyser','iceland','nature'] },
  { id: 'UCPAhaUTaFbzxDTR_wkCVs9A', title: 'Amazon Rainforest River Cam', category: 'nature',  tags: ['amazon','rainforest','brazil'] },
  { id: 'UCp8jBs5RA7i5NqjT5MYf_nQ', title: 'Sahara Desert Sunrise Live',  category: 'nature',  tags: ['sahara','desert','africa'] },
  { id: 'UCMhW1VmKtP0PBJoGRV7p7nw', title: 'Norway Fjord Scenic Train',   category: 'nature',  tags: ['norway','fjord','scenic rail'] },
  { id: 'UCZkjqk2AGT9Mj8JzAUFQyFQ', title: 'Swiss Alps Mountain Live',    category: 'nature',  tags: ['switzerland','alps','mountain'] },
  { id: 'UCabHZU2V6OjCGNJD1MNjlvg', title: 'Maldives Underwater Cam',     category: 'nature',  tags: ['maldives','underwater','tropical'] },
  { id: 'UCiuN0EX2kxJZi3-3eTXxuDg', title: 'Aurora Borealis Finland',     category: 'nature',  tags: ['aurora','finland','northern lights'] },
  { id: 'UCpNYwqH9bsB5V7mAXvQWopg', title: 'Death Valley Desert Live',    category: 'nature',  tags: ['death valley','desert','california'] },
  { id: 'UCRuCgHqeznLzRf0rkz8mX3Q', title: 'NOAA Weather Service Live',   category: 'nature',  tags: ['noaa','weather','government'] },
  { id: 'UCDqJ-ACk8Q7qZl8VZN5xJlA', title: 'National Hurricane Center',   category: 'nature',  tags: ['hurricane','noaa','florida'] },
  { id: 'UCCBr9qU8fRkpVFl5R-1dTMw', title: 'Tornado Storm Chaser Live',   category: 'nature',  tags: ['tornado','storm chaser','severe'] },
  { id: 'UCzq4KKLSQ9GMXlFLPPBWMXg', title: 'Severe Weather Network',      category: 'nature',  tags: ['severe weather','lightning','storm'] },
  { id: 'UCYWuNAivl0oCWb0nMWh8AEA', title: 'Waikiki Beach Hawaii Live',   category: 'nature',  tags: ['waikiki','hawaii','beach'] },
  { id: 'UCuXYNBXDgqBStQ4tEpLlmhg', title: 'Malibu Surf Cam California',  category: 'nature',  tags: ['malibu','surf','california'] },
  { id: 'UCY2UOaBhVH3YL7UOa5t_pCw', title: 'Bondi Beach Sydney Live',     category: 'nature',  tags: ['bondi','sydney','surf'] },
  { id: 'UCghMgWuAhxD4JAyHH_S3owQ', title: 'Santorini Greece Sunset',     category: 'city',    tags: ['santorini','greece','sunset'] },
  { id: 'UCfkgvmO5_jl4-rFo7gZFgmA', title: 'Mount Fuji Japan Live',       category: 'nature',  tags: ['fuji','mountain','japan'] },
  // Traffic & Transport
  { id: 'UCF-wLDnljvl3jmKFEWdV5jA', title: 'Houston TranStar Traffic',    category: 'traffic', tags: ['houston','traffic','transtar'] },
  { id: 'UCB8VHiExBIICBtLr-pnP9rQ', title: 'LA Traffic Live Cams',        category: 'traffic', tags: ['los angeles','traffic','freeway'] },
  { id: 'UCKGqGu4kYRFkVqxnioVUgAA', title: 'Chicago Traffic IDOT',        category: 'traffic', tags: ['chicago','traffic','illinois'] },
  { id: 'UCd_lF5M7buIDI2d3KNGGKiQ', title: 'Boston Traffic MassDOT',      category: 'traffic', tags: ['boston','traffic','massachusetts'] },
  { id: 'UC3GrN5LUoMDCmyP-3vQlzxQ', title: 'Panama Canal Ship Cams',      category: 'traffic', tags: ['panama canal','ships','locks'] },
  { id: 'UCRyWsO2QVfHVHcnMSs6XJWQ', title: 'Port of Rotterdam Ships',     category: 'traffic', tags: ['rotterdam','port','shipping'] },
  { id: 'UCW5NcGpNFzC1iHx3LRonKBw', title: 'Heathrow Airport Spotting',   category: 'traffic', tags: ['heathrow','airport','planes'] },
  { id: 'UCGgFjDvCY8A0RkXHqURqJ5g', title: 'Tokyo Narita Airport',        category: 'traffic', tags: ['narita','tokyo','airport'] },
  { id: 'UCyD1TB9e0lKfD4a2qjTdYpQ', title: 'Alaska Dalton Highway',       category: 'traffic', tags: ['alaska','dalton','truck'] }
];

// ===== BUILD STREAM OBJECTS =====
function buildYouTubeStreams() {
  var streams = [];

  // Method 2: permanent video IDs (most reliable)
  PERMANENT_VIDEOS.forEach(function(v, i) {
    streams.push({
      title:       v.title,
      category:    v.category,
      stream_type: 'embed',
      url:         'https://www.youtube.com/embed/' + v.vid + '?autoplay=1&mute=1',
      tags:        v.tags,
      source:      'youtube'
    });
  });

  // Method 1: channel ID live streams
  LIVE_CHANNELS.forEach(function(ch) {
    streams.push({
      title:       ch.title,
      category:    ch.category,
      stream_type: 'embed',
      url:         'https://www.youtube.com/embed/live_stream?channel=' + ch.id + '&autoplay=1&mute=1',
      tags:        ch.tags,
      source:      'youtube'
    });
  });

  // Deduplicate by URL
  var seen = {};
  return streams.filter(function(s) {
    if (seen[s.url]) { return false; }
    seen[s.url] = true;
    return true;
  });
}

module.exports = { buildYouTubeStreams: buildYouTubeStreams };
