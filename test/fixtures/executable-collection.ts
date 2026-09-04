import { validProductSpec } from './product-spec.js';
import type { ProductSpec } from '../../src/product-spec/types.js';
import type { CollectionExecution } from '../../src/executable-collection/types.js';

export const BOOK_IDEA = "My family is always borrowing books off my shelves and I never remember who has what. I'd like something simple where I can put in each book, the title, who wrote it, and roughly what kind of book it is, like a novel or a cookbook or a reference thing. When someone borrows one I want to note down their name, and when it comes back I want to clear that off. Mostly I just want to open it up and see everything I own in one list, and be able to pick out just the ones that are currently out with someone. It'd be nice to see how many are lent out right now. If I add a book by mistake I need to be able to fix it or take it off the list. It's just me using it on my own computer.";
export const SAAS_IDEA = "I am a solo SaaS founder and feedback from customers keeps getting lost in notes. I want a small feedback workflow where I can add a request with the customer name, a short title, category, and priority. New requests should start in an inbox and I should be able to move them in order through planned, in progress, and shipped. It should stop me from skipping stages or moving a shipped request backwards. I want to filter by status and priority and see how many requests are still active and how many have shipped. The requests and their current state need to survive a page refresh. This is only for me right now, so there should be no login, team features, customer portal, or billing.";

// Hand-authored development fixtures, not a fixture router or an interpreter shortcut.
export function publicCollectionSpec(kind: 'book' | 'saas'): ProductSpec {
  const idea = kind === 'book' ? BOOK_IDEA : SAAS_IDEA;
  const spec = validProductSpec(idea);
  const contract: Extract<CollectionExecution, { mode: 'compiled' }>['contract'] = kind === 'book' ? {
    noun: 'book', titleKey: 'title',
    fields: [{ key: 'title', label: 'Title', required: true }, { key: 'author', label: 'Author', required: true }, { key: 'category', label: 'Category', required: true }],
    hidden: { borrower: { initial: '' } },
    state_binding: { workflow_id: 'workflow_book', states: { available: { empty: ['borrower'] }, lent: { present: ['borrower'] } } },
    actions: [
      { id: 'lend', transition_id: 'lend', label: 'Lend', when: {}, input: [{ key: 'borrower', label: 'Borrower', required: true }], assign: { borrower: { input: 'borrower' } }, message: 'Book lent.' },
      { id: 'return', transition_id: 'return', label: 'Return', when: {}, assign: { borrower: '' }, message: 'Book returned.' },
    ],
  } : {
    noun: 'request', titleKey: 'title',
    fields: [{ key: 'customer', label: 'Customer', required: true }, { key: 'title', label: 'Title', required: true }, { key: 'category', label: 'Category', required: true },
      { key: 'priority', label: 'Priority', type: 'select', required: true, initial: 'medium', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] }],
    hidden: { status: { initial: 'inbox', required: true, choices: ['inbox','planned','in_progress','shipped'] } },
    state_binding: { workflow_id: 'workflow_saas', states: { inbox: { equals: { status: 'inbox' } }, planned: { equals: { status: 'planned' } }, in_progress: { equals: { status: 'in_progress' } }, shipped: { equals: { status: 'shipped' } } } },
    actions: [
      { id: 'plan', transition_id: 'plan', label: 'Plan', when: {}, assign: { status: 'planned' }, message: 'Request planned.' },
      { id: 'start', transition_id: 'start', label: 'Start work', when: {}, assign: { status: 'in_progress' }, message: 'Work started.' },
      { id: 'ship', transition_id: 'ship', label: 'Ship', when: {}, assign: { status: 'shipped' }, message: 'Request shipped.' },
    ],
  };
  spec.product.summary = kind === 'book' ? 'Track books and their borrowers.' : 'Manage a solo feedback workflow.';
  spec.product.goals = [spec.product.summary];
  spec.requirements = [{ id: 'req_product', title: spec.product.summary, description: idea, kind: 'FUNCTIONAL', provenance: 'EXPLICIT', disposition: 'IMPLEMENT',
    source_refs: spec.source_fragments.map((fragment) => ({ fragment_id: fragment.id, start: fragment.start, end: fragment.end, quote: fragment.text })), journey_ids: ['journey_product'] }];
  spec.fragment_disposition = spec.source_fragments.map((fragment) => ({ fragment_id: fragment.id, classification: 'USED', requirement_ids: ['req_product'], note: 'Public development product requirements.' }));
  spec.acceptance_journeys = [{ id: 'journey_product', title: 'Complete public product journey', actor_id: 'actor_owner', requirement_ids: ['req_product'],
    steps: kind === 'book' ? ['Create a book with nondefault fields.', 'Lend, edit, return and delete the book.', 'Reload and inspect the collection.'] : ['Add a high-priority request.', 'Reject a skip, progress one stage at a time, reject backwards movement.', 'Reload and inspect current state.'],
    expected_outcomes: ['Required fields and workflow rules hold.', 'Saved data and current state survive reload; failed writes preserve prior state.'] }];
  spec.entities = [{ id: `entity_${kind}`, name: kind, description: spec.product.summary,
    fields: [...contract.fields.map((field) => ({ id: field.key, name: field.label, type: field.options ? 'enum' as const : 'string' as const, required: Boolean(field.required), values: field.options?.map((option) => option.value) ?? [], validation: field.required ? ['Nonempty text required.'] : [] })),
      ...Object.entries(contract.hidden ?? {}).map(([key, rule]) => ({ id: key, name: key, type: rule.choices ? 'enum' as const : 'string' as const, required: Boolean(rule.required), values: rule.choices ?? [], validation: [] }))], relationships: [], validation: [] }];
  const states = kind === 'book' ? ['available','lent'] : ['inbox','planned','in_progress','shipped'];
  const edges = kind === 'book' ? [['lend','available','lent'],['return','lent','available']] : [['plan','inbox','planned'],['start','planned','in_progress'],['ship','in_progress','shipped']];
  spec.workflows = [{ id: `workflow_${kind}`, name: 'Record workflow', entity_id: `entity_${kind}`, initial_state: states[0]!, states,
    transitions: edges.map(([id, from, to]) => ({ id: id!, from: from!, to: to!, trigger: id!, guards: [], effects: [] })), invariants: kind === 'book' ? ['Lent records have a borrower.'] : ['One step forward only; shipped is terminal.'] }];
  spec.views = [{ id: 'view_main', name: 'Collection', purpose: spec.product.summary, states: ['empty','populated'], requirement_ids: ['req_product'] }];
  spec.assumptions = []; spec.persistence.data = [kind]; spec.selected_patterns.push('workflow.state-machine@1.0.0');
  spec.collection_execution = { mode: 'compiled', entity_id: `entity_${kind}`, requirement_ids: ['req_product'], contract };
  return spec;
}
