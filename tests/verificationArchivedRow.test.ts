import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotionLeadStore, toLeadRecord } from '../src/lib/verification/notionLead.ts';

const page = {
  id: 'test-page',
  properties: {
    Email: { title: [{ plain_text: 'test@example.test' }] },
    'Verification status': { select: { name: 'pending' } },
    'Email verified': { checkbox: false },
  },
};

test('an archived or trashed Notion signup cannot be returned for verification', async () => {
  for (const archived of [{ archived: true }, { in_trash: true }]) {
    const raw = { ...page, ...archived };
    assert.equal(toLeadRecord(raw), undefined);
    const store = createNotionLeadStore(async () => raw, 'test-db');
    assert.equal(await store.reread(page.id), undefined);
  }
});

test('active and legacy Notion page responses remain readable', () => {
  assert.equal(toLeadRecord(page)?.email, 'test@example.test');
  assert.equal(toLeadRecord({ ...page, archived: false, in_trash: false })?.status, 'pending');
});
