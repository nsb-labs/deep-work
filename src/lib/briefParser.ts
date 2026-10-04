/**
 * Parser for memory/briefs/latest.md
 * Extracts structured dashboard data from the email brief markdown.
 */

/** Generic Markdown section contract shared by parsing and dashboard actions.
 * User-defined categories will be introduced through the product settings model.
 */
export const BRIEF_SECTIONS = {
  priority: 'PRIORITY',
  contacts: 'IMPORTANT CONTACTS',
  action: 'ACTION REQUIRED',
  projects: 'PROJECTS',
  reviews: 'REVIEWS',
  pending: 'PENDING',
  waiting: 'WAITING ON',
  fyi: 'FYI',
  weekly: 'WEEKLY',
} as const;

export interface BriefMeta {
  updated: string;
  lastPull: string;
  previousBrief: string;
}

export interface DashboardRow {
  id: string;
  subject: string;
  status: string;
  remarks: string;
  raw: string; // full row text for copy
}

export interface ActionRow {
  id: string;
  subject: string;
  from: string;
  priority: string;
  action: string;
  raw: string;
}

export interface ProjectRow {
  project: string;
  owner: string;
  status: string;
  update: string;
  raw: string;
}

export interface ReviewRow {
  item: string;
  context: string;
  status: string;
  update: string;
  raw: string;
}

export interface PendingRow {
  id: string;
  item: string;
  priority: string;
  days: string;
  notes: string;
  raw: string;
}

export interface WaitingRow {
  subject: string;
  waitingOn: string;
  since: string;
  status: string;
  raw: string;
}

export interface DashboardData {
  meta: BriefMeta;
  priorityItems: DashboardRow[];
  importantContacts: DashboardRow[];
  actionRequired: ActionRow[];
  actionTitle: string;
  projects: ProjectRow[];
  projectsTitle: string;
  reviews: ReviewRow[];
  pending: PendingRow[];
  waitingOn: WaitingRow[];
  fyi: string[];
  fyiTitle: string;
  /** Raw markdown content from weekly-achievements/current.md (loaded separately) */
  weeklyReport: string;
}

/**
 * Parse a markdown table into rows of cell arrays.
 * Skips the header separator row (|---|---|).
 */
function parseTable(lines: string[]): string[][] {
  const rows: string[][] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    // Skip separator rows
    if (/^\|[\s-|]+\|$/.test(trimmed)) continue;
    const cells = trimmed
      .split('|')
      .slice(1, -1) // remove first/last empty from split
      .map((c) => c.trim());
    rows.push(cells);
  }
  // First row is header, rest are data
  return rows.slice(1);
}

/**
 * Extract section content between two ## headers
 */
function extractSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split('\n');
  let currentHeader = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentHeader) {
        sections.set(currentHeader, currentLines.join('\n'));
      }
      currentHeader = line.replace('## ', '').trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentHeader) {
    sections.set(currentHeader, currentLines.join('\n'));
  }

  return sections;
}

/**
 * Parse the brief metadata from the YAML-like header
 */
function parseMeta(content: string): BriefMeta {
  const meta: BriefMeta = { updated: '', lastPull: '', previousBrief: '' };
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.startsWith('updated:')) meta.updated = line.replace('updated:', '').trim();
    if (line.startsWith('last_pull:')) meta.lastPull = line.replace('last_pull:', '').trim();
    if (line.startsWith('previous_brief:'))
      meta.previousBrief = line.replace('previous_brief:', '').trim();
  }
  return meta;
}

/**
 * Parse standard dashboard rows (# | Subject | Status | Remarks)
 */
function parseDashboardRows(sectionContent: string): DashboardRow[] {
  const lines = sectionContent.split('\n');
  const tableRows = parseTable(lines);
  return tableRows.map((cells) => ({
    id: cells[0] || '',
    subject: cells[1] || '',
    status: cells[2] || '',
    remarks: cells[3] || '',
    raw: cells.join(' | '),
  }));
}

/**
 * Parse action required rows (# | Subject | From | Priority | Action)
 */
function parseActionRows(sectionContent: string): ActionRow[] {
  const lines = sectionContent.split('\n');
  const tableRows = parseTable(lines);
  return tableRows.map((cells) => ({
    id: cells[0] || '',
    subject: cells[1] || '',
    from: cells[2] || '',
    priority: cells[3] || '',
    action: cells[4] || '',
    raw: cells.join(' | '),
  }));
}

