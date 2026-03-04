/**
 * MCP Tool Handlers
 *
 * Each handler receives (args, ctx) where ctx = { uid, provider, resolve, functions }.
 * Firestore security rules enforce access — no manual assertAccess needed.
 */

var { httpsCallable } = require("firebase/functions");

// ── Read-only Tools ──────────────────────────────────────────────────────────

async function fetch_handler(args, ctx) {
  var path = args.path;

  // Root: list workspaces
  if (path === "/" || path === "") {
    var userInfo = await ctx.provider.fetchUserInfo(ctx.uid);
    var domainOrder = userInfo && userInfo.domainOrder ? userInfo.domainOrder : [];
    var workspaces = [];
    for (var i = 0; i < domainOrder.length; i++) {
      var d = await ctx.provider.fetchDomain(domainOrder[i]);
      if (d) workspaces.push({ slug: d.slug, title: d.title, id: d.id });
    }
    return { type: "workspaces", workspaces: workspaces };
  }

  // Resolve path to folder or article
  var pathData = await ctx.resolve.resolvePath(path);
  var domainId = pathData.domainId;

  if (pathData.type === "folder") {
    return await fetchFolderContent(ctx, domainId, pathData.folderId, path);
  }

  if (pathData.type !== "article") {
    throw new Error("Unknown path type: " + pathData.type);
  }

  // Article: return metadata + ordered element summaries
  var articleId = pathData.articleId;
  var article = await ctx.provider.fetchArticle({ domainId: domainId, articleId: articleId });
  var elements = await ctx.provider.fetchArticleElements({ domainId: domainId, articleId: articleId });
  var layout = article && article.layout ? article.layout : { order: [], type: "scroll" };
  var order = layout.order || [];

  var byId = {};
  for (var j = 0; j < elements.length; j++) byId[elements[j].id] = elements[j];
  var childrenOf = {};
  for (var k = 0; k < elements.length; k++) {
    if (elements[k].parentId) {
      if (!childrenOf[elements[k].parentId]) childrenOf[elements[k].parentId] = [];
      childrenOf[elements[k].parentId].push(elements[k]);
    }
  }

  var list = [];
  for (var l = 0; l < order.length; l++) {
    var el = byId[order[l]];
    if (!el) continue;
    list.push(summarizeElement(el, childrenOf[el.id]));
    var ch = childrenOf[el.id] || [];
    for (var m = 0; m < ch.length; m++) {
      list.push(summarizeElement(ch[m], null));
    }
  }

  return {
    type: "article",
    id: articleId,
    path: path,
    title: article ? article.title : null,
    description: article ? article.description : null,
    articleContext: article ? article.articleContext || "" : "",
    layout: { type: layout.type || "scroll", config: layout.config || null },
    elements: list,
  };
}

