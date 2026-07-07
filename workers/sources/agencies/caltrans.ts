import type { SourceConfig } from '../types';

export const config: SourceConfig = {
  slug: 'caltrans',
  agencyName: 'California Department of Transportation',
  shortName: 'Caltrans',
  entityType: 'transportation_agency',

  county: null,
  city: null,
  region: 'Statewide',

  priorityTier: 1,
  portalFamily: 'caleprocure',

  connector: {
    listingUrl: 'https://ccop.dot.ca.gov/allProjects',
    baseUrl: 'https://ccop.dot.ca.gov',
  },

  rateLimitDelayMs: 2000,
};