/**
 * Parse project rows
 */
function parseProjectRows(sectionContent: string): ProjectRow[] {
  const lines = sectionContent.split('\n');
  const tableRows = parseTable(lines);
  return tableRows.map((cells) => ({
    project: cells[0] || '',
    owner: cells[1] || '',
    status: cells[2] || '',
    update: cells[3] || '',
    raw: cells.join(' | '),
  }));
}

/**
 * Parse review rows
 */
function parseReviewRows(sectionContent: string): ReviewRow[] {
  const lines = sectionContent.split('\n');
  const tableRows = parseTable(lines);
  return tableRows.map((cells) => ({
    item: cells[0] || '',
    context: cells[1] || '',
    status: cells[2] || '',
    update: cells[3] || '',
    raw: cells.join(' | '),
  }));
}

/**
 * Parse pending rows
 */
function parsePendingRows(sectionContent: string): PendingRow[] {
  const lines = sectionContent.split('\n');
  const tableRows = parseTable(lines);
  return tableRows.map((cells) => ({
    id: cells[0] || '',
    item: cells[1] || '',
    priority: cells[2] || '',
    days: cells[3] || '',
    notes: cells[4] || '',
    raw: cells.join(' | '),
  }));
}

/**
 * Parse waiting on rows
 */
function parseWaitingRows(sectionContent: string): WaitingRow[] {
  const lines = sectionContent.split('\n');
  const tableRows = parseTable(lines);
  return tableRows.map((cells) => ({
    subject: cells[0] || '',
    waitingOn: cells[1] || '',
    since: cells[2] || '',
    status: cells[3] || '',
    raw: cells.join(' | '),
  }));
}

/**
 * Parse FYI section (non-table, bullet list or plain text)
 */
function parseFyiLines(sectionContent: string): string[] {
  return sectionContent
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-') || l.startsWith('*'))
    .map((l) => l.replace(/^[-*]\s*/, ''));
}

/**
 * Find a section by partial key match
 */
function findSection(sections: Map<string, string>, keyword: string): [string, string] | null {
  for (const [key, value] of sections) {
    if (key.toLowerCase().includes(keyword.toLowerCase())) {
      return [key, value];
    }
  }
  return null;
}

/**
 * Main parser: takes raw latest.md content, returns structured data
 */
export function parseBrief(content: string): DashboardData {
  const meta = parseMeta(content);
  const sections = extractSections(content);

  const prioritySection = findSection(sections, BRIEF_SECTIONS.priority);
  const contactsSection = findSection(sections, BRIEF_SECTIONS.contacts);
  const actionSection = findSection(sections, BRIEF_SECTIONS.action);
  const projectsSection = findSection(sections, BRIEF_SECTIONS.projects);
  const reviewSection = findSection(sections, BRIEF_SECTIONS.reviews);
  const pendingSection = findSection(sections, BRIEF_SECTIONS.pending);
  const waitingSection = findSection(sections, BRIEF_SECTIONS.waiting);
  const fyiSection = findSection(sections, BRIEF_SECTIONS.fyi);

  return {
    meta,
    priorityItems: prioritySection ? parseDashboardRows(prioritySection[1]) : [],
    importantContacts: contactsSection ? parseDashboardRows(contactsSection[1]) : [],
    actionRequired: actionSection ? parseActionRows(actionSection[1]) : [],
    actionTitle: actionSection ? actionSection[0] : 'ACTION REQUIRED',
    projects: projectsSection ? parseProjectRows(projectsSection[1]) : [],
    projectsTitle: projectsSection ? projectsSection[0] : BRIEF_SECTIONS.projects,
    reviews: reviewSection ? parseReviewRows(reviewSection[1]) : [],
    pending: pendingSection ? parsePendingRows(pendingSection[1]) : [],
    waitingOn: waitingSection ? parseWaitingRows(waitingSection[1]) : [],
    fyi: fyiSection ? parseFyiLines(fyiSection[1]) : [],
    fyiTitle: fyiSection ? fyiSection[0] : 'FYI / Auto-Archived',
    weeklyReport: '', // loaded separately via App.tsx from weekly-achievements/current.md
  };
}
