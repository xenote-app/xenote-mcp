const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase/app');
const f = require('firebase/firestore');
const { createProvider } = require('../provider');

test('provider routes independent agents through the shared attachment and waits for completion', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const uid = 'provider-test-' + Date.now();
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const apps = [];
  function client(name, mcp) {
    const app = initializeApp({ projectId: 'demo-shared-attachment', apiKey: 'test' }, uid + name);
    apps.push(app);
    const db = f.getFirestore(app);
    f.connectFirestoreEmulator(db, host, Number(port), { mockUserToken: { sub: uid, mcp } });
    return db;
  }
  const human = client('human', false);
  const a = createProvider(client('a', true));
  const b = createProvider(client('b', true));
  const ref = f.doc(human, 'mcpPresence', uid, 'attachments', 'browser');
  try {
    assert.equal(await a.getBrowserAttachment(uid), null);
    await f.setDoc(ref, { tabId: 'tab', attachmentId: 'lease', lastSeen: f.Timestamp.now() });
    assert.deepEqual(await a.getBrowserAttachment(uid), { tabId: 'tab', attachmentId: 'lease' });
    assert.deepEqual(await b.getBrowserAttachment(uid), await a.getBrowserAttachment(uid));
    const id = await a.createRunRequest(uid, { targetTabId: 'tab', attachmentId: 'lease', agentId: 'a' });
    const request = f.doc(human, 'mcpPresence', uid, 'requests', id);
    let resolved = false;
    const result = a.waitForRunResult(uid, id, 5000).then((value) => { resolved = true; return value; });
    await f.updateDoc(request, { status: 'running' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(resolved, false);
    await f.updateDoc(request, { status: 'completed', result: 'output' });
    assert.equal((await result).result, 'output');
    await a.deleteRunRequest(uid, id);
    await f.updateDoc(ref, { lastSeen: f.Timestamp.fromMillis(Date.now() - 91000) });
    assert.equal(await b.getBrowserAttachment(uid), null);
    await f.deleteDoc(ref);
    assert.equal(await a.getBrowserAttachment(uid), null);
  } finally {
    await Promise.all(apps.map((app) => f.terminate(f.getFirestore(app))));
    await Promise.all(apps.map(deleteApp));
  }
});
