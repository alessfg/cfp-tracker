import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyCategories,
  classifyOrganizer,
  isActiveMeetupCall,
  isMeetup,
  organizerParents,
  regionForCountry,
  regionForTimezone,
} from './classify.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '..', 'data', 'cfps.json');
const MANUAL = resolve(__dirname, '..', 'data', 'manual-cfps.json');

const USER_AGENT = 'cfp-tracker (+https://github.com/alessfg/cfp-tracker)';
// Some CFPs are listed as "always open" with closing dates decades away.
const MAX_CFP_DAYS_AHEAD = 2 * 365;
// Recently closed CFPs are kept until merging, so they can correct sources that
// still list them as open.
const CLOSED_GRACE_DAYS = 60;
// Refuse to overwrite the data if the new list shrinks this much (likely a source outage).
const MIN_RETAINED_RATIO = 0.5;
// PaperCall shut down in 2026; its CFP links no longer resolve.
const DEAD_HOSTS = new Set(['papercall.io']);

const US_STATE_CODES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const US_STATES = new Set(Object.values(US_STATE_CODES));
const VIRTUAL_RE = /^(online|virtual|remote)$/i;

function toISODate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

// Calendar date of a timestamp in the event's own timezone.
function toLocalDate(val, timeZone) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return toISODate(val);
  }
}

// Calendar date of a UTC timestamp shifted by a "(UTC+05:30)"-style offset.
function toOffsetDate(val, label = '') {
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  const m = label.match(/UTC([+-])(\d{2}):(\d{2})/);
  if (m) d.setUTCMinutes(d.getUTCMinutes() + (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])));
  return d.toISOString().split('T')[0];
}

// The LF calendar mixes "2026/12/06", "20261206", "2027/1/18", and month-only "2026/08".
function parseLooseDate(val) {
  const str = String(val || '').trim();
  const m = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/) || str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function decodeEntities(str = '') {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function cleanText(str = '') {
  return decodeEntities(str || '').replace(/\s+/g, ' ').trim();
}

function makeId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function urlKey(url) {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname
      .toLowerCase()
      .replace(/\/+$/, '')
      .replace(/\/(cfp|submit|submissions\/new)$/, '');
    return host + path;
  } catch {
    return url.trim().toLowerCase();
  }
}

function nameKey(name) {
  return name
    .toLowerCase()
    .replace(/(^|[^0-9])20\d\d(?![0-9])/g, '$1')
    .replace(/[^a-z0-9]+/g, '');
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function warn(message) {
  // Surfaces as an annotation in GitHub Actions; plain log line elsewhere.
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `Warning: ${message}`);
}

async function fetchDevelopersEvents() {
  console.log('Fetching from developers.events...');
  const data = await getJSON('https://developers.events/all-events.json');

  return data
    .filter((item) => item.cfp?.link && item.cfp?.untilDate && item.name)
    .map((item) => {
      const [start, end] = item.date || [];
      return {
        name: cleanText(item.name),
        cfpUrl: item.cfp.link,
        cfpClosingDate: toISODate(item.cfp.untilDate),
        eventStartDate: toISODate(start),
        eventEndDate: toISODate(end ?? start),
        eventUrl: item.hyperlink || '',
        // "Hamburg (Germany)" -> "Hamburg, Germany", to match the other sources.
        location: cleanText(item.location).replace(/^(.*?) \(([^)]*)\)/, '$1, $2'),
        country: item.country || '',
        virtual: VIRTUAL_RE.test(item.country || '') || VIRTUAL_RE.test(item.location || ''),
        tags: (item.tags || []).filter((t) => t.key !== 'language').map((t) => t.value),
        source: 'developers.events',
      };
    });
}

