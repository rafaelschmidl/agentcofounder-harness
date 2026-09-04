import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { it, expect, vi } from 'vitest';
import { definition, ProductEditor, useProductCollection } from '../product/domain';
import { compileCollection, type FlatCollectionContract } from '../system/executable-collection';
import { prepareCollectionAction, useCollection } from '../system/collection-controller';
import { saas } from './contracts';

function BookApp() {
  const controller = useProductCollection();
  return <main><button onClick={controller.startCreate}>New book</button>
    <ProductEditor controller={controller} />
    {controller.notice && <p role={controller.notice.tone === 'error' ? 'alert' : 'status'}>{controller.notice.text}</p>}
    <ul>{controller.records.map((record) => <li key={record.id} aria-label={record.title}>
      {record.title} · {record.author} · {record.category} · {record.borrower || 'Available'}
      <button onClick={() => controller.startEdit(record)}>Edit {record.title}</button>
      <button onClick={() => controller.remove(record)}>Delete {record.title}</button>
      {definition.actions.filter((action) => action.available(record)).map((action) => <button key={action.id} onClick={() => controller.act(record, action.id)}>{action.label} {record.title}</button>)}
    </li>)}</ul>
  </main>;
}
async function create(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole('button', { name: 'New book' }));
  await user.type(screen.getByLabelText('Title'), title);
  await user.type(screen.getByLabelText('Author'), 'Ursula Le Guin');
  await user.type(screen.getByLabelText('Category'), 'Science fiction');
  await user.click(screen.getByRole('button', { name: 'Add book' }));
}

it('[journey_product] exercises real Book forms, nondefault values, hidden borrower editing, return and persistence', async () => {
  const user = userEvent.setup(); const view = render(<BookApp />);
  await create(user, 'The Dispossessed');
  await user.click(screen.getByRole('button', { name: 'Lend The Dispossessed' }));
  await user.click(screen.getByRole('button', { name: 'Lend' }));
  expect(screen.getByLabelText('Borrower')).toHaveAccessibleDescription('Borrower is required.');
  await user.type(screen.getByLabelText('Borrower'), 'Jo{Enter}');
  await user.click(screen.getByRole('button', { name: 'Edit The Dispossessed' }));
  await user.clear(screen.getByLabelText('Category')); await user.type(screen.getByLabelText('Category'), 'Speculative fiction{Enter}');
  expect(screen.getByRole('listitem')).toHaveTextContent('Ursula Le Guin · Speculative fiction · Jo');
  view.unmount(); render(<BookApp />);
  expect(screen.getByRole('listitem')).toHaveTextContent('Jo');
  await user.click(screen.getByRole('button', { name: 'Return The Dispossessed' }));
  expect(screen.getByRole('listitem')).toHaveTextContent('Available');
  await user.click(screen.getByRole('button', { name: 'Delete The Dispossessed' }));
  expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
});

it('preserves draft and saved state on quota failure and permits retry', async () => {
  const user = userEvent.setup(); render(<BookApp />); await create(user, 'First');
  const saved = localStorage.getItem(definition.storageKey);
  await user.click(screen.getByRole('button', { name: 'Lend First' }));
  await user.type(screen.getByLabelText('Borrower'), 'Jo');
  const save = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
  await user.click(screen.getByRole('button', { name: 'Lend' }));
  expect(screen.getByLabelText('Borrower')).toHaveValue('Jo');
  expect(screen.getByRole('listitem')).toHaveTextContent('Available');
  expect(localStorage.getItem(definition.storageKey)).toBe(saved);
  save.mockRestore();
  await user.click(screen.getByRole('button', { name: 'Lend' }));
  expect(screen.getByRole('listitem')).toHaveTextContent('Jo');
});

it('SaaS guards prevent skips and terminal backwards moves, and reload preserves current state', () => {
  const compiled = compileCollection(saas as FlatCollectionContract);
  const view = renderHook(() => useCollection(compiled));
  act(() => view.result.current.startCreate());
  act(() => { expect(view.result.current.submit({ title: 'Export', customer: 'Kestrel', category: 'Reporting', priority: 'high' }).ok).toBe(true); });
  const record = view.result.current.records[0];
  act(() => view.result.current.act(record, 'ship'));
  expect(view.result.current.records[0].status).toBe('inbox');
  for (const [action, state] of [['plan','planned'],['start','in_progress'],['ship','shipped']]) {
    act(() => view.result.current.act(view.result.current.records[0], action));
    expect(view.result.current.records[0].status).toBe(state);
  }
  act(() => view.result.current.act(record, 'plan'));
  expect(view.result.current.records[0].status).toBe('shipped');
  view.unmount();
  expect(renderHook(() => useCollection(compiled)).result.current.records[0]).toMatchObject({ priority: 'high', status: 'shipped', customer: 'Kestrel' });
});

it('complete-record invariant blocks a deliberately invalid action patch without changing the original', () => {
  const compiled = compileCollection({ ...(saas as FlatCollectionContract), invariants: [{ when: { equals: { category: 'Restricted' } }, must: { equals: { status: 'inbox' } }, message: 'Restricted requests remain in inbox.' }] });
  const original = { id: 'one', title: 'Export', customer: 'Kestrel', category: 'Restricted', priority: 'high', status: 'inbox' };
  expect(prepareCollectionAction(compiled, 'plan', original, {})).toMatchObject({ ok: false });
  expect(original.status).toBe('inbox');
});
