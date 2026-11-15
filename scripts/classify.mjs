// Rules that derive region, categories, and organizer for a CFP.
// Rules are ordered: earlier entries win when only one value is kept.

const REGION_BY_COUNTRY = {
  'North America': ['usa', 'us', 'u.s.a.', 'united states', 'united states of america', 'canada'],
  'Latin America': [
    'mexico', 'guatemala', 'honduras', 'el salvador', 'nicaragua', 'costa rica', 'panama', 'cuba',
    'dominican republic', 'puerto rico', 'jamaica', 'colombia', 'venezuela', 'ecuador', 'peru',
    'bolivia', 'chile', 'argentina', 'uruguay', 'paraguay', 'brazil',
  ],
  Europe: [
    'uk', 'u.k.', 'united kingdom', 'england', 'scotland', 'wales', 'northern ireland', 'ireland',
    'france', 'germany', 'netherlands', 'the netherlands', 'belgium', 'luxembourg', 'switzerland',
    'austria', 'italy', 'spain', 'portugal', 'denmark', 'norway', 'sweden', 'finland', 'iceland',
    'estonia', 'latvia', 'lithuania', 'poland', 'czechia', 'czech republic', 'slovakia', 'hungary',
    'romania', 'bulgaria', 'greece', 'croatia', 'slovenia', 'serbia', 'bosnia and herzegovina',
    'montenegro', 'north macedonia', 'albania', 'kosovo', 'ukraine', 'moldova', 'malta', 'cyprus',
    'turkey', 'türkiye', 'georgia', 'armenia',
  ],
  'Asia-Pacific': [
    'india', 'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'china', 'hong kong', 'taiwan', 'japan',
    'south korea', 'korea', 'singapore', 'malaysia', 'indonesia', 'philippines', 'thailand',
    'vietnam', 'cambodia', 'australia', 'new zealand', 'kazakhstan', 'uzbekistan', 'mongolia',
  ],
  'Middle East & Africa': [
    'uae', 'united arab emirates', 'saudi arabia', 'qatar', 'bahrain', 'kuwait', 'oman', 'israel',
    'jordan', 'lebanon', 'egypt', 'morocco', 'tunisia', 'algeria', 'nigeria', 'ghana', 'kenya',
    'uganda', 'rwanda', 'burundi', 'tanzania', 'ethiopia', 'south africa', 'benin', 'gabon',
    'cameroon', 'senegal', 'ivory coast', "côte d'ivoire", 'zimbabwe', 'zambia', 'angola',
    'mozambique', 'botswana', 'namibia', 'iran', 'iraq',
  ],
};

const COUNTRY_TO_REGION = new Map(
  Object.entries(REGION_BY_COUNTRY).flatMap(([region, countries]) => countries.map((c) => [c, region])),
);

// Some sources give only a city. Covers the usual conference hubs.
const CITY_TO_COUNTRY = {
  amsterdam: 'netherlands', athens: 'greece', barcelona: 'spain', berlin: 'germany', bratislava: 'slovakia',
  brussels: 'belgium', bucharest: 'romania', budapest: 'hungary', copenhagen: 'denmark', dublin: 'ireland',
  edinburgh: 'uk', frankfurt: 'germany', hamburg: 'germany', helsinki: 'finland', istanbul: 'turkey',
  kraków: 'poland', krakow: 'poland', lisbon: 'portugal', london: 'uk', lyon: 'france', madrid: 'spain',
  manchester: 'uk', milan: 'italy', munich: 'germany', oslo: 'norway', paris: 'france', prague: 'czechia',
  riga: 'latvia', rome: 'italy', sofia: 'bulgaria', stockholm: 'sweden', tallinn: 'estonia', utrecht: 'netherlands',
  valencia: 'spain', vienna: 'austria', vilnius: 'lithuania', warsaw: 'poland', wrocław: 'poland', zagreb: 'croatia',
  zurich: 'switzerland', bengaluru: 'india', bangalore: 'india', mumbai: 'india', 'new delhi': 'india',
  hyderabad: 'india', pune: 'india', chennai: 'india', tokyo: 'japan', seoul: 'south korea', taipei: 'taiwan',
  'kuala lumpur': 'malaysia', jakarta: 'indonesia', manila: 'philippines', bangkok: 'thailand', sydney: 'australia',
  melbourne: 'australia', auckland: 'new zealand', dubai: 'uae', 'tel aviv': 'israel', cairo: 'egypt',
  lagos: 'nigeria', nairobi: 'kenya', 'cape town': 'south africa', johannesburg: 'south africa',
  'são paulo': 'brazil', 'sao paulo': 'brazil', 'buenos aires': 'argentina', bogotá: 'colombia',
  bogota: 'colombia', 'mexico city': 'mexico', toronto: 'canada', montreal: 'canada', montréal: 'canada',
  vancouver: 'canada', 'new york': 'usa', 'new york city': 'usa', 'san francisco': 'usa', seattle: 'usa',
  austin: 'usa', chicago: 'usa', boston: 'usa',
};

