export interface Organizer {
  name: string;
  type: 'foundation' | 'community' | 'vendor' | 'independent';
  parents: string[];
}

export interface CFP {
  id: string;
  name: string;
  cfpUrl: string;
  cfpClosingDate: string;
  eventStartDate: string | null;
  eventEndDate: string | null;
  eventUrl: string;
  location: string;
  region: string;
  categories: string[];
  organizer: Organizer;
  sources: string[];
}

export const REGIONS = [
  'North America',
  'Latin America',
  'Europe',
  'Middle East & Africa',
  'Asia-Pacific',
  'Virtual',
  'Unknown',
];

export const ORGANIZER_TYPES: Record<Organizer['type'], string> = {
  foundation: 'Any foundation',
  community: 'Any community program',
  vendor: 'Any company',
  independent: 'Independent',
};
