import type { FlowDoc } from '../types/document'

const now = '2026-06-09T17:07:00.000Z'

function doc(
  id: string,
  title: string,
  folderId: string | null,
  body: string,
  status: FlowDoc['status'] = 'published',
): FlowDoc {
  return {
    id,
    title,
    folderId,
    content: body,
    author: 'FlowDesk',
    status,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Seed documents used until a backend exists. Content is plain HTML (the same
 * format the rich text editor reads/writes).
 */
export const MOCK_DOCUMENTS: FlowDoc[] = [
  doc(
    'd-auth-api',
    'Authentication API',
    'f-engineering',
    '<h1>Authentication API</h1><p>Endpoints for login, token refresh and logout. All requests are authenticated with a bearer token.</p><h2>Login</h2><p><code>POST /auth/login</code> returns an access token and sets a refresh cookie.</p>',
  ),
  doc(
    'd-deploy',
    'Deployment Guide',
    'f-engineering',
    '<h1>Deployment Guide</h1><p>Steps to ship a release to production.</p><ol><li>Merge to <code>main</code></li><li>Run the CI pipeline</li><li>Promote the build</li></ol>',
  ),
  doc(
    'd-standards',
    'Coding Standards',
    'f-engineering',
    '<h1>Coding Standards</h1><p>Conventions every contributor should follow.</p><ul><li>Prefer small, focused modules</li><li>Write tests for new logic</li><li>No hardcoded colors</li></ul>',
    'draft',
  ),
  doc(
    'd-component-lib',
    'Component Library',
    'f-frontend',
    '<h1>Component Library</h1><p>Reusable UI building blocks and how to use them.</p>',
  ),
  doc(
    'd-react-guidelines',
    'React Guidelines',
    'f-frontend',
    '<h1>React Guidelines</h1><p>Patterns for building maintainable React features.</p><blockquote>Keep components pure and side-effects in hooks.</blockquote>',
  ),
  doc(
    'd-roadmap',
    'Roadmap',
    'f-product',
    '<h1>Roadmap</h1><p>What we are building this quarter and why.</p>',
  ),
  doc(
    'd-sprint-plan',
    'Sprint Plan',
    'f-product',
    '<h1>Sprint Plan</h1><p>Goals and committed work for the current sprint.</p>',
    'draft',
  ),
  doc(
    'd-campaign-ideas',
    'Campaign Ideas',
    'f-marketing',
    '<h1>Campaign Ideas</h1><p>Brainstormed ideas for upcoming launches.</p>',
    'draft',
  ),
  doc(
    'd-handbook',
    'Employee Handbook',
    'f-hr',
    '<h1>Employee Handbook</h1><p>Everything you need to know as a new team member.</p>',
  ),
  doc(
    'd-leave-policy',
    'Leave Policy',
    'f-hr',
    '<h1>Leave Policy</h1><p>How to request time off and how balances accrue.</p>',
  ),
]
