import type { SourceConfig } from '../types';

export const config: SourceConfig = {
  slug: 'la-county-dpw',
  agencyName: 'Los Angeles County Department of Public Works',
  shortName: 'LA County DPW',
  entityType: 'county',
  county: 'Los Angeles',
  city: null,
  region: 'Southern California',
  priorityTier: 2,
  portalFamily: 'html_table',
  connector: {
    listingUrl:        'https://dpw.lacounty.gov/contracts/Opportunities.aspx',
    baseUrl:           'https://dpw.lacounty.gov',
    // Column 0 is a hidden `display:none` duplicate title cell with no link
    // (used by the site for sorting/accessibility). The real detail link,
    // description, and BidExpress link all live in column 1.
    titleColIndex:     1,
    openDateColIndex:  2,
    closeDateColIndex: 3,
    tableSelector:     'table',
    skipHeaderRows:    1,
    dateFormat:        'M/D/YYYY',
    // Documents require vendor registration at OpportunitiesNewRegister.aspx.
    login_required_for_docs: true,
  },
  rateLimitDelayMs: 3000,
};