async function fetchLinuxFoundation() {
  console.log('Fetching from the Linux Foundation events calendar...');
  const data = await getJSON('https://events.linuxfoundation.org/wp-json/lfevents/v1/events?status=upcoming');

  return data
    .filter((item) => item.cfp_active && item.cta_speak_url && parseLooseDate(item.cfp_date_end))
    .map((item) => {
      const loc = item.location || {};
      const name = cleanText(item.name);
      const eventUrl = item.external_url || item.url || '';
      const classified = classifyOrganizer(name, eventUrl, item.cta_speak_url);
      return {
        name,
        cfpUrl: item.cta_speak_url,
        cfpClosingDate: parseLooseDate(item.cfp_date_end),
        eventStartDate: parseLooseDate(item.start_date),
        eventEndDate: parseLooseDate(item.end_date) || parseLooseDate(item.start_date),
        eventUrl,
        location: [loc.city, loc.country].filter(Boolean).join(', '),
        country: loc.country || '',
        virtual: Boolean(loc.virtual && !loc.city),
        organizer: classified.type === 'foundation' ? classified : { name: 'Linux Foundation', type: 'foundation' },
        tags: [],
        source: 'linuxfoundation',
      };
    });
}

async function fetchCallingAllPapers() {
  console.log('Fetching from CallingAllPapers...');
  const json = await getJSON('https://api.callingallpapers.com/v1/cfp');
  const data = json.cfps || json._embedded?.cfp || json;
  if (!Array.isArray(data)) throw new Error('unexpected response format');

  return data
    .filter((item) => item.name && item.dateCfpEnd && (item.uri || item.eventUri))
    .map((item) => {
      const tz = item.timezone || 'UTC';
      const location = cleanText(item.location);
      const name = cleanText(item.name);
      return {
        name,
        cfpUrl: item.uri || item.eventUri,
        cfpClosingDate: toLocalDate(item.dateCfpEnd, tz),
        eventStartDate: toLocalDate(item.dateEventStart, tz),
        eventEndDate: toLocalDate(item.dateEventEnd || item.dateEventStart, tz),
        eventUrl: item.eventUri || '',
        location,
        country: '',
        timezone: tz,
        virtual: VIRTUAL_RE.test(location) || (!location && /\b(virtual|online)\b/i.test(name)),
        tags: (item.tags || []).filter(Boolean),
        source: 'callingallpapers',
      };
    });
}

// Sessionize addresses are often full street addresses; keep "City, Country".
function shortenAddress(address, countryCode) {
  const parts = address
    .split(',')
    .map((p) => p.replace(/\b\d{4,6}\b/g, '').trim())
    .filter((p, i, all) => p && !/^tbd$/i.test(p) && p !== all[i - 1]);
  let country = '';
  if (countryCode) {
    try {
      country = new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode);
    } catch {}
  }
  if (country && parts.length && parts.at(-1).toLowerCase() === country.toLowerCase()) parts.pop();
  if (countryCode === 'US') {
    // "Seattle, Washington" -> "Seattle, WA, USA"
    const state = parts.length > 1 && US_STATE_CODES[parts.at(-1).toLowerCase()];
    if (state) parts.pop();
    return [parts.at(-1), state, 'USA'].filter(Boolean).join(', ');
  }
  const city = (parts.at(-1) || '').replace(/^the /i, '');
  if (city.toLowerCase() === country.toLowerCase()) return country;
  return [city, country].filter(Boolean).join(', ');
}

async function fetchOpenTechCFPs() {
  console.log('Fetching from OpenTechCFPs...');
  const json = await getJSON('https://1kevgriff.github.io/OpenTechCFPs/api/open.json');
  if (!Array.isArray(json.cfps)) throw new Error('unexpected response format');

  return json.cfps
    .filter((item) => item.name && item.url && item.cfp_close_utc)
    .map((item) => {
      const location = cleanText(item.location);
      const virtual = Boolean(item.online) && (!location || VIRTUAL_RE.test(location));
      return {
        name: cleanText(item.name),
        cfpUrl: item.url,
        cfpClosingDate: toOffsetDate(item.cfp_close_utc, item.cfp_timezone),
        eventStartDate: item.event_start || null,
        eventEndDate: item.event_end || item.event_start || null,
        eventUrl: item.website || '',
        location: virtual ? '' : shortenAddress(location, item.country),
        country: item.country || '',
        timezone: item.cfp_timezone || '',
        virtual,
        autoTags: item.tags || [],
        tags: [],
        source: 'opentechcfps',
      };
    });
}

