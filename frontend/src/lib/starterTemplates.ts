/** Curated, app-shipped starter templates shown in the Template Center.
 * Each one applies via POST /templates/apply-payload (no DB row needed) and
 * builds a real project: statuses, custom fields, lists and seed tasks.
 * The payload shape matches the backend template_service project snapshot. */

export type Complexity = 'Beginner' | 'Intermediate' | 'Advanced'

interface StatusSpec {
  name: string
  color: string
  category: 'todo' | 'in_progress' | 'done' | 'cancelled'
  position: number
}
interface FieldSpec {
  name: string
  field_type: 'text' | 'number' | 'date' | 'select' | 'checkbox'
  options?: string[]
  position: number
}
interface TaskSpec {
  title: string
  status_name?: string
  list_name?: string
  priority?: 'urgent' | 'high' | 'normal' | 'low'
  position: number
}

export interface StarterPayload {
  name: string
  description: string
  color: string
  icon?: string | null
  statuses: StatusSpec[]
  custom_fields: { name: string; field_type: FieldSpec['field_type']; options: string[]; position: number }[]
  lists: { name: string; position: number }[]
  tasks: TaskSpec[]
}

export interface StarterTemplate {
  id: string
  name: string
  category: string
  description: string
  color: string
  complexity: Complexity
  featured?: boolean
  payload: StarterPayload
}

const S = (name: string, color: string, category: StatusSpec['category'], position: number): StatusSpec => ({
  name,
  color,
  category,
  position,
})
const f = (name: string, field_type: FieldSpec['field_type'], position: number, options: string[] = []) => ({
  name,
  field_type,
  options,
  position,
})

