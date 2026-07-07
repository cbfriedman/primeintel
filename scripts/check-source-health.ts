/**
 * Validates a source connector before flipping scraper_status to 'active'.
 *
 * Run with: npx tsx scripts/check-source-health.ts [slug]
 *
 * Default slug: la-county-dpw
 * Pass --save to also write projects to the database (step 3 + 4).
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { loadEnvLocal } from '../workers/scraper/env';
import { HtmlTableConnector } from '../workers/sources/families/html-table/adapter';
import { saveRawProjects } from '../workers/sources/save-raw-projects';
import { config as laCountyDpwConfig } from '../workers/sources/agencies/la-county-dpw';
import type { SourceConfig } from '../workers/sources/types';

loadEnvLocal();

// ---------------------------------------------------------------------------
// Config map — add new sources here as they're built
// ---------------------------------------------------------------------------

const SOURCES: Record<string, SourceConfig> = {
  'la-county-dpw': laCountyDpwConfig,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

let failures = 0;

function pass(msg: string) {
  console.log(`${GREEN}  ✓${RESET} ${msg}`);
}

function fail(msg: string) {
  console.log(`${RED}  ✗ FAIL:${RESET} ${msg}`);
  failures++;
}

function warn(msg: string) {
  console.log(`${YELLOW}  ⚠ warn:${RESET} ${msg}`);
}

function section(title: string) {
  console.log(`\n${DIM}─── ${title} ───${RESET}`);
}

function assert(condition: boolean, passMsg: string, failMsg: string) {
  if (condition) pass(passMsg);
  else fail(failMsg);
}

// ---------------------------------------------------------------------------
// Validation steps
// ---------------------------------------------------------------------------

async function step1_healthCheck(connector: HtmlTableConnector) {
  section('Step 1 — Health check (live fetch)');

  let health;
  try {
    health = await connector.checkHealth();
  } catch (err) {
    fail(`checkHealth() threw: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  console.log(`     Raw result: ${JSON.stringify(health)}`);

  assert(health.ok, 'ok: true', `ok: false — ${health.errorMessage}`);
  assert(health.projectCount > 0, `projectCount: ${health.projectCount}`, 'projectCount is 0 — no rows parsed');
  assert(health.projectCount < 500, `projectCount ${health.projectCount} is plausible`, `projectCount ${health.projectCount} suspiciously high — check tableSelector/skipHeaderRows`);
  assert(health.errorMessage === null, 'no error message', `errorMessage: ${health.errorMessage}`);
}

async function step2_discoverProjects(connector: HtmlTableConnector) {
  section('Step 2 — discoverProjects (field validation)');

  let projects;
  try {
    const result = await connector.discoverProjects();
    projects = result.projects;
  } catch (err) {
    fail(`discoverProjects() threw: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  assert(projects.length > 0, `Found ${projects.length} project(s)`, 'Found 0 projects');

  // Field checks across all rows
  const missingTitle    = projects.filter(p => !p.title || p.title.trim() === '').length;
  const missingUrl      = projects.filter(p => !p.sourceUrl || p.sourceUrl === connector.config.connector['listingUrl']).length;
  const malformedDates  = projects.filter(p => {
    const check = (d: string | null) => d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d);
    return check(p.bidDate) || check(p.advertiseDate);
  }).length;
  const wrongAgency     = projects.filter(p => p.agency !== connector.config.agencyName).length;
  const wrongSlug       = projects.filter(p => p.sourceSlug !== connector.config.slug).length;
  const nullDates       = projects.filter(p => p.bidDate === null).length;

  assert(missingTitle === 0,   'All rows have a title',       `${missingTitle} row(s) have empty title`);
  assert(missingUrl === 0,     'All rows have a detail URL',  `${missingUrl} row(s) fell back to listingUrl`);
  assert(malformedDates === 0, 'All dates are ISO YYYY-MM-DD or null', `${malformedDates} row(s) have malformed dates`);
  assert(wrongAgency === 0,    'All rows have correct agency', `${wrongAgency} row(s) have wrong agency`);
  assert(wrongSlug === 0,      'All rows have correct sourceSlug', `${wrongSlug} row(s) have wrong sourceSlug`);

  if (nullDates > 0) {
    warn(`${nullDates}/${projects.length} row(s) have null bidDate — expected for some portals`);
  }

  // Print first 3 for visual inspection
  console.log(`\n  ${DIM}First 3 projects:${RESET}`);
  for (const p of projects.slice(0, 3)) {
    console.log(`    ${p.title.slice(0, 60)}`);
    console.log(`      url:       ${p.sourceUrl}`);
    console.log(`      sourceId:  ${p.sourceId ?? 'null'}`);
    console.log(`      bidDate:   ${p.bidDate ?? 'null'}`);
    console.log(`      advDate:   ${p.advertiseDate ?? 'null'}`);
  }

  return projects;
}

async function step3_saveToDb(slug: string, projects: Awaited<ReturnType<typeof step2_discoverProjects>>) {
  if (!projects) return;

  section('Step 3 — saveRawProjects (write to DB)');
  console.log(`  ${DIM}Saving ${projects.length} project(s) as source '${slug}'...${RESET}`);

  let result;
  try {
    result = await saveRawProjects(slug, projects);
  } catch (err) {
    fail(`saveRawProjects() threw: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  assert(result.errors.length === 0, 'No DB errors', `${result.errors.length} DB error(s): ${result.errors[0] ?? ''}`);
  pass(`New: ${result.projects_new}, Updated: ${result.projects_updated}`);

  if (result.projects_new === 0 && result.projects_updated === 0) {
    warn('Both new and updated are 0 — either no projects parsed or all failed');
  }

  section('Step 4 — Idempotency (re-save same data)');
  console.log(`  ${DIM}Re-saving to test dedup...${RESET}`);

  let result2;
  try {
    result2 = await saveRawProjects(slug, projects);
  } catch (err) {
    fail(`Second saveRawProjects() threw: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  assert(result2.projects_new === 0,
    'Second run created 0 new rows (no duplicates)',
    `Second run created ${result2.projects_new} new row(s) — dedup is broken`
  );
  assert(result2.projects_updated === result.projects_new + result.projects_updated,
    `Second run updated ${result2.projects_updated} row(s) (all rows touched)`,
    `Second run updated ${result2.projects_updated}, expected ${result.projects_new + result.projects_updated}`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find(a => !a.startsWith('--')) ?? 'la-county-dpw';
  const save = args.includes('--save');

  const sourceConfig = SOURCES[slug];
  if (!sourceConfig) {
    console.error(`Unknown slug '${slug}'. Available: ${Object.keys(SOURCES).join(', ')}`);
    process.exit(1);
  }

  console.log(`\nValidating source: ${sourceConfig.agencyName} (${slug})`);
  console.log(`Portal: ${sourceConfig.portalFamily}`);
  console.log(`Save to DB: ${save ? 'YES (--save flag)' : 'NO (dry run)'}`);

  const connector = new HtmlTableConnector(sourceConfig);

  await step1_healthCheck(connector);
  const projects = await step2_discoverProjects(connector);

  if (save) {
    await step3_saveToDb(slug, projects);
  } else {
    console.log(`\n  ${DIM}Skipping DB write. Pass --save to run steps 3 & 4.${RESET}`);
  }

  console.log(`\n${'─'.repeat(50)}`);
  if (failures === 0) {
    console.log(`${GREEN}All checks passed.${RESET}`);
    if (!save) {
      console.log(`Run with --save to validate DB write + dedup.`);
    } else {
      console.log(`Ready to activate:`);
      console.log(`  UPDATE public.sources SET scraper_status = 'active' WHERE slug = '${slug}';`);
    }
  } else {
    console.log(`${RED}${failures} check(s) failed. Do not activate this source.${RESET}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
