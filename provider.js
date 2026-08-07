/**
 * Firestore Provider (Client SDK)
 *
 * Factory that returns provider methods bound to a session's Firestore db.
 * All operations go through security rules.
 */

var {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  deleteField,
  increment,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} = require("firebase/firestore");
var { ref, getDownloadURL } = require("firebase/storage");

function createProvider(db, storage) {
  // ── Paths ──────────────────────────────────────────────────────────────

  async function fetchPath(pathKey) {
    var snap = await getDoc(doc(db, "paths", pathKey));
    return snap.exists() ? snap.data() : null;
  }

  // ── Domains ────────────────────────────────────────────────────────────

  async function fetchDomain(domainId) {
    var snap = await getDoc(doc(db, "domains", domainId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async function _updateDomain({ domainId, data }) {
    return await updateDoc(doc(db, "domains", domainId), data);
  }

  // ── Folders ────────────────────────────────────────────────────────────

  async function fetchFolder({ domainId, folderId }) {
    var snap = await getDoc(
      doc(db, "domains", domainId, "folders", folderId),
    );
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async function fetchChildrenFolders({ domainId, folderId }) {
    var q = query(
      collection(db, "domains", domainId, "folders"),
      where("parentId", "==", folderId),
    );
    var snap = await getDocs(q);
    return snap.docs.map(function (d) {
      return { id: d.id, ...d.data() };
    });
  }

  async function fetchChildrenArticles({ domainId, folderId }) {
    var q = query(
      collection(db, "domains", domainId, "articles"),
      where("parentId", "==", folderId),
    );
    var snap = await getDocs(q);
    return snap.docs.map(function (d) {
      return { id: d.id, ...d.data() };
    });
  }

  async function _updateFolder({ domainId, folderId, data }) {
    return await updateDoc(
      doc(db, "domains", domainId, "folders", folderId),
      data,
    );
  }

  // ── Articles ───────────────────────────────────────────────────────────

  async function fetchArticle({ domainId, articleId }) {
    var snap = await getDoc(
      doc(db, "domains", domainId, "articles", articleId),
    );
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async function _updateArticle({ domainId, articleId, data }) {
    return await updateDoc(
      doc(db, "domains", domainId, "articles", articleId),
      data,
    );
  }

  // ── Elements ───────────────────────────────────────────────────────────

  async function fetchArticleElements({ domainId, articleId }) {
    var q = query(
      collection(
        db,
        "domains",
        domainId,
        "articles",
        articleId,
        "elements",
      ),
    );
    var snap = await getDocs(q);
    return snap.docs.map(function (d) {
      return { id: d.id, ...d.data() };
    });
  }

  async function fetchElement({ domainId, articleId, elementId }) {
    var snap = await getDoc(
      doc(
        db,
        "domains",
        domainId,
        "articles",
        articleId,
        "elements",
        elementId,
      ),
    );
    if (!snap.exists()) throw new Error("Element not found: " + elementId);
    return { id: snap.id, ...snap.data() };
  }

  async function createElement({ domainId, articleId, id, data }) {
    var col = collection(
      db,
      "domains",
      domainId,
      "articles",
      articleId,
      "elements",
    );
    if (id) {
      await setDoc(doc(col, id), data);
      return { ...data, id: id };
    }
    var ref = await addDoc(col, data);
    return { ...data, id: ref.id };
  }

  async function _updateElement({ domainId, articleId, elementId, data }) {
    return await updateDoc(
      doc(
        db,
        "domains",
        domainId,
        "articles",
        articleId,
        "elements",
        elementId,
      ),
      data,
    );
  }

  async function _deleteElement({ domainId, articleId, elementId }) {
    return await deleteDoc(
      doc(
        db,
        "domains",
        domainId,
        "articles",
        articleId,
        "elements",
        elementId,
      ),
    );
  }

  // Delete an element tree and remove every deleted ID from the article layout
  // in one transaction. This prevents a partially deleted code container (or a
  // stale layout reference) when a request fails or concurrent edits occur.
  async function deleteElementTree({ domainId, articleId, elementId }) {
    var articleRef = doc(db, "domains", domainId, "articles", articleId);
    var elementsRef = collection(articleRef, "elements");

    // The client SDK's Transaction.get() takes a DocumentReference only — it
    // cannot read a collection (the Admin SDK can, which is an easy trap).
    // Passing a CollectionReference fails deep in the serializer with
    // "Cannot read properties of undefined (reading 'path')", so the child
    // scan happens up front and only the layout read-modify-write stays
    // transactional. A child created after this read would be orphaned rather
    // than cascaded, which is the same exposure as any read-then-write.
    var elementsSnap = await getDocs(elementsRef);
    var all = elementsSnap.docs.map(function (d) {
      return { id: d.id, data: d.data() };
    });
    var deleted = {};
    deleted[elementId] = true;
    var changed = true;
    while (changed) {
      changed = false;
      all.forEach(function (element) {
        if (element.data.parentId && deleted[element.data.parentId] && !deleted[element.id]) {
          deleted[element.id] = true;
          changed = true;
        }
      });
    }

    return runTransaction(db, async function (transaction) {
      var articleSnap = await transaction.get(articleRef);
      if (!articleSnap.exists()) throw new Error("Article not found");
      var elementSnap = await transaction.get(doc(elementsRef, elementId));
      if (!elementSnap.exists()) throw new Error("Element not found: " + elementId);

      // All reads must precede all writes inside a transaction.
      Object.keys(deleted).forEach(function (id) {
        transaction.delete(doc(elementsRef, id));
      });

      // Deleted work still counts as change: fold each element's edit
      // history (+1 per deletion) into the article's deletedEdits odometer.
      var deletedEdits = 0;
      all.forEach(function (element) {
        if (deleted[element.id]) deletedEdits += (element.data.edits || 0) + 1;
      });

      var layout = articleSnap.data().layout || { order: [], type: "scroll" };
      var updatedLayout = Object.assign({}, layout, {
        order: (layout.order || []).filter(function (id) { return !deleted[id]; }),
      });
      if (layout.grid && layout.grid.elements) {
        var gridElements = Object.assign({}, layout.grid.elements);
        Object.keys(deleted).forEach(function (id) { delete gridElements[id]; });
        updatedLayout.grid = Object.assign({}, layout.grid, { elements: gridElements });
      }
      transaction.update(articleRef, {
        layout: updatedLayout,
        deletedEdits: increment(deletedEdits),
      });
      return Object.keys(deleted);
    });
  }

  // ── Versions ───────────────────────────────────────────────────────────

  async function fetchVersions({ domainId, articleId }) {
    var q = query(
      collection(
        db,
        "domains",
        domainId,
        "articles",
        articleId,
        "versions",
      ),
      orderBy("createdAt", "desc"),
    );
    var snap = await getDocs(q);
    return snap.docs.map(function (d) {
      return { id: d.id, ...d.data() };
    });
  }

  async function fetchVersion({ domainId, articleId, versionId }) {
    var snap = await getDoc(
      doc(
        db,
        "domains",
        domainId,
        "articles",
        articleId,
        "versions",
        versionId,
      ),
    );
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async function _updateVersion({ domainId, articleId, versionId, data }) {
    return await updateDoc(
      doc(
        db,
        "domains",
        domainId,
        "articles",
        articleId,
        "versions",
        versionId,
      ),
      data,
    );
  }

  // ── Version Elements (Cloud Storage) ───────────────────────────────────

  // Published element snapshots live in Storage, not Firestore. Storage
  // rules gate reads by canReadDomain — same as the browser viewer.
  async function fetchVersionElements({ domainId, articleId, versionId }) {
    var path =
      "domain/" + domainId + "/article/" + articleId +
      "/version/" + versionId + "/elements.json";
    var url = await getDownloadURL(ref(storage, path));
    var response = await fetch(url);
    if (!response.ok)
      throw new Error(
        "Failed to download published elements (HTTP " + response.status + ")",
      );
    return await response.json(); // { [elementId]: elementData }
  }

  // ── User Info ──────────────────────────────────────────────────────────

  async function fetchUserInfo(uid) {
    var snap = await getDoc(doc(db, "userInfos", uid));
    return snap.exists() ? snap.data() : null;
  }

  async function fetchUserDomains(uid) {
    var q = query(
      collection(db, "userInfos", uid, "domains"),
      orderBy("createdAt"),
    );
    var snap = await getDocs(q);
    return snap.docs.map(function (d) {
      return { id: d.id, ...d.data() };
    });
  }

  // ── Presence ───────────────────────────────────────────────────────────
  //
  // Per-agent model (see presence-redesign.md): one doc per live agent under
  // mcpPresence/{uid}/agents, one heartbeat doc per browser tab under
  // mcpPresence/{uid}/tabs. Attachment is a 1:1 pairing — attachedTabId on
  // the agent entry, tab liveness from the tab doc's heartbeat.

  var ATTACH_LEASE_MS = 90 * 1000;
  var AGENT_TTL_MS = 24 * 60 * 60 * 1000;
  // A new MCP session adopts an existing entry (same token + client) only if
  // that entry has gone quiet — concurrent activity means a genuinely
  // separate window, which stays its own agent.
  var ADOPT_QUIET_MS = 75 * 1000;

  function agentRef(uid, agentId) {
    return doc(db, "mcpPresence", uid, "agents", agentId);
  }

  // Resolve the agent entry for an MCP session. The spec offers no stable
  // per-window identity (clientInfo names the product, session ids churn on
  // reconnect), so: reuse the entry already bound to this sessionId, else
  // adopt a quiet entry with the same token + clientName (a reconnect), else
  // create a fresh entry (a genuinely new agent).
  async function resolveAgent(uid, info) {
    var snapshot = await getDocs(
      query(
        collection(db, "mcpPresence", uid, "agents"),
        where("token", "==", info.token),
      ),
    );
    var candidates = snapshot.docs.map(function (d) {
      return { id: d.id, ...d.data() };
    });

    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].sessionId === info.sessionId) {
        return { agentId: candidates[i].id, isNew: false };
      }
    }

    var now = Date.now();
    for (var j = 0; j < candidates.length; j++) {
      var c = candidates[j];
      if (c.clientName !== (info.clientName || null)) continue;
      var lastSeenMs = c.lastSeen && c.lastSeen.toMillis ? c.lastSeen.toMillis() : 0;
      if (now - lastSeenMs < ADOPT_QUIET_MS) continue;
      // Re-check quietness inside the transaction: two reconnecting sessions
      // may race for the same entry; the loser sees a fresh lastSeen/sessionId
      // and falls through to creating its own.
      var adopted = await runTransaction(db, async function (transaction) {
        var current = await transaction.get(agentRef(uid, c.id));
        if (!current.exists()) return false;
        var data = current.data();
        if (data.sessionId !== c.sessionId) return false;
        var ls = data.lastSeen && data.lastSeen.toMillis ? data.lastSeen.toMillis() : 0;
        if (Date.now() - ls < ADOPT_QUIET_MS) return false;
        transaction.update(agentRef(uid, c.id), {
          sessionId: info.sessionId,
          clientVersion: info.clientVersion || null,
          lastSeen: serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + AGENT_TTL_MS),
        });
        return true;
      });
      if (adopted) return { agentId: c.id, isNew: false };
    }

    var created = await addDoc(collection(db, "mcpPresence", uid, "agents"), {
      token: info.token,
      clientName: info.clientName || null,
      clientVersion: info.clientVersion || null,
      sessionId: info.sessionId,
      toolName: null,
      path: null,
      attachedTabId: null,
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + AGENT_TTL_MS),
    });
    return { agentId: created.id, isNew: true };
  }

  async function updateAgentPresence(uid, agentId, data) {
    var update = {
      lastSeen: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + AGENT_TTL_MS),
    };
    if (data.toolName !== undefined) update.toolName = data.toolName;
    if (data.path !== undefined) update.path = data.path;
    // merge: the browser co-writes attachedTabId into this doc.
    await setDoc(agentRef(uid, agentId), update, { merge: true });
  }

  // The agent's paired tab, if that tab's heartbeat is alive. Lazily clears
  // a pairing whose tab died without running pagehide cleanup — inside a
  // transaction, so a newly attached tab is never detached by a stale check.
  async function getAgentAttachment(uid, agentId) {
    var snap = await getDoc(agentRef(uid, agentId));
    if (!snap.exists()) return null;
    var tabId = snap.data().attachedTabId;
    if (!tabId) return null;

    var tabSnap = await getDoc(doc(db, "mcpPresence", uid, "tabs", tabId));
    var tab = tabSnap.exists() ? tabSnap.data() : null;
    var lastSeenMs =
      tab && tab.lastSeen && tab.lastSeen.toMillis ? tab.lastSeen.toMillis() : 0;
    if (Date.now() - lastSeenMs < ATTACH_LEASE_MS) return { tabId: tabId };

    await runTransaction(db, async function (transaction) {
      var current = await transaction.get(agentRef(uid, agentId));
      if (current.exists() && current.data().attachedTabId === tabId) {
        transaction.update(agentRef(uid, agentId), { attachedTabId: null });
      }
    });
    return null;
  }

  // Append-only event stream: one doc per event under
  // mcpPresence/{uid}/presenceLog. The frontend replays docs it hasn't seen
  // (events can't coalesce away like fields on the state doc). A Firestore
  // TTL policy on expiresAt handles cleanup — lazy deletion, so it caps
  // growth; the frontend filters by createdAt for correctness.
  var LOG_TTL_MS = 24 * 60 * 60 * 1000;

  async function logEvent(uid, event) {
    await addDoc(collection(db, "mcpPresence", uid, "presenceLog"), {
      ...event,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + LOG_TTL_MS),
    });
  }

  // ── Run Requests ───────────────────────────────────────────────────────

  async function createRunRequest(uid, data) {
    var requestId = Math.random().toString(36).slice(2);
    var ref = doc(db, "mcpPresence", uid, "requests", requestId);
    await setDoc(ref, {
      ...data,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    return requestId;
  }

  function waitForRunResult(uid, requestId, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        unsubscribe();
        reject(new Error("Run request timed out. Is a browser tab attached?"));
      }, timeoutMs || 30000);

      var unsubscribe = onSnapshot(
        doc(db, "mcpPresence", uid, "requests", requestId),
        function (snap) {
          var data = snap.data();
          if (!data || data.status === "pending") return;
          clearTimeout(timer);
          unsubscribe();
          resolve(data);
        },
        function (err) {
          clearTimeout(timer);
          unsubscribe();
          reject(err);
        },
      );
    });
  }

  async function deleteRunRequest(uid, requestId) {
    await deleteDoc(doc(db, "mcpPresence", uid, "requests", requestId));
  }

  return {
    fetchPath: fetchPath,
    fetchDomain: fetchDomain,
    updateDomain: _updateDomain,
    fetchFolder: fetchFolder,
    updateFolder: _updateFolder,
    fetchChildrenFolders: fetchChildrenFolders,
    fetchChildrenArticles: fetchChildrenArticles,
    fetchArticle: fetchArticle,
    updateArticle: _updateArticle,
    fetchArticleElements: fetchArticleElements,
    fetchElement: fetchElement,
    createElement: createElement,
    updateElement: _updateElement,
    deleteElement: _deleteElement,
    deleteElementTree: deleteElementTree,
    fetchVersions: fetchVersions,
    fetchVersion: fetchVersion,
    fetchVersionElements: fetchVersionElements,
    updateVersion: _updateVersion,
    fetchUserInfo: fetchUserInfo,
    fetchUserDomains: fetchUserDomains,
    resolveAgent: resolveAgent,
    updateAgentPresence: updateAgentPresence,
    getAgentAttachment: getAgentAttachment,
    logEvent: logEvent,
    createRunRequest: createRunRequest,
    waitForRunResult: waitForRunResult,
    deleteRunRequest: deleteRunRequest,
  };}

module.exports = { createProvider };
