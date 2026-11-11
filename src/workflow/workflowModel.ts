/**
 * Extracts a diagram model (steps + transitions) from a parsed Workflow element.
 * Pure TypeScript, no VS Code dependency, so it can be unit-tested.
 */
import { XmlDocumentModel, XmlNode, getAttr } from '../parser/xmlParser';

export type StepKind = 'start' | 'stop' | 'approval' | 'rule' | 'script' | 'call' | 'subprocess' | 'step' | 'missing';

export interface WfStep {
  name: string;
  kind: StepKind;
  /** Short text under the name: rule name, method, subprocess... */
  detail: string;
  /** Full action/details for the tooltip. */
  tooltip: string;
  posX?: number;
  posY?: number;
  /** Offset of the <Step tag name, for reveal. -1 for missing steps. */
  offset: number;
  /** Offsets the step spans, for cursor highlighting. */
  start: number;
  end: number;
}

export interface WfTransition {
  from: string;
  to: string;
  when?: string;
  /** 1-based order inside the source step (IIQ takes the first transition whose condition matches). */
  order: number;
  /** How many transitions the source step has. */
  siblings: number;
  offset: number;
}

export interface WorkflowDiagramModel {
  name: string;
  type?: string;
  startStep?: string;
  steps: WfStep[];
  transitions: WfTransition[];
  variables: number;
  warnings: string[];
}

const elements = (n: XmlNode, tag?: string) => n.children.filter(c => c.kind === 'element' && (!tag || c.name === tag));

/** All <Workflow> elements of a document (root, or children of a <sailpoint> import file). */
export function findWorkflows(doc: XmlDocumentModel): XmlNode[] {
  const root = doc.root;
  if (!root) { return []; }
  if (root.name === 'Workflow') { return [root]; }
  if (root.name === 'sailpoint') { return elements(root, 'Workflow'); }
  return [];
}

/** Picks the workflow containing the offset, or the first one. */
export function pickWorkflow(doc: XmlDocumentModel, offset?: number): XmlNode | undefined {
  const all = findWorkflows(doc);
  if (offset !== undefined) {
    const hit = all.find(w => offset >= w.start && offset < w.end);
    if (hit) { return hit; }
  }
  return all[0];
}

function short(text: string, max = 48): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

function classifyStep(step: XmlNode): { kind: StepKind; detail: string; tooltip: string } {
  const name = getAttr(step, 'name') ?? '';
  const icon = (getAttr(step, 'icon') ?? '').toLowerCase();
  const action = getAttr(step, 'action') ?? '';

  if (icon === 'start' || (/^start$/i.test(name) && !action)) { return { kind: 'start', detail: '', tooltip: 'Start' }; }
  if (icon === 'stop' || (/^(stop|end)$/i.test(name) && !action)) { return { kind: 'stop', detail: '', tooltip: 'Stop' }; }

  const approval = elements(step, 'Approval')[0];
  if (approval) {
    const owner = getAttr(approval, 'owner') ?? '';
    const mode = getAttr(approval, 'mode');
    const detail = owner ? `owner: ${owner}` : (mode ? `mode: ${mode}` : 'work item');
    return { kind: 'approval', detail: short(detail), tooltip: `Approval${mode ? ` (${mode})` : ''}${owner ? `\nowner: ${owner}` : ''}` };
  }

  const wfRef = elements(step, 'WorkflowRef')[0];
  if (wfRef) {
    const ref = elements(wfRef, 'Reference')[0];
    const target = ref ? (getAttr(ref, 'name') ?? getAttr(ref, 'id') ?? '') : '';
    return { kind: 'subprocess', detail: short(target), tooltip: `Subprocess: ${target}` };
  }

  if (action.startsWith('rule:')) { return { kind: 'rule', detail: short(action.slice(5)), tooltip: action }; }
  if (action.startsWith('call:')) { return { kind: 'call', detail: short(action.slice(5)), tooltip: action }; }
  if (action.startsWith('script:')) { return { kind: 'script', detail: short(action.slice(7)), tooltip: action }; }
  if (action) { return { kind: 'step', detail: short(action), tooltip: action }; }

  const script = elements(step, 'Script')[0];
  if (script) {
    const code = script.children.map(c => (c.kind === 'cdata' || c.kind === 'text') ? c.text : '')
      .concat(elements(script, 'Source').flatMap(s => s.children.map(c => (c.kind === 'cdata' || c.kind === 'text') ? c.text : '')))
      .join('\n').trim();
    const lines = code ? code.split('\n').length : 0;
    return { kind: 'script', detail: `${lines} line${lines === 1 ? '' : 's'} of BeanShell`, tooltip: short(code, 400) };
  }

  return { kind: 'step', detail: '', tooltip: name };
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === '') { return undefined; }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function buildWorkflowModel(workflow: XmlNode): WorkflowDiagramModel {
  const warnings: string[] = [];
  const steps: WfStep[] = [];
  const transitions: WfTransition[] = [];
  const names = new Set<string>();

  for (const step of elements(workflow, 'Step')) {
    let name = getAttr(step, 'name') ?? '';
    if (!name) { name = `(unnamed step, line offset ${step.start})`; warnings.push('A step has no name.'); }
    if (names.has(name)) { warnings.push(`Duplicate step name "${name}".`); }
    names.add(name);
    const c = classifyStep(step);
    steps.push({
      name, kind: c.kind, detail: c.detail, tooltip: c.tooltip,
      posX: num(getAttr(step, 'posX')), posY: num(getAttr(step, 'posY')),
      offset: step.nameStart, start: step.start, end: step.end
    });

    const trs = elements(step, 'Transition');
    trs.forEach((t, i) => {
      const to = getAttr(t, 'to') ?? '';
      const when = getAttr(t, 'when');
      transitions.push({ from: name, to, when: when && when.trim() ? when.trim() : undefined, order: i + 1, siblings: trs.length, offset: t.nameStart });
    });
  }

  // Targets that do not exist become "missing" ghost nodes so the error is visible in the diagram.
  for (const t of transitions) {
    if (t.to && !names.has(t.to)) {
      names.add(t.to);
      steps.push({ name: t.to, kind: 'missing', detail: 'step not found', tooltip: `No step named "${t.to}"`, offset: -1, start: -1, end: -1 });
      warnings.push(`Transition from "${t.from}" goes to unknown step "${t.to}".`);
    }
  }

  const startStep = steps.find(s => s.kind === 'start')?.name ?? steps.find(s => s.kind !== 'missing')?.name;

  // Steps nothing leads to (other than the start) are usually leftovers worth knowing about.
  for (const s of steps) {
    if (s.kind === 'missing' || s.name === startStep) { continue; }
    if (!transitions.some(t => t.to === s.name)) { warnings.push(`Step "${s.name}" is never reached by a transition.`); }
  }

  return {
    name: getAttr(workflow, 'name') ?? '(unnamed workflow)',
    type: getAttr(workflow, 'type'),
    startStep,
    steps,
    transitions,
    variables: elements(workflow, 'Variable').length,
    warnings
  };
}
