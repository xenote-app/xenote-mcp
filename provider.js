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

    return runTransaction(db, async function (transaction) {
      var articleSnap = await transaction.get(articleRef);
      if (!articleSnap.exists()) throw new Error("Article not found");
      var elementSnap = await transaction.get(doc(elementsRef, elementId));
      if (!elementSnap.exists()) throw new Error("Element not found: " + elementId);
      var elementsSnap = await transaction.get(elementsRef);
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
      all.forEach(function (element) {
        if (deleted[element.id]) transaction.delete(doc(elementsRef, element.id));
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
      transaction.update(articleRef, { layout: updatedLayout });
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

  async function getPresence(uid) {
    var snap = await getDoc(doc(db, "mcpPresence", uid));
    return snap.exists() ? snap.data() : null;
  }
  async function setPresence(uid, data) {
    var presenceData = {
      toolName: data.toolName || null,
      lastSeen: serverTimestamp(),
      connected: true,
    };
    if (data.path !== undefined) presenceData.path = data.path;
    if (data.clientName) presenceData.clientName = data.clientName;
    // merge: the browser tab co-writes attachedTabId into this doc — a plain
    // overwrite would silently detach the tab on every tool call.
    await setDoc(doc(db, "mcpPresence", uid), presenceData, { merge: true });
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

  async function clearPresence(uid) {
    await deleteDoc(doc(db, "mcpPresence", uid));
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
    getPresence: getPresence,
    setPresence: setPresence,
    logEvent: logEvent,
    clearPresence: clearPresence,
    createRunRequest: createRunRequest,
    waitForRunResult: waitForRunResult,
    deleteRunRequest: deleteRunRequest,
  };}

module.exports = { createProvider };
