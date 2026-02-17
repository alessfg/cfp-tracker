import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '..', 'data', 'cfps.json');

function toISODate(val) {
  if (!val) return null;
  // Handle unix timestamps in ms
  if (typeof val === 'number') {
    return new Date(val).toISOString().split('T')[0];
  }
  // Handle date strings
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

function makeId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function fetchDevelopersEvents() {
  console.log('Fetching from developers.events...');
  try {
    const res = await fetch('https://developers.events/all-cfps.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    return data
      .filter((item) => item.link && item.untilDate && item.conf?.name)
      .map((item) => ({
        id: makeId(item.conf.name),
        name: item.conf.name,
        cfpUrl: item.link,
        cfpClosingDate: toISODate(item.untilDate),
        eventUrl: item.conf.hyperlink || '',
        location: item.conf.location || '',
        tags: [],
        source: 'developers.events',
      }))
      .filter((c) => c.cfpClosingDate);
  } catch (err) {
    console.error('developers.events failed:', err.message);
    return [];
  }
}

async function fetchConferenceData() {
  console.log('Fetching from conference-data...');
  const results = [];
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];

  for (const year of years) {
    try {
      const url = `https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/${year}/opensource.json`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();

      for (const conf of data) {
        if (!conf.cfpUrl || !conf.cfpEndDate) continue;
        const location = [conf.city, conf.country].filter(Boolean).join(', ');
        results.push({
          id: makeId(conf.name),
          name: conf.name,
          cfpUrl: conf.cfpUrl,
          cfpClosingDate: toISODate(conf.cfpEndDate),
          eventUrl: conf.url || '',
          location,
          tags: [],
          source: 'conference-data',
        });
      }
    } catch (err) {
      console.error(`conference-data ${year} failed:`, err.message);
    }
  }
  return results.filter((c) => c.cfpClosingDate);
}

async function fetchCallingAllPapers() {
  console.log('Fetching from CallingAllPapers...');
  try {
    const res = await fetch('https://api.callingallpapers.com/v1/cfp');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data = json._embedded?.cfp || json.cfps || json || [];

    if (!Array.isArray(data)) {
      console.error('CallingAllPapers: unexpected response format');
      return [];
    }

    return data
      .filter((item) => item.name && item.dateCfpEnd)
      .map((item) => ({
        id: makeId(item.name),
        name: item.name,
        cfpUrl: item.uri || item.eventUri || '',
        cfpClosingDate: toISODate(item.dateCfpEnd),
        eventUrl: item.eventUri || '',
        location: item.location || '',
        tags: item.tags || [],
        source: 'callingallpapers',
      }))
      .filter((c) => c.cfpClosingDate && c.cfpUrl);
  } catch (err) {
    console.error('CallingAllPapers failed:', err.message);
    return [];
  }
}

async function main() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`Fetching CFPs (today: ${today})...\n`);

  const [devEvents, confData, capData] = await Promise.all([
    fetchDevelopersEvents(),
    fetchConferenceData(),
    fetchCallingAllPapers(),
  ]);

  console.log(`\nResults: developers.events=${devEvents.length}, conference-data=${confData.length}, callingallpapers=${capData.length}`);

  // Merge all
  const all = [...devEvents, ...confData, ...capData];

  // Deduplicate by cfpUrl
  const seen = new Map();
  for (const cfp of all) {
    const key = cfp.cfpUrl.toLowerCase().replace(/\/+$/, '');
    if (!seen.has(key)) {
      seen.set(key, cfp);
    }
  }

  // Filter expired and sort by closing date
  const cfps = [...seen.values()]
    .filter((c) => c.cfpClosingDate >= today)
    .sort((a, b) => a.cfpClosingDate.localeCompare(b.cfpClosingDate));

  const output = {
    lastUpdated: today,
    cfps,
  };

  writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nWrote ${cfps.length} open CFPs to ${OUTPUT}`);
}

main();