// data/manual-cfps.json lists CFPs the aggregators miss or get wrong. Entries use
// the output fields (name, cfpUrl, cfpClosingDate, eventStartDate, eventEndDate,
// eventUrl, location, plus optional country, region, categories, organizer) and
// take precedence over every other source.
function loadManualCFPs() {
  if (!existsSync(MANUAL)) return [];
  const data = JSON.parse(readFileSync(MANUAL, 'utf8'));
  return data.map((item) => ({ tags: [], ...item, source: 'manual' }));
}

// Sources earlier in this list win when merged records disagree.
const SOURCE_PRIORITY = ['manual', 'linuxfoundation', 'developers.events', 'callingallpapers', 'opentechcfps'];
// developers.events is curated by hand and its deadlines drift; the other
// sources read the CFP platforms directly, so they win for closing dates.
const DEADLINE_PRIORITY = ['manual', 'linuxfoundation', 'opentechcfps', 'callingallpapers', 'developers.events'];
const MERGED_FIELDS = [
  'name', 'cfpUrl', 'cfpClosingDate', 'eventStartDate', 'eventEndDate', 'eventUrl',
  'location', 'country', 'timezone', 'region', 'categories', 'organizer',
];

function mergeRecords(records) {
  records.sort((a, b) => SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source));
  const merged = {};
  for (const field of MERGED_FIELDS) {
    const rec = records.find((r) => r[field] != null && r[field] !== '');
    if (rec) merged[field] = rec[field];
  }
  const byDeadlinePriority = [...records].sort(
    (a, b) => DEADLINE_PRIORITY.indexOf(a.source) - DEADLINE_PRIORITY.indexOf(b.source),
  );
  merged.cfpClosingDate = byDeadlinePriority[0].cfpClosingDate;
  // When both platform-fed sources agree on the city, trust them over the curated one.
  const cityOf = (r) => r?.location.split(',')[0].trim().toLowerCase();
  const cap = records.find((r) => r.source === 'callingallpapers' && r.location);
  const otc = records.find((r) => r.source === 'opentechcfps' && r.location);
  if (cap && otc && cityOf(cap) === cityOf(otc) && cityOf(cap) !== cityOf(merged)) {
    merged.location = otc.location;
    merged.country = otc.country;
  }
  // Only trust "virtual" from the record that also supplied the location.
  const locationRecord = records.find((r) => r.location) || records.find((r) => r.virtual);
  merged.virtual = Boolean(locationRecord?.virtual);
  merged.tags = [...new Set(records.flatMap((r) => r.tags || []).map((t) => t.toLowerCase()))];
  merged.autoTags = [...new Set(records.flatMap((r) => r.autoTags || []))];
  merged.classifyText = records.flatMap((r) => [r.name, r.eventUrl, r.cfpUrl]);
  merged.sources = [...new Set(records.map((r) => r.source))];
  return merged;
}

// Groups records that describe the same CFP, matching on CFP URL first,
// then on event name or event URL plus closing date.
function dedupe(records) {
  // Some organizers run several events through one CFP form (Apidays, BA & Beyond).
  // When a single source lists a URL under different names, the URL can't identify
  // an event, so those records are matched on name alone.
  const namesPerUrl = new Map();
  for (const r of records) {
    const key = `${r.source}|${urlKey(r.cfpUrl)}`;
    if (!namesPerUrl.has(key)) namesPerUrl.set(key, new Set());
    namesPerUrl.get(key).add(nameKey(r.name));
  }
  const sharedUrls = new Set(
    [...namesPerUrl].filter(([, names]) => names.size > 1).map(([key]) => key.split('|')[1]),
  );

  const parent = records.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => (parent[find(a)] = find(b));

  const index = new Map();
  const link = (key, i) => {
    if (index.has(key)) union(i, index.get(key));
    else index.set(key, i);
  };

  records.forEach((r, i) => {
    const cfpKey = urlKey(r.cfpUrl);
    if (sharedUrls.has(cfpKey)) link(`shared:${cfpKey}:${nameKey(r.name)}`, i);
    else link('cfp:' + cfpKey, i);
    link(`name:${nameKey(r.name)}:${r.cfpClosingDate}`, i);
    const eventKey = r.eventUrl && urlKey(r.eventUrl);
    // Bare domains (e.g. a foundation homepage) can host several events.
    if (eventKey && eventKey.includes('/')) link(`event:${eventKey}:${r.cfpClosingDate}`, i);
  });

  const groups = new Map();
  records.forEach((r, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  });
  return [...groups.values()].map(mergeRecords);
}

