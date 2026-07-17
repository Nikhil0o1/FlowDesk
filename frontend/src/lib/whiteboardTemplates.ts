/**
 * Predefined whiteboard templates. Each is authored as an Excalidraw element
 * "skeleton" and expanded with convertToExcalidrawElements at create time
 * (which also wires up bound/connected arrows).
 *
 * NOTE: this module must NOT import @excalidraw/excalidraw at the top level —
 * the templates gallery on the list page imports it eagerly, and we keep the
 * heavy Excalidraw bundle out of that page. templateScene() lazy-loads it.
 */

// The skeleton element shape is intentionally loose — convertToExcalidrawElements
// accepts ExcalidrawElementSkeleton[]; we author with small factory helpers.
type Skel = Record<string, unknown>

export interface WhiteboardTemplate {
  key: string
  name: string
  description: string
  /** lucide icon name handled by the caller; kept abstract here */
  accent: string
  skeleton: Skel[]
}

// ---- factory helpers -------------------------------------------------------

let _seq = 0
const uid = (p: string) => `${p}-${_seq++}`

function box(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  bg = '#ffffff',
  stroke = '#1e1e1e',
): Skel {
  return {
    type: 'rectangle',
    id,
    x,
    y,
    width: w,
    height: h,
    backgroundColor: bg,
    strokeColor: stroke,
    roundness: { type: 3 },
    label: { text: label, fontSize: 16, strokeColor: stroke },
  }
}

function diamond(id: string, x: number, y: number, w: number, h: number, label: string, bg = '#fff3bf'): Skel {
  return {
    type: 'diamond',
    id,
    x,
    y,
    width: w,
    height: h,
    backgroundColor: bg,
    strokeColor: '#1e1e1e',
    label: { text: label, fontSize: 14 },
  }
}

function sticky(x: number, y: number, label: string, bg: string): Skel {
  return {
    type: 'rectangle',
    id: uid('sticky'),
    x,
    y,
    width: 160,
    height: 120,
    backgroundColor: bg,
    strokeColor: '#00000000',
    roundness: { type: 2 },
    label: { text: label, fontSize: 14, verticalAlign: 'top' },
  }
}

function heading(x: number, y: number, text: string, fontSize = 28): Skel {
  return { type: 'text', x, y, text, fontSize, strokeColor: '#1e1e1e' }
}

function link(from: string, to: string, x: number, y: number): Skel {
  return { type: 'arrow', x, y, strokeColor: '#868e96', start: { id: from }, end: { id: to } }
}

// ---- templates -------------------------------------------------------------

const BLUE = '#a5d8ff'
const GREEN = '#b2f2bb'
const PINK = '#ffc9c9'
const PURPLE = '#d0bfff'
const GOLD = '#ffe066'
const TEAL = '#96f2d7'

function orgChart(): Skel[] {
  const ceo = box('ceo', 360, 40, 180, 60, 'CEO', PURPLE)
  const cto = box('cto', 160, 200, 160, 56, 'CTO', BLUE)
  const coo = box('coo', 360, 200, 160, 56, 'COO', BLUE)
  const cfo = box('cfo', 560, 200, 160, 56, 'CFO', BLUE)
  const e1 = box(uid('r'), 120, 360, 150, 50, 'Engineering', '#fff')
  const e2 = box(uid('r'), 320, 360, 150, 50, 'Operations', '#fff')
  const e3 = box(uid('r'), 540, 360, 150, 50, 'Finance', '#fff')
  return [
    ceo, cto, coo, cfo, e1, e2, e3,
    link('ceo', 'cto', 440, 100), link('ceo', 'coo', 440, 100), link('ceo', 'cfo', 440, 100),
    link('cto', e1.id as string, 240, 256), link('coo', e2.id as string, 440, 256), link('cfo', e3.id as string, 640, 256),
  ]
}

function actionPlan(): Skel[] {
  const title = box('title', 320, 20, 360, 60, 'Vision to Action Framework', '#fff')
  const goal = box('goal', 380, 130, 240, 50, 'GOAL', GREEN)
  const why = box('why', 360, 230, 280, 46, "What's pushing me to make this happen?", PINK)
  const how = box('how', 380, 320, 240, 46, 'How do I get there?', PINK)
  const cols = ['Action item', 'Resources needed', 'Status', 'Completion date']
  const items: Skel[] = []
  ;[160, 400, 640].forEach((cx, i) => {
    const head = box(uid('a'), cx, 420, 180, 44, `Action ${i + 1}`, BLUE)
    items.push(head, link('how', head.id as string, 500, 366))
    cols.forEach((c, j) => items.push(box(uid('a'), cx, 480 + j * 56, 180, 44, c, '#e7f5ff')))
  })
  const outcome = box('outcome', 380, 740, 240, 50, "What's the ideal outcome?", GOLD)
  return [title, goal, why, how, ...items, outcome, link('goal', 'why', 500, 180), link('why', 'how', 500, 276)]
}

