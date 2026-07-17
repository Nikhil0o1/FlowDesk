import type { DocTemplate } from '../types/template'

function tpl(
  id: string,
  name: string,
  category: string,
  description: string,
  content: string,
): DocTemplate {
  return { id, name, category, description, content, builtIn: true }
}

/**
 * Built-in template library. Content is plain HTML (the editor's format).
 *
 * TODO(backend): custom user templates (Phase 3) will be merged in from the API;
 * keep these as the read-only defaults.
 */
export const DOC_TEMPLATES: DocTemplate[] = [
  tpl(
    't-meeting-notes',
    'Meeting Notes',
    'Team',
    'Capture agenda, discussion and action items.',
    '<h1>Meeting Notes</h1><p><strong>Date:</strong> </p><p><strong>Attendees:</strong> </p><h2>Agenda</h2><ul><li>Topic one</li></ul><h2>Discussion</h2><p></p><h2>Action items</h2><ul class="doc-checklist"><li data-checked="false">Owner — task</li></ul>',
  ),
  tpl(
    't-sprint-planning',
    'Sprint Planning',
    'Engineering',
    'Plan sprint goals, capacity and committed work.',
    '<h1>Sprint Planning</h1><h2>Sprint goal</h2><p></p><h2>Capacity</h2><p></p><h2>Committed work</h2><ul class="doc-checklist"><li data-checked="false">Story</li></ul><h2>Risks</h2><ul><li></li></ul>',
  ),
  tpl(
    't-daily-standup',
    'Daily Standup',
    'Team',
    'Yesterday, today and blockers.',
    '<h1>Daily Standup</h1><h2>Yesterday</h2><ul><li></li></ul><h2>Today</h2><ul><li></li></ul><h2>Blockers</h2><ul><li></li></ul>',
  ),
  tpl(
    't-project-proposal',
    'Project Proposal',
    'Product',
    'Pitch a project with goals, scope and timeline.',
    '<h1>Project Proposal</h1><h2>Summary</h2><p></p><h2>Goals</h2><ul><li></li></ul><h2>Scope</h2><p></p><h2>Timeline</h2><p></p><h2>Success metrics</h2><ul><li></li></ul>',
  ),
  tpl(
    't-architecture-design',
    'Architecture Design',
    'Engineering',
    'Document a system design and its trade-offs.',
    '<h1>Architecture Design</h1><h2>Context</h2><p></p><h2>Proposed design</h2><p></p><h2>Alternatives considered</h2><ul><li></li></ul><h2>Trade-offs</h2><p></p>',
  ),
  tpl(
    't-technical-spec',
    'Technical Specification',
    'Engineering',
    'Detailed spec for a feature or component.',
    '<h1>Technical Specification</h1><h2>Overview</h2><p></p><h2>Requirements</h2><ul><li></li></ul><h2>Implementation</h2><p></p><h2>Testing</h2><p></p>',
  ),
  tpl(
    't-api-docs',
    'API Documentation',
    'Engineering',
    'Reference for an API surface.',
    '<h1>API Documentation</h1><h2>Endpoint</h2><pre><code>GET /resource</code></pre><h2>Parameters</h2><table><tbody><tr><th>Name</th><th>Type</th><th>Description</th></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table><h2>Response</h2><pre><code>{}</code></pre>',
  ),
  tpl(
    't-release-notes',
    'Release Notes',
    'Product',
    'Summarize what shipped in a release.',
    '<h1>Release Notes</h1><p><strong>Version:</strong> </p><h2>New</h2><ul><li></li></ul><h2>Improved</h2><ul><li></li></ul><h2>Fixed</h2><ul><li></li></ul>',
  ),
  tpl(
    't-bug-report',
    'Bug Report',
    'Engineering',
    'Steps to reproduce, expected vs actual.',
    '<h1>Bug Report</h1><h2>Summary</h2><p></p><h2>Steps to reproduce</h2><ol><li></li></ol><h2>Expected</h2><p></p><h2>Actual</h2><p></p><h2>Environment</h2><p></p>',
  ),
  tpl(
    't-retrospective',
    'Retrospective',
    'Team',
    'What went well, what to improve, actions.',
    '<h1>Retrospective</h1><h2>What went well</h2><ul><li></li></ul><h2>What could improve</h2><ul><li></li></ul><h2>Action items</h2><ul class="doc-checklist"><li data-checked="false">Owner — task</li></ul>',
  ),
]