// "Singapore, Singapore" -> "Singapore"
function tidyLocation(location = '') {
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) return parts[0];
  return parts.join(', ');
}

function deriveRegion(cfp) {
  if (cfp.virtual) return 'Virtual';
  const lastSegment = (cfp.location || '')
    .split(/[,(]/)
    .pop()
    .replace(/[)]/g, '')
    .replace(/\s*&\s*online$/i, '')
    .trim();
  return (
    regionForCountry(cfp.country) ||
    regionForCountry(lastSegment) ||
    (US_STATES.has(lastSegment.toUpperCase()) ? 'North America' : '') ||
    regionForTimezone(cfp.timezone)
  );
}

async function main() {
  const today = new Date().toISOString().split('T')[0];
  const maxClosingDate = addDays(today, MAX_CFP_DAYS_AHEAD);
  console.log(`Fetching CFPs (today: ${today})...\n`);

  const sources = [
    ['developers.events', fetchDevelopersEvents],
    ['linuxfoundation', fetchLinuxFoundation],
    ['callingallpapers', fetchCallingAllPapers],
    ['opentechcfps', fetchOpenTechCFPs],
  ];
  const results = await Promise.all(
    sources.map(async ([name, fetcher]) => {
      try {
        return await fetcher();
      } catch (err) {
        warn(`${name} failed: ${err.message}`);
        return [];
      }
    }),
  );
  const manual = loadManualCFPs();

  const counts = sources.map(([name], i) => `${name}=${results[i].length}`).join(', ');
  console.log(`\nResults: ${counts}, manual=${manual.length}`);

  const minClosingDate = addDays(today, -CLOSED_GRACE_DAYS);
  const candidates = [...manual, ...results.flat()].filter(
    (c) =>
      c.name &&
      c.cfpUrl &&
      c.cfpClosingDate &&
      c.cfpClosingDate >= minClosingDate &&
      c.cfpClosingDate <= maxClosingDate &&
      !DEAD_HOSTS.has(urlKey(c.cfpUrl).split('/')[0]),
  );
  const merged = dedupe(candidates)
    .filter((c) => c.cfpClosingDate >= today && (!c.eventEndDate || c.eventEndDate >= today))
    .map((c) => ({ ...c, meetup: isMeetup(c, today) }))
    .filter((c) => !c.meetup || c.sources.includes('manual') || isActiveMeetupCall(c, today));

  const usedIds = new Set();
  const cfps = merged
    .map((c) => {
      let id = makeId(c.name) || makeId(urlKey(c.cfpUrl));
      if (usedIds.has(id)) id = `${id}-${c.cfpClosingDate}`;
      usedIds.add(id);
      const organizer = c.organizer || classifyOrganizer(...c.classifyText);
      return {
        id,
        name: c.name,
        cfpUrl: c.cfpUrl,
        cfpClosingDate: c.cfpClosingDate,
        eventStartDate: c.eventStartDate || null,
        eventEndDate: c.eventEndDate || c.eventStartDate || null,
        eventUrl: c.eventUrl || '',
        location: c.virtual ? 'Virtual' : tidyLocation(c.location),
        region: c.region || deriveRegion(c) || 'Unknown',
        categories: c.categories || classifyCategories(c.name, c.tags, c.autoTags, c.meetup),
        organizer: { name: organizer.name, type: organizer.type, parents: organizerParents(organizer.name) },
        sources: c.sources,
      };
    })
    .sort((a, b) => a.cfpClosingDate.localeCompare(b.cfpClosingDate) || a.name.localeCompare(b.name));

  if (existsSync(OUTPUT)) {
    const previous = JSON.parse(readFileSync(OUTPUT, 'utf8')).cfps?.length || 0;
    if (cfps.length < previous * MIN_RETAINED_RATIO) {
      console.error(`Only ${cfps.length} CFPs found (previously ${previous}); refusing to overwrite ${OUTPUT}.`);
      process.exit(1);
    }
  }

  const output = {
    lastUpdated: today,
    cfps,
  };

  writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nWrote ${cfps.length} open CFPs to ${OUTPUT}`);
}

main();