function customerJourney(): Skel[] {
  const stages = ['Awareness', 'Consideration', 'Purchase', 'Retention', 'Advocacy']
  const rows = ['Actions', 'Touchpoints', 'Emotions']
  const out: Skel[] = [heading(40, 20, 'Customer Journey Map')]
  stages.forEach((s, i) => {
    out.push(box(uid('cj'), 40 + i * 210, 80, 190, 50, s, TEAL))
    rows.forEach((_, j) => out.push(box(uid('cj'), 40 + i * 210, 150 + j * 110, 190, 96, '', '#ffffff')))
  })
  rows.forEach((r, j) => out.push(heading(40 + 5 * 210 + 10, 160 + j * 110, r, 16)))
  return out
}

function flowchart(): Skel[] {
  const start = box('start', 360, 40, 160, 50, 'Start', GREEN)
  const proc = box('proc', 360, 150, 160, 50, 'Process step', BLUE)
  const dec = diamond('dec', 350, 260, 180, 110, 'Decision?')
  const yes = box('yes', 600, 285, 150, 50, 'Yes → next', '#fff')
  const no = box('no', 130, 285, 150, 50, 'No → revise', '#fff')
  const end = box('end', 360, 430, 160, 50, 'End', GOLD)
  return [
    start, proc, dec, yes, no, end,
    link('start', 'proc', 440, 90), link('proc', 'dec', 440, 200),
    link('dec', 'yes', 530, 315), link('dec', 'no', 350, 315), link('yes', 'end', 675, 335),
  ]
}

function mindMap(): Skel[] {
  const core = box('core', 380, 230, 200, 70, 'Central Idea', PURPLE)
  const branches = [
    box('b1', 80, 80, 160, 50, 'Branch 1', BLUE),
    box('b2', 720, 80, 160, 50, 'Branch 2', GREEN),
    box('b3', 80, 400, 160, 50, 'Branch 3', PINK),
    box('b4', 720, 400, 160, 50, 'Branch 4', GOLD),
  ]
  return [core, ...branches, ...branches.map((b) => link('core', b.id as string, 480, 265))]
}

function kanban(): Skel[] {
  const cols: [string, string][] = [
    ['To Do', '#e7f5ff'],
    ['In Progress', '#fff3bf'],
    ['Done', '#ebfbee'],
  ]
  const out: Skel[] = [heading(40, 20, 'Brainstorm / Kanban')]
  cols.forEach(([name, bg], i) => {
    out.push(box(uid('k'), 40 + i * 250, 70, 220, 440, name, bg))
    out.push(sticky(60 + i * 250, 130, 'Idea…', i === 0 ? PINK : i === 1 ? GOLD : GREEN))
    out.push(sticky(60 + i * 250, 270, 'Idea…', BLUE))
  })
  return out
}

export const WHITEBOARD_TEMPLATES: WhiteboardTemplate[] = [
  { key: 'org-chart', name: 'Organizational Chart', description: 'Visualize your team structure', accent: '#d0bfff', skeleton: orgChart() },
  { key: 'action-plan', name: 'Action Plan', description: 'Turn goals into actionable steps', accent: '#96f2d7', skeleton: actionPlan() },
  { key: 'customer-journey', name: 'Customer Journey Map', description: 'Optimize every customer touchpoint', accent: '#a5d8ff', skeleton: customerJourney() },
  { key: 'flowchart', name: 'Flowchart', description: 'Map a process or decision flow', accent: '#b2f2bb', skeleton: flowchart() },
  { key: 'mind-map', name: 'Mind Map', description: 'Branch ideas out from a core topic', accent: '#ffd8a8', skeleton: mindMap() },
  { key: 'kanban', name: 'Brainstorm Board', description: 'Sticky notes in To-Do / Doing / Done', accent: '#ffe066', skeleton: kanban() },
]

/** Build a persistable Excalidraw scene from a template (lazy-loads Excalidraw). */
export async function templateScene(template: WhiteboardTemplate) {
  const { convertToExcalidrawElements } = await import('@excalidraw/excalidraw')
  return {
    elements: convertToExcalidrawElements(template.skeleton as never),
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  }
}