const LATAM_TIMEZONES =
  /^America\/(Mexico_City|Tijuana|Monterrey|Cancun|Merida|Guatemala|Tegucigalpa|El_Salvador|Managua|Costa_Rica|Panama|Havana|Santo_Domingo|Puerto_Rico|Jamaica|Bogota|Caracas|Guayaquil|Lima|La_Paz|Santiago|Argentina\/.*|Buenos_Aires|Montevideo|Asuncion|Sao_Paulo|Fortaleza|Recife|Bahia|Manaus|Belem)$/;
const MIDDLE_EAST_TIMEZONES = /^Asia\/(Dubai|Riyadh|Qatar|Bahrain|Kuwait|Muscat|Jerusalem|Tel_Aviv|Amman|Beirut|Baghdad|Tehran)$/;

// Windows timezone names, as used by Sessionize. Order matters: "Central America"
// and "Central Europe" must be checked before the North American "Central".
const WINDOWS_TIMEZONE_REGIONS = [
  ['Latin America', /^(Central America|Central Brazilian|Mexico|Pacific SA|SA (Pacific|Eastern|Western)|E\. South America|Argentina|Montevideo|Paraguay|Venezuela|Bahia|Cuba|Tocantins|Magallanes)\b/],
  ['Europe', /^(GMT|Greenwich|W\. Europe|Central Europe|Central European|Romance|E\. Europe|FLE|GTB|Turkey|Russian|Kaliningrad|Belarus)\b/],
  ['Middle East & Africa', /^(Morocco|W\. Central Africa|South Africa|E\. Africa|Egypt|Libya|Namibia|Sudan|Israel|Jordan|Arab|Arabic|Arabian|Iran|Syria|Middle East)\b/],
  ['Asia-Pacific', /^(India|Sri Lanka|Nepal|Pakistan|Bangladesh|Myanmar|SE Asia|China|Singapore|Taipei|Tokyo|Korea|W\. Australia|AUS|Cen\. Australia|E\. Australia|Tasmania|New Zealand|West Asia|Central Asia)\b/],
  ['North America', /^(Pacific|Mountain|US Mountain|Central|Canada Central|Eastern|US Eastern|Atlantic|Newfoundland|Alaskan|Hawaiian)\b/],
];

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

// Accepts a country name or an ISO 3166 alpha-2 code.
export function regionForCountry(country) {
  if (!country) return '';
  let key = country.trim().toLowerCase();
  if (key === 'online' || key === 'virtual') return 'Virtual';
  if (/^[a-z]{2}$/.test(key) && !COUNTRY_TO_REGION.has(key)) {
    try {
      key = countryNames.of(key.toUpperCase()).toLowerCase();
    } catch {
      return '';
    }
  }
  return COUNTRY_TO_REGION.get(key) || COUNTRY_TO_REGION.get(CITY_TO_COUNTRY[key]) || '';
}

