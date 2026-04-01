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
  deleteField,
  onSnapshot,
  serverTimestamp,
} = require("firebase/firestore");

function createProvider(db) {
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

  // ── User Info ──────────────────────────────────────────────────────────

  async function fetchUserInfo(uid) {
    var snap = await getDoc(doc(db, "userInfos", uid));
    return snap.exists() ? snap.data() : null;
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
    if (data.lastAction) presenceData.lastAction = data.lastAction;
    await setDoc(doc(db, "mcpPresence", uid), presenceData, { merge: true });
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
    fetchVersions: fetchVersions,
    fetchVersion: fetchVersion,
    updateVersion: _updateVersion,
    fetchUserInfo: fetchUserInfo,
    getPresence: getPresence,
    setPresence: setPresence,
    clearPresence: clearPresence,
    createRunRequest: createRunRequest,
    waitForRunResult: waitForRunResult,
    deleteRunRequest: deleteRunRequest,
  };}

module.exports = { createProvider };