async function public_fetch_handler(args, ctx) {
  var path = args.path;
  if (path.startsWith("/")) path = path.slice(1);
  if (!path) throw new Error("Path is required");

  // Check for @version suffix
  var atIndex = path.indexOf("@");
  var versionSlug = null;
  var basePath = path;
  if (atIndex > 0) {
    versionSlug = path.slice(atIndex + 1);
    basePath = path.slice(0, atIndex);
  }

  var pathKey = basePath.replace(/\//g, "\\");

  if (versionSlug) {
    // Specific version: look up path@slug directly
    var versionPathKey = pathKey + "@" + versionSlug;
    var versionPathData = await ctx.provider.fetchPath(versionPathKey);
    if (!versionPathData) throw new Error("Version not found: " + args.path);

    var ver = await ctx.provider.fetchVersion({
      domainId: versionPathData.domainId,
      articleId: versionPathData.articleId,
      versionId: versionPathData.versionId,
    });
    if (!ver) throw new Error("Version not found: " + args.path);

    return {
      type: "article",
      path: args.path,
      title: ver.article ? ver.article.title : null,
      versionId: ver.id,
      slug: ver.slug,
      label: ver.label,
      notes: ver.notes || null,
      filenames: ver.filenames || [],
      layout: ver.article ? ver.article.layout : null,
    };
  }

  // No version specified: look up the base path
  var pathData = await ctx.provider.fetchPath(pathKey);
  if (!pathData) throw new Error("Path not found: " + args.path);

  if (pathData.type === "folder") {
    return await fetchFolderContent(ctx, pathData.domainId, pathData.folderId, args.path);
  }

  if (pathData.type === "article") {
    if (!pathData.publishedVersionId) {
      throw new Error("Article is not published: " + args.path);
    }

    var version = await ctx.provider.fetchVersion({
      domainId: pathData.domainId,
      articleId: pathData.articleId,
      versionId: pathData.publishedVersionId,
    });
    if (!version) throw new Error("Published version not found");

    return {
      type: "article",
      path: args.path,
      title: version.article ? version.article.title : null,
      versionId: version.id,
      slug: version.slug,
      label: version.label,
      notes: version.notes || null,
      filenames: version.filenames || [],
      layout: version.article ? version.article.layout : null,
    };
  }

  throw new Error("Unknown path type: " + pathData.type);
}

async function element_get(args, ctx) {
  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var el = await ctx.provider.fetchElement({
    domainId: pathData.domainId,
    articleId: pathData.articleId,
    elementId: args.id,
  });

  var isBase64 = el.type === "file" && el.settings && el.settings.isBase64;
  var result = {
    id: el.id,
    type: el.type,
    version: el.version || 0,
    parentId: el.parentId || null,
    content: isBase64 ? "[base64 omitted]" : el.content || null,
    settings: el.settings || null,
    entries: el.entries || null,
  };
  if (isBase64) result.byteSize = (el.content || "").length;
  if (el.editorData !== undefined && el.editorData !== null)
    result.editorData = el.editorData;
  return result;
}

async function fetchFolderContent(ctx, domainId, folderId, path) {
  var folder = await ctx.provider.fetchFolder({ domainId: domainId, folderId: folderId });
  var childFolders = await ctx.provider.fetchChildrenFolders({ domainId: domainId, folderId: folderId });
  var childArticles = await ctx.provider.fetchChildrenArticles({ domainId: domainId, folderId: folderId });

  var children = {};
  for (var i = 0; i < childFolders.length; i++) {
    children[childFolders[i].id] = {
      type: "folder",
      slug: childFolders[i].slug,
      title: childFolders[i].title || null,
    };
  }
  for (var j = 0; j < childArticles.length; j++) {
    children[childArticles[j].id] = {
      type: "article",
      slug: childArticles[j].slug,
      title: childArticles[j].title || null,
      description: childArticles[j].description || null,
      isPublished: !!childArticles[j].publishedVersionId,
    };
  }

  var layoutList = folder && folder.layout && folder.layout.list;
  var items;
  if (layoutList && layoutList.length > 0) {
    items = [];
    for (var k = 0; k < layoutList.length; k++) {
      var item = layoutList[k];
      if (item.type === "section") {
        items.push({ type: "section", title: item.title || null });
      } else if (children[item.id]) {
        items.push(children[item.id]);
      }
    }
  } else {
    items = Object.values(children);
  }

  return {
    type: "folder",
    path: path,
    title: folder ? folder.title : null,
    items: items,
  };
}

// ── Default Settings (mirrors frontend Policies) ────────────────────────────

var defaultImportMap = {
  react: "/libraries/react.development.18.2.0.mjs",
  "react-dom": "/libraries/react-dom.development.18.mjs",
};

var DEFAULT_SETTINGS = {
  text: { alignment: null, spellCheck: true, css: "", columns: null },
  code: {
    layout: "", isHiddenOnPublish: false, isReadOnly: false,
    autoHeight: true, height: 300, hasLineNumbers: false,
    lineWrapping: true, title: "", hasDivider: false,
  },
  file: {
    isBase64: false, isPulled: false, contentType: null,
    mode: null, filename: "", tabMode: null,
  },
  "web-runner": {
    title: "", layout: "dynamic", fixedWidth: 640, fixedHeight: 320,
    alignment: "center", autoHeight: false, height: 320, hasBorder: false,
    runtime: "standard", target: "", classToRender: "",
    importMap: defaultImportMap, useSystemStyles: true,
    isWidget: false, autorun: true,
  },
  "box-runner": {
    command: "", autoHeight: true, height: null, filename: null,
    displayEnv: false, wordWrap: true, pullFiles: [],
  },
  "kernel-runner": {
    tabMode: "4s", hasLineNumbers: false, lineWrapping: true,
    maxOutputHeight: 1000, syncFiles: true,
  },
  images: {
    galleryType: "grid", widthMode: "content", aspectRatio: null,
    alignment: "center", hasBorder: false,
  },
  table: { styling: null, title: "", filename: null },
  iframe: {
    embedUrl: "", widthMode: "content", aspectRatio: "16:9",
    alignment: "center", hasBorder: false,
  },
  excalidraw: {
    maxWidth: null, percentWidth: 100, caption: "",
    alignment: "center", hasBorder: false,
  },
};

// ── Mutation Tools ───────────────────────────────────────────────────────────

async function element_create(args, ctx) {
  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;
  var type = args.type;
  var content = args.content;
  var settings = args.settings;
  var parentId = args.parentId;
  var afterId = args.afterId;

  var defaults = DEFAULT_SETTINGS[type] || {};
  var data = { type: type, version: 0 };
  if (content !== undefined) data.content = content;
  data.settings = Object.assign({}, defaults, settings || {});
  if (parentId) data.parentId = parentId;

  if (type === "file") {
    if (!data.settings.filename) data.settings.filename = "untitled.js";
    var fileResult = await ctx.provider.createElement({
      domainId: domainId,
      articleId: articleId,
      data: data,
    });
    return { id: fileResult.id, type: type, parentId: parentId };
  }

  var result = await ctx.provider.createElement({
    domainId: domainId,
    articleId: articleId,
    data: data,
  });

  var layout = await ctx.resolve.fetchArticleLayout(domainId, articleId);
  var order = (layout.order || []).slice();
  var insertAt = order.length;
  if (afterId) {
    var afterIndex = order.indexOf(afterId);
    if (afterIndex >= 0) insertAt = afterIndex + 1;
  }
  order.splice(insertAt, 0, result.id);
  await ctx.resolve.updateLayout(domainId, articleId, Object.assign({}, layout, { order: order }));

  return { id: result.id, type: type, insertAt: insertAt };
}

async function element_update(args, ctx) {
  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;
  var id = args.id;
  var data = args.data;

  var el = await ctx.provider.fetchElement({
    domainId: domainId,
    articleId: articleId,
    elementId: id,
  });
  var version = (el.version || 0) + 1;

  if (args.expectedVersion !== undefined && el.version !== args.expectedVersion) {
    throw new Error(
      "VERSION_CONFLICT: Element has been modified (expected v" +
        args.expectedVersion + ", now v" + el.version +
        "). Fetch current content and retry.",
    );
  }

  var updateData = { version: version };
  if (data.content !== undefined) updateData.content = data.content;
  if (data.entries !== undefined) updateData.entries = data.entries;
  if (data.settings !== undefined)
    updateData.settings = Object.assign({}, el.settings || {}, data.settings);
  if (data.editorData !== undefined) updateData.editorData = data.editorData;

  await ctx.provider.updateElement({
    domainId: domainId,
    articleId: articleId,
    elementId: id,
    data: updateData,
  });

  return { id: id, appliedData: data };
}

async function element_patch(args, ctx) {
  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;
  var id = args.id;
  var edits = args.edits;

  var el = await ctx.provider.fetchElement({
    domainId: domainId,
    articleId: articleId,
    elementId: id,
  });
  var originalContent = el.content || "";
  var version = (el.version || 0) + 1;

  if (args.expectedVersion !== undefined && el.version !== args.expectedVersion) {
    throw new Error(
      "VERSION_CONFLICT: Element has been modified (expected v" +
        args.expectedVersion + ", now v" + el.version +
        "). Fetch current content and retry.",
    );
  }

  var error = verifyEdits(originalContent, edits);
  if (error) {
    throw new Error(
      "EDIT_FAILED: " + error.message +
        ". Call element_get to see current content, then retry.",
    );
  }

  var newContent = applyEdits(originalContent, edits);
  await ctx.provider.updateElement({
    domainId: domainId,
    articleId: articleId,
    elementId: id,
    data: { content: newContent, version: version },
  });

  return { id: id, edits: edits };
}

async function element_delete(args, ctx) {
  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;
  var id = args.id;

  var elements = await ctx.provider.fetchArticleElements({
    domainId: domainId,
    articleId: articleId,
  });
  var children = elements.filter(function (e) {
    return e.parentId === id;
  });

  await ctx.provider.deleteElement({ domainId: domainId, articleId: articleId, elementId: id });
  for (var i = 0; i < children.length; i++) {
    await ctx.provider.deleteElement({
      domainId: domainId,
      articleId: articleId,
      elementId: children[i].id,
    });
  }

  var layout = await ctx.resolve.fetchArticleLayout(domainId, articleId);
  var order = (layout.order || []).filter(function (oid) { return oid !== id; });
  var updatedLayout = Object.assign({}, layout, { order: order });
  if (updatedLayout.grid && updatedLayout.grid.elements) {
    var gridElements = Object.assign({}, updatedLayout.grid.elements);
    delete gridElements[id];
    updatedLayout.grid = Object.assign({}, updatedLayout.grid, { elements: gridElements });
  }
  await ctx.resolve.updateLayout(domainId, articleId, updatedLayout);

  return { id: id };
}

async function element_move(args, ctx) {
  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;
  var id = args.id;
  var afterId = args.afterId;

  var layout = await ctx.resolve.fetchArticleLayout(domainId, articleId);
  var order = (layout.order || []).slice();

  var sourceIndex = order.indexOf(id);
  if (sourceIndex < 0) throw new Error("Element not in layout order: " + id);
  order.splice(sourceIndex, 1);

  var destIndex;
  if (afterId === null || afterId === undefined) {
    destIndex = 0;
  } else {
    var afterIndex = order.indexOf(afterId);
    destIndex = afterIndex >= 0 ? afterIndex + 1 : order.length;
  }
  order.splice(destIndex, 0, id);

  await ctx.resolve.updateLayout(domainId, articleId, Object.assign({}, layout, { order: order }));

  return { id: id, fromIndex: sourceIndex, toIndex: destIndex };
}

async function article_update(args, ctx) {
  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;

  var update = {};
  if (args.title !== undefined) update.title = args.title;
  if (args.description !== undefined) update.description = args.description;
  if (args.articleContext !== undefined) update.articleContext = args.articleContext;
  if (args.settings !== undefined) {
    var article = await ctx.provider.fetchArticle({ domainId: domainId, articleId: articleId });
    update.settings = Object.assign({}, (article && article.settings) || {}, args.settings);
  }

  if (Object.keys(update).length > 0) {
    await ctx.provider.updateArticle({ domainId: domainId, articleId: articleId, data: update });
  }

  if (args.layoutType || args.layoutConfig) {
    var layout = await ctx.resolve.fetchArticleLayout(domainId, articleId);
    var updatedLayout = Object.assign({}, layout);
    if (args.layoutType) updatedLayout.type = args.layoutType;
    if (args.layoutConfig) {
      updatedLayout.config = Object.assign({}, layout.config || {}, args.layoutConfig);
    }
    await ctx.resolve.updateLayout(domainId, articleId, updatedLayout);
  }

  return { applied: Object.assign({}, update, { layoutType: args.layoutType, layoutConfig: args.layoutConfig }) };
}

async function workspace_updateContext(args, ctx) {
  var domainId;
  if (args.articlePath) {
    var pathData = await ctx.resolve.resolvePath(args.articlePath);
    domainId = pathData.domainId;
  } else {
    domainId = ctx.uid;
  }

  await ctx.provider.updateDomain({
    domainId: domainId,
    data: { projectContext: args.projectContext },
  });

  return { applied: args.projectContext };
}

// ── Version Handler (via Cloud Functions) ────────────────────────────────────

async function version_handler(args, ctx) {
  if (!args.articlePath) throw new Error("articlePath is required for version operations");
  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;
  var action = args.action;

  if (action === "list") {
    var versions = await ctx.provider.fetchVersions({ domainId: domainId, articleId: articleId });
    return {
      versions: versions.map(function (v) {
        return {
          id: v.id, label: v.label, slug: v.slug,
          notes: v.notes, isPublic: v.isPublic || false, createdAt: v.createdAt,
        };
      }),
    };
  }

  if (action === "update") {
    var data = {};
    if (args.label !== undefined) data.label = args.label;
    if (args.notes !== undefined) data.notes = args.notes;
    await ctx.provider.updateVersion({
      domainId: domainId, articleId: articleId, versionId: args.versionId, data: data,
    });
    return { versionId: args.versionId, updated: data };
  }

  if (action === "create") {
    // Auto-generate label and slug like the frontend does
    var label = args.label || "Updates - " + new Date().toLocaleDateString();
    var slug = args.slug;
    if (!slug) {
      var article = await ctx.provider.fetchArticle({ domainId: domainId, articleId: articleId });
      slug = nextVersionSlug(article && article.latestVersion || "");
    }
    var isPublic = args.isPublic !== false;
    var result = await httpsCallable(ctx.functions, "createVersionCall")({
      domainId: domainId, articleId: articleId,
      label: label, slug: slug, notes: args.notes, isPublic: isPublic,
    });
    var versionId = result.data.versionId;
    // Auto-publish when isPublic (matches frontend behavior)
    if (isPublic) {
      await httpsCallable(ctx.functions, "publishVersionCall")({
        domainId: domainId, articleId: articleId, versionId: versionId,
      });
    }
    return { versionId: versionId, label: label, slug: slug, published: isPublic };
  }

  if (action === "delete") {
    await httpsCallable(ctx.functions, "deleteVersionCall")({
      domainId: domainId, articleId: articleId, versionId: args.versionId,
    });
    return { versionId: args.versionId };
  }

  if (action === "revert") {
    await httpsCallable(ctx.functions, "revertToVersionCall")({
      domainId: domainId, articleId: articleId, versionId: args.versionId,
    });
    return { versionId: args.versionId, revertedAt: Date.now() };
  }

  if (action === "publish") {
    await httpsCallable(ctx.functions, "publishVersionCall")({
      domainId: domainId, articleId: articleId, versionId: args.versionId,
    });
    return { versionId: args.versionId };
  }

  if (action === "unpublish") {
    await httpsCallable(ctx.functions, "unpublishArticleCall")({
      domainId: domainId, articleId: articleId,
    });
    return { articleId: articleId };
  }

  throw new Error("Unknown version action: " + action);
}

// ── Folder Handler (via Cloud Functions) ─────────────────────────────────────

async function folder_handler(args, ctx) {
  var action = args.action;

  // Resolve domainId (and parentId for create actions) from path
  var domainId = null;
  var resolvedParentId = null;
  if (args.path) {
    var pathData = await ctx.resolve.resolvePath(args.path);
    domainId = pathData.domainId;
    if (pathData.type === "folder") resolvedParentId = pathData.folderId;
  }
  if (!domainId) throw new Error("path is required for folder operations");

  if (action === "createArticle") {
    var parentId = args.parentId || resolvedParentId;
    if (!parentId) throw new Error("parentId is required, or articlePath must point to a folder");
    var result = await httpsCallable(ctx.functions, "createArticleCall")({
      domainId: domainId, parentId: parentId,
      title: args.title, slug: args.slug,
      description: args.description, layoutType: args.layoutType,
    });
    return result.data;
  }

  if (action === "createFolder") {
    var folderParentId = args.parentId || resolvedParentId;
    if (!folderParentId) throw new Error("parentId is required, or articlePath must point to a folder");
    var result2 = await httpsCallable(ctx.functions, "createFolderCall")({
      domainId: domainId, parentId: folderParentId,
      title: args.title, slug: args.slug,
    });
    return result2.data;
  }

  if (action === "deleteArticle") {
    await httpsCallable(ctx.functions, "deleteArticleCall")({
      domainId: domainId, articleId: args.articleId,
    });
    return { articleId: args.articleId };
  }

  if (action === "deleteFolder") {
    await httpsCallable(ctx.functions, "deleteFolderCall")({
      domainId: domainId, folderId: args.folderId,
    });
    return { folderId: args.folderId };
  }

  if (action === "move") {
    await httpsCallable(ctx.functions, "moveToFolderCall")({
      domainId: domainId, itemId: args.itemId,
      itemType: args.itemType, newParentId: args.newParentId,
    });
    return { itemId: args.itemId, itemType: args.itemType, newParentId: args.newParentId };
  }

  if (action === "renameSlug") {
    await httpsCallable(ctx.functions, "renameSlugCall")({
      domainId: domainId, slug: args.slug,
      articleId: args.articleId, folderId: args.folderId,
    });
    return { slug: args.slug, articleId: args.articleId, folderId: args.folderId };
  }

  throw new Error("Unknown folder action: " + action);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function summarizeElement(el, children) {
  var summary = { id: el.id, type: el.type, version: el.version || 0 };
  if (el.parentId) summary.parentId = el.parentId;

  switch (el.type) {
    case "text":
      summary.lineCount = (el.content || "").split("\n").length;
      summary.charCount = (el.content || "").length;
      summary.preview = (el.content || "").slice(0, 100);
      break;
    case "code":
      summary.settings = { layout: el.settings ? el.settings.layout : undefined };
      summary.files = (children || [])
        .filter(function (c) { return c.type === "file"; })
        .map(function (c) { return c.settings ? c.settings.filename : null; });
      break;
    case "file":
      summary.filename = el.settings ? el.settings.filename : null;
      summary.lineCount = (el.content || "").split("\n").length;
      summary.charCount = (el.content || "").length;
      break;
    case "web-runner":
      summary.target = el.settings ? el.settings.target : null;
      break;
    case "box-runner":
      summary.command = el.settings ? el.settings.command : null;
      break;
    case "kernel-runner":
      summary.lineCount = (el.content || "").split("\n").length;
      summary.charCount = (el.content || "").length;
      break;
    case "images":
      summary.imageCount = el.entries ? el.entries.length : 0;
      break;
    case "table":
      summary.title = el.settings ? el.settings.title : null;
      break;
    case "iframe":
      summary.url = el.settings ? el.settings.url : null;
      break;
  }
  return summary;
}

function verifyEdits(content, edits) {
  for (var i = 0; i < edits.length; i++) {
    var edit = edits[i];
    if (!content.includes(edit.old_string)) {
      return { edit: edit, message: "old_string not found in content. Make sure it matches exactly (including whitespace and indentation)." };
    }
    if (!edit.replace_all) {
      var firstIndex = content.indexOf(edit.old_string);
      var secondIndex = content.indexOf(edit.old_string, firstIndex + 1);
      if (secondIndex !== -1) {
        return { edit: edit, message: "old_string is not unique — found multiple occurrences. Include more surrounding context or use replace_all." };
      }
    }
  }
  return null;
}

function applyEdits(content, edits) {
  for (var i = 0; i < edits.length; i++) {
    if (edits[i].replace_all) {
      content = content.split(edits[i].old_string).join(edits[i].new_string);
    } else {
      content = content.replace(edits[i].old_string, edits[i].new_string);
    }
  }
  return content;
}

var versionRegex = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/;

function nextVersionSlug(latest) {
  var m = latest.match(versionRegex);
  if (!m) return "0.0.0-d.0";
  var devNum = m[5] !== undefined ? parseInt(m[5], 10) : -1;
  return m[1] + "." + m[2] + "." + m[3] + "-" + (m[4] || "d") + "." + (devNum + 1);
}

module.exports = {
  fetch: fetch_handler,
  public_fetch: public_fetch_handler,
  element_get: element_get,
  element_create: element_create,
  element_update: element_update,
  element_patch: element_patch,
  element_delete: element_delete,
  element_move: element_move,
  article_update: article_update,
  workspace_updateContext: workspace_updateContext,
  version: version_handler,
  folder: folder_handler,
};