// Fallback for sources that give a timezone but no usable country.
export function regionForTimezone(tz) {
  if (!tz) return '';
  if (LATAM_TIMEZONES.test(tz)) return 'Latin America';
  if (MIDDLE_EAST_TIMEZONES.test(tz)) return 'Middle East & Africa';
  if (tz.startsWith('America/')) return 'North America';
  if (tz.startsWith('Europe/')) return 'Europe';
  if (tz.startsWith('Africa/')) return 'Middle East & Africa';
  if (/^(Asia|Australia|Pacific)\//.test(tz)) return 'Asia-Pacific';
  const windowsRule = WINDOWS_TIMEZONE_REGIONS.find(([, re]) => re.test(tz));
  return windowsRule ? windowsRule[0] : '';
}

// Matched against the event name plus source tags, with dashes turned into spaces.
// An event can belong to several categories.
const CATEGORY_RULES = [
  ['AI & ML', /\b(ai|ml|mlops|llms?|genai|artificial intelligence|machine learning|deep learning|agents?|agentic|mcp|copilot|openai|pytorch|nlp|autoresearch)\b/i],
  ['Cloud Native & DevOps', /\b(kubernetes|k8s|containers?|containerdays|cloud native|kubecon|cloudnativecon|kcd|cncf|devops|devopsdays|sre|platform engineering|platmosphere|observability|monitoring|ebpf|gitops|ci cd|infrastructure|serverless|terraform|opentofu|cloud|aws|gcp|grafana)\b/i],
  ['Data & Databases', /\b(data|databases?|sql|sqlcon|postgres(ql)?|pg|mysql|mariadb|mongodb|analytics|big data|data science|data engineering|power bi|fabric|fabcon|iceberg|kafka|debezium|neo4j|graph databases?|datagrillen|dataminds|datatune|percona|seaql)\b/i],
  ['Security', /\b(security|cyber\w*|bsides\w*|owasp|appsec|devsecops|infosec|hacking|offensive\w*|pentest\w*|ctf|privacy|\w*seccon|secretcon|cyphercon|milan0day)\b/i],
  ['Open Source & Linux', /\b(open ?source|opensource|foss\w*|free software|linux\w*|fosdem|ow2(con)?|openembedded|yocto|gnome|kde|debian|ubuntu|fedora|opensuse|open community|openvt|nix|nixos|planetnix)\b/i],
  ['Programming Languages', /(\b(python|pycon|pyday|pydata|django|java|jvm|devjvm|jprime|jnation|devoxx|kotlin|kotlinconf|scala|clojure|groovy|spring ?one|spring i\/o|go|golang|gopher\w*|rust|rustconf|rustweek|ruby|rubyconf|rails|elixir\w*|erlang|php|phpday|symfony|laravel|dotnet|cpp|haskell|julia|swift|dart|zig)\b|\b(c#|f#|c\+\+)|\.net\b)/i],
  ['Web & Mobile', /\b(web|frontend|front end|javascript|js|jsnation|halfstack|typescript|node ?js|react|angular|vue|svelte|next\.?js|css|html|ux|accessibility|a11y|android|ios|mobile|flutter|graphql|api|apidays|drupal|wordpress|cms|craft cms)\b/i],
  ['Microsoft Ecosystem', /(\b(microsoft|azure|azureday|power ?platform|power ?apps|power ?automate|power bi|dynamics\w*|m365|microsoft 365|sharepoint|copilot|fabcon|euctech|experts live|low code)\b|\.net conf)/i],
  ['Software Engineering', /\b(software (engineering|architecture|craft(smanship)?)|architecture|domain driven design|ddd|testing|test|qa|quality|performance|developer experience|dx|dxday|documentation|craft conference)\b/i],
  ['Agile & Leadership', /\b(agile|scrum|kanban|lean|product|leadership|management|ba & beyond|business analysis|career|women in (tech|engineering)|women and leadership|adaptive organizations)\b/i],
];

// Broad developer conferences that fit no specific category.
const GENERAL_RULE = /\b(dev\w*|code\w*|coding|tech\w*|hack\w*|software|developers?|programming|engineering|general|it)\b/i;

function matchCategories(values) {
  const text = values.join(' ; ').replace(/[-_]/g, ' ');
  return CATEGORY_RULES.filter(([, re]) => re.test(text)).map(([category]) => category);
}

const MEETUP_RE =
  /\b(meetups?|meet-ups?|user ?groups?|users group|monthly|weekly|meetings?|chapter|series|podcast|techcasts|lunch and learn|call for (presenters|sessions)|community events|reunión mensual|avondsessies)\b|\w(jug|pug|hug)\b/i;
const MAX_EVENT_DAYS = 14;

const days = (from, to) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

// Calls for a recurring series (meetups, user groups, podcasts) rather than a
// single event: the name says so, there's no fixed date, the dates span weeks,
// or the series is already under way.
export function isMeetup({ name, eventStartDate, eventEndDate }, today) {
  if (/\b(annual|member|members|general) meeting\b/i.test(name)) return false;
  if (MEETUP_RE.test(name) || !eventStartDate || eventStartDate < today) return true;
  return days(eventStartDate, eventEndDate || eventStartDate) > MAX_EVENT_DAYS;
}

// Of the meetup calls, only those for one dated upcoming session are kept. Standing
// "speak at our group sometime" calls have no date, span months, stay open until or
// past the session they list (often a placeholder like Dec 31 for both), or name a
// session far beyond the deadline.
const MAX_MEETUP_LEAD_DAYS = 60;

export function isActiveMeetupCall({ name, eventStartDate, eventEndDate, cfpClosingDate }, today) {
  if (/\b(ongoing|open call|any ?time|rolling)\b/i.test(name)) return false;
  if (!eventStartDate || eventStartDate < today) return false;
  if (days(eventStartDate, eventEndDate || eventStartDate) > MAX_EVENT_DAYS) return false;
  const lead = days(cfpClosingDate, eventStartDate);
  return lead >= 1 && lead <= MAX_MEETUP_LEAD_DAYS;
}

// `tags` are curated by humans; `autoTags` are keyword-extracted and noisy,
// so they only count when nothing else matched.
export function classifyCategories(name, tags = [], autoTags = [], meetup = false) {
  let categories = matchCategories([name, ...tags]);
  if (!categories.length) categories = matchCategories(autoTags).slice(0, 2);
  if (meetup) return ['Meetups', ...categories];
  if (categories.length) return categories;
  return [GENERAL_RULE.test([name, ...tags].join(' ')) ? 'General Developer' : 'Other'];
}

// Matched against the event name, event URL, and CFP URL. First match wins.
const ORGANIZER_RULES = [
  // KCDs and CNCF community groups are run by local volunteers, not the foundation.
  { name: 'CNCF Community', type: 'community', parent: 'CNCF', re: /\b(kcd|kubernetes community days?)\b|community\.cncf\.io|ocgroups\.dev\/cncf/i },
  { name: 'CNCF', type: 'foundation', parent: 'Linux Foundation', re: /\b(kubecon|cloudnativecon|cncf|kubeday)\b|events\.linuxfoundation\.org\/kubecon|cncf\.io/i },
  { name: 'PyTorch Foundation', type: 'foundation', parent: 'Linux Foundation', re: /\bpytorch (conference|day)\b/i },
  { name: 'Agentic AI Foundation', type: 'foundation', parent: 'Linux Foundation', re: /\b(agntcon|agntsummit|mcpcon|mcp dev summit|aaif|agentic ai foundation)\b/i },
  { name: 'OpenSSF', type: 'foundation', parent: 'Linux Foundation', re: /\b(openssf|open source securitycon)\b/i },
  { name: 'Linux Foundation', type: 'foundation', re: /linuxfoundation\.org|lfopensource\.cn|\b(open source summit|lf energy|hpsf conference|openinfra|finos|open source finance forum|automotive grade linux|automotive linux summit|embedded linux conference|opensearchcon|aswf)\b/i },
  { name: 'OWASP Foundation', type: 'foundation', re: /\bowasp\b/i },
  { name: 'Eclipse Foundation', type: 'foundation', re: /\beclipse(con)?\b|ocxconf\.org|\bopen community experience\b/i },
  { name: 'Apache Software Foundation', type: 'foundation', re: /\bapachecon\b|\bcommunity over code\b|apache\.org/i },
  { name: 'OpenJS Foundation', type: 'foundation', re: /\bopenjs\b/i },
  { name: 'Python Software Foundation', type: 'foundation', re: /us\.pycon\.org|\bpycon us\b/i },
  { name: 'NumFOCUS', type: 'foundation', re: /\bpydata\b|numfocus/i },
  { name: 'OW2', type: 'foundation', re: /\bow2(con)?\b|ow2con\.org/i },
  { name: 'Rust Foundation', type: 'foundation', re: /\brustconf\b/i },
  { name: 'GNOME Foundation', type: 'foundation', re: /\bguadec\b/i },
  { name: 'KDE e.V.', type: 'foundation', re: /\bakademy\b/i },
  { name: 'Drupal Association', type: 'foundation', re: /\bdrupalcon\b/i },
  { name: 'WordPress Foundation', type: 'foundation', re: /\bwordcamp\b/i },
  { name: 'Free Software Foundation', type: 'foundation', re: /\blibreplanet\b/i },
  { name: 'RISC-V International', type: 'foundation', re: /\brisc-?v summit\b/i },
  { name: 'Google Developer Groups', type: 'community', re: /\b(devfest|gdg|i\/o extended)\b/i },
  { name: 'AWS Community', type: 'community', re: /\baws (student )?community day\b/i },
  { name: 'Microsoft Community', type: 'community', re: /\.net conf\b|\bglobal (power platform|ai|azure|security)\b.*\bbootcamp\b|\b(m365|microsoft) community days?\b|\bglobal ai (nights|community)\b/i },
  { name: 'Security BSides', type: 'community', re: /\bbsides/i },
  { name: 'DevOpsDays', type: 'community', re: /\bdevopsdays\b/i },
  { name: 'Data Saturdays', type: 'community', re: /\b(data|sql) saturday\b/i },
  { name: 'Grafana Labs', type: 'vendor', re: /\bgrafanacon\b/i },
  { name: 'Elastic', type: 'vendor', re: /\belastic\{?on\}?|elastic\.co\b/i },
  { name: 'Temporal', type: 'vendor', re: /replay\.temporal\.io/i },
  { name: 'Percona', type: 'vendor', re: /\bpercona live\b/i },
  { name: 'Civo', type: 'vendor', re: /\bcivo navigate\b/i },
  { name: 'Planview', type: 'vendor', re: /\bplanview connect\b/i },
  { name: 'JetBrains', type: 'vendor', re: /\bkotlinconf\b/i },
  { name: 'HashiCorp', type: 'vendor', re: /\bhashiconf\b/i },
  { name: 'Docker', type: 'vendor', re: /\bdockercon\b/i },
  { name: 'GitHub', type: 'vendor', re: /\bgithub universe\b/i },
  { name: 'Neo4j', type: 'vendor', re: /\bnodes ai\b|neo4j\.com/i },
  { name: 'SUSE', type: 'vendor', re: /\bsusecon\b/i },
];

export function classifyOrganizer(name, ...urls) {
  const text = [name, ...urls].join(' ');
  const rule = ORGANIZER_RULES.find(({ re }) => re.test(text));
  if (!rule) return { name: '', type: 'independent' };
  return { name: rule.name, type: rule.type };
}

// Umbrella organizations above an organizer, nearest first: CNCF -> ['Linux Foundation'].
export function organizerParents(name) {
  const parents = [];
  let parent = ORGANIZER_RULES.find((r) => r.name === name)?.parent;
  while (parent) {
    parents.push(parent);
    parent = ORGANIZER_RULES.find((r) => r.name === parent)?.parent;
  }
  return parents;
}