const AGILE = [S('Backlog', '#87909E', 'todo', 0), S('To Do', '#5B9FF0', 'todo', 1), S('In Progress', '#F2994A', 'in_progress', 2), S('In Review', '#B07BE0', 'in_progress', 3), S('Done', '#4CB782', 'done', 4)]
const SIMPLE = [S('To Do', '#87909E', 'todo', 0), S('In Progress', '#5B9FF0', 'in_progress', 1), S('Complete', '#4CB782', 'done', 2)]

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'starter-pm',
    name: 'Project Management',
    category: 'Project Management',
    description: 'Plan and run any project end-to-end: phases, owners, priorities and a clear path from kickoff to delivery.',
    color: '#2B88EE',
    complexity: 'Beginner',
    featured: true,
    payload: {
      name: 'Project Management', description: 'End-to-end project plan', color: '#2B88EE', icon: null,
      statuses: AGILE,
      custom_fields: [f('Priority', 'select', 0, ['Urgent', 'High', 'Normal', 'Low']), f('Owner', 'text', 1), f('Effort (days)', 'number', 2)],
      lists: [{ name: 'Planning', position: 0 }, { name: 'Execution', position: 1 }, { name: 'Launch', position: 2 }],
      tasks: [
        { title: 'Define project scope & goals', status_name: 'To Do', list_name: 'Planning', priority: 'high', position: 0 },
        { title: 'Stakeholder kickoff meeting', status_name: 'To Do', list_name: 'Planning', priority: 'normal', position: 1 },
        { title: 'Build project timeline', status_name: 'In Progress', list_name: 'Planning', priority: 'high', position: 2 },
        { title: 'Execute core deliverables', status_name: 'Backlog', list_name: 'Execution', priority: 'normal', position: 3 },
        { title: 'Final review & launch', status_name: 'Backlog', list_name: 'Launch', priority: 'high', position: 4 },
      ],
    },
  },
  {
    id: 'starter-sprint',
    name: 'Agile Sprint',
    category: 'Project Management',
    description: 'Run two-week sprints with story points, a backlog and a review column. Built for software teams.',
    color: '#7C5CFC',
    complexity: 'Intermediate',
    featured: true,
    payload: {
      name: 'Agile Sprint', description: 'Scrum sprint board', color: '#7C5CFC', icon: null,
      statuses: AGILE,
      custom_fields: [f('Story Points', 'number', 0), f('Sprint', 'text', 1), f('Type', 'select', 2, ['Feature', 'Bug', 'Chore', 'Spike'])],
      lists: [{ name: 'Current Sprint', position: 0 }, { name: 'Backlog', position: 1 }],
      tasks: [
        { title: 'Sprint planning', status_name: 'To Do', list_name: 'Current Sprint', priority: 'high', position: 0 },
        { title: 'Implement feature A', status_name: 'In Progress', list_name: 'Current Sprint', priority: 'normal', position: 1 },
        { title: 'Code review', status_name: 'In Review', list_name: 'Current Sprint', priority: 'normal', position: 2 },
        { title: 'Sprint retrospective', status_name: 'Backlog', list_name: 'Backlog', priority: 'low', position: 3 },
      ],
    },
  },
  {
    id: 'starter-bug',
    name: 'Bug Tracking',
    category: 'Engineering',
    description: 'Log, triage and squash bugs with severity, environment and reproducibility fields.',
    color: '#F0506E',
    complexity: 'Beginner',
    featured: true,
    payload: {
      name: 'Bug Tracking', description: 'Track and resolve bugs', color: '#F0506E', icon: null,
      statuses: [S('Reported', '#87909E', 'todo', 0), S('Confirmed', '#5B9FF0', 'todo', 1), S('Fixing', '#F2994A', 'in_progress', 2), S('In QA', '#B07BE0', 'in_progress', 3), S('Closed', '#4CB782', 'done', 4)],
      custom_fields: [f('Severity', 'select', 0, ['Critical', 'Major', 'Minor', 'Trivial']), f('Environment', 'select', 1, ['Production', 'Staging', 'Local']), f('Steps to reproduce', 'text', 2)],
      lists: [{ name: 'Bugs', position: 0 }],
      tasks: [
        { title: 'Example: Login button unresponsive on mobile', status_name: 'Reported', list_name: 'Bugs', priority: 'high', position: 0 },
        { title: 'Example: Dashboard chart renders empty', status_name: 'Confirmed', list_name: 'Bugs', priority: 'normal', position: 1 },
      ],
    },
  },
  {
    id: 'starter-feature',
    name: 'Feature Development',
    category: 'Engineering',
    description: 'Take features from idea to ship: spec, build, test and release with acceptance criteria.',
    color: '#5B6BFF',
    complexity: 'Intermediate',
    payload: {
      name: 'Feature Development', description: 'Feature delivery pipeline', color: '#5B6BFF', icon: null,
      statuses: [S('Idea', '#87909E', 'todo', 0), S('Spec', '#5B9FF0', 'todo', 1), S('Building', '#F2994A', 'in_progress', 2), S('Testing', '#B07BE0', 'in_progress', 3), S('Shipped', '#4CB782', 'done', 4)],
      custom_fields: [f('Acceptance Criteria', 'text', 0), f('Target Release', 'date', 1), f('Risk', 'select', 2, ['High', 'Medium', 'Low'])],
      lists: [{ name: 'Features', position: 0 }],
      tasks: [
        { title: 'Write product spec', status_name: 'Spec', list_name: 'Features', priority: 'high', position: 0 },
        { title: 'Technical design doc', status_name: 'Idea', list_name: 'Features', priority: 'normal', position: 1 },
      ],
    },
  },
  {
    id: 'starter-content',
    name: 'Content Calendar',
    category: 'Marketing',
    description: 'Plan, write and publish content across channels with due dates and a clear editorial flow.',
    color: '#EC4899',
    complexity: 'Beginner',
    featured: true,
    payload: {
      name: 'Content Calendar', description: 'Editorial pipeline', color: '#EC4899', icon: null,
      statuses: [S('Idea', '#87909E', 'todo', 0), S('Writing', '#5B9FF0', 'in_progress', 1), S('Editing', '#F2994A', 'in_progress', 2), S('Scheduled', '#B07BE0', 'in_progress', 3), S('Published', '#4CB782', 'done', 4)],
      custom_fields: [f('Channel', 'select', 0, ['Blog', 'Newsletter', 'LinkedIn', 'Twitter', 'Instagram']), f('Publish Date', 'date', 1), f('Author', 'text', 2)],
      lists: [{ name: 'This Month', position: 0 }, { name: 'Ideas', position: 1 }],
      tasks: [
        { title: 'Launch announcement blog post', status_name: 'Writing', list_name: 'This Month', priority: 'high', position: 0 },
        { title: 'Monthly newsletter', status_name: 'Idea', list_name: 'This Month', priority: 'normal', position: 1 },
        { title: 'Brainstorm Q3 topics', status_name: 'Idea', list_name: 'Ideas', priority: 'low', position: 2 },
      ],
    },
  },
  {
    id: 'starter-campaign',
    name: 'Marketing Campaign',
    category: 'Marketing',
    description: 'Coordinate a multi-channel campaign from brief to results, with budget and channel tracking.',
    color: '#F59E0B',
    complexity: 'Intermediate',
    payload: {
      name: 'Marketing Campaign', description: 'Campaign planning & tracking', color: '#F59E0B', icon: null,
      statuses: SIMPLE,
      custom_fields: [f('Channel', 'select', 0, ['Email', 'Paid', 'Social', 'Events', 'SEO']), f('Budget', 'number', 1), f('Goal', 'text', 2)],
      lists: [{ name: 'Campaign', position: 0 }],
      tasks: [
        { title: 'Write campaign brief', status_name: 'To Do', list_name: 'Campaign', priority: 'high', position: 0 },
        { title: 'Design creative assets', status_name: 'To Do', list_name: 'Campaign', priority: 'normal', position: 1 },
        { title: 'Measure & report results', status_name: 'To Do', list_name: 'Campaign', priority: 'normal', position: 2 },
      ],
    },
  },
  {
    id: 'starter-crm',
    name: 'Sales CRM Pipeline',
    category: 'Sales & CRM',
    description: 'Move deals through a pipeline with value, contact and stage tracking from lead to won.',
    color: '#07BEA3',
    complexity: 'Intermediate',
    payload: {
      name: 'Sales CRM', description: 'Deal pipeline', color: '#07BEA3', icon: null,
      statuses: [S('Lead', '#87909E', 'todo', 0), S('Contacted', '#5B9FF0', 'in_progress', 1), S('Proposal', '#F2994A', 'in_progress', 2), S('Negotiation', '#B07BE0', 'in_progress', 3), S('Won', '#4CB782', 'done', 4), S('Lost', '#E5484D', 'cancelled', 5)],
      custom_fields: [f('Deal Value', 'number', 0), f('Company', 'text', 1), f('Contact Email', 'text', 2)],
      lists: [{ name: 'Deals', position: 0 }],
      tasks: [
        { title: 'Example: Acme Corp — annual plan', status_name: 'Lead', list_name: 'Deals', priority: 'high', position: 0 },
        { title: 'Example: Globex — pilot', status_name: 'Contacted', list_name: 'Deals', priority: 'normal', position: 1 },
      ],
    },
  },
  {
    id: 'starter-onboarding',
    name: 'Employee Onboarding',
    category: 'HR & Operations',
    description: 'Give every new hire a smooth first 30 days with a checklist across IT, HR and team setup.',
    color: '#9B59B6',
    complexity: 'Beginner',
    payload: {
      name: 'Employee Onboarding', description: 'New hire checklist', color: '#9B59B6', icon: null,
      statuses: SIMPLE,
      custom_fields: [f('Department', 'text', 0), f('Start Date', 'date', 1), f('Buddy', 'text', 2)],
      lists: [{ name: 'Before Day 1', position: 0 }, { name: 'Week 1', position: 1 }, { name: 'First 30 Days', position: 2 }],
      tasks: [
        { title: 'Create accounts & hardware', status_name: 'To Do', list_name: 'Before Day 1', priority: 'high', position: 0 },
        { title: 'Welcome & office tour', status_name: 'To Do', list_name: 'Week 1', priority: 'normal', position: 1 },
        { title: 'Assign onboarding buddy', status_name: 'To Do', list_name: 'Week 1', priority: 'normal', position: 2 },
        { title: '30-day check-in', status_name: 'To Do', list_name: 'First 30 Days', priority: 'normal', position: 3 },
      ],
    },
  },
]

export const STARTER_CATEGORIES = Array.from(new Set(STARTER_TEMPLATES.map((t) => t.category)))
