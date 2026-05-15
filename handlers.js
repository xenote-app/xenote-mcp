/**
 * MCP Tool Handlers
 *
 * Each handler receives (args, ctx) where ctx = { uid, provider, resolve, functions }.
 * Firestore security rules enforce access — no manual assertAccess needed.
 */

var { httpsCallable } = require("firebase/functions");
var guides = require("./guides");

// ── Typography Presets (mirrors app presets) ─────────────────────────────────

var TYPOGRAPHY_PRESETS = [
  {
    id: "editorial",
    theme: { font: "Source+Serif+Pro", headerFont: "Merriweather", headerFontWeight: "700", codeFont: "Source+Code+Pro" },
  },
  {
    id: "elegant",
    theme: { font: "Lora", headerFont: "Playfair+Display", headerFontWeight: "600", codeFont: "Inconsolata" },
  },
  {
    id: "technical",
    theme: { font: "IBM+Plex+Sans", headerFont: "JetBrains+Mono", headerFontWeight: "500", codeFont: "JetBrains+Mono" },
  },
  {
    id: "journal",
    theme: { font: "Alegreya", headerFont: "Alegreya", headerFontWeight: "700", codeFont: "IBM+Plex+Mono" },
  },
  {
    id: "system",
    theme: { font: null, headerFont: null, headerFontWeight: null, codeFont: null },
  },
];

function resolveTypographyPreset(theme) {
  for (var i = 0; i < TYPOGRAPHY_PRESETS.length; i++) {
    var preset = TYPOGRAPHY_PRESETS[i];
    var match = true;
    for (var k in preset.theme) {
      if (preset.theme[k] && preset.theme[k] !== (theme[k] || null)) { match = false; break; }
      if (!preset.theme[k] && theme[k]) { match = false; break; }
    }
    if (match) return preset.id;
  }
  return "custom";
}

function expandTypographyPreset(presetId) {
  for (var i = 0; i < TYPOGRAPHY_PRESETS.length; i++) {
    if (TYPOGRAPHY_PRESETS[i].id === presetId) return TYPOGRAPHY_PRESETS[i].theme;
  }
  return null;
}

// ── Read-only Tools ──────────────────────────────────────────────────────────

async function get_guide_handler(args) {
  var guide = args.guide;
  if (!guides[guide]) {
    throw new Error("Guide not found: " + guide);
  }
  return guides[guide];
}

async function fetch_handler(args, ctx) {
  var path = args.path;

  // Root: list workspaces
  if (path === "/" || path === "") {
    var userInfo = await ctx.provider.fetchUserInfo(ctx.uid);
    var userDomains = await ctx.provider.fetchUserDomains(ctx.uid);
    var domainOrder =
      userInfo && userInfo.domainOrder ? userInfo.domainOrder : [];

    // Union: domainOrder first (preserves user-set order, includes external
    // domains not in the subcollection), then subcollection ids not yet in
    // domainOrder (newly created workspaces).
    var seen = {};
    var orderedIds = [];
    for (var i = 0; i < domainOrder.length; i++) {
      if (!seen[domainOrder[i]]) {
        seen[domainOrder[i]] = true;
        orderedIds.push(domainOrder[i]);
      }
    }
    for (var n = 0; n < userDomains.length; n++) {
      if (!seen[userDomains[n].id]) {
        seen[userDomains[n].id] = true;
        orderedIds.push(userDomains[n].id);
      }
    }

    var workspaces = [];
    for (var j = 0; j < orderedIds.length; j++) {
      var d = await ctx.provider.fetchDomain(orderedIds[j]);
      if (d) workspaces.push({ slug: d.slug, title: d.title, description: d.description || null, id: d.id });
    }
    var userName = (userInfo && userInfo.name) || (ctx.user && ctx.user.name) || null;
    var userEmail = ctx.user && ctx.user.email || null;
    return {
      type: "workspaces",
      user: { name: userName, email: userEmail },
      workspaces: workspaces,
    };
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
  var article = await ctx.provider.fetchArticle({
    domainId: domainId,
    articleId: articleId,
  });
  var elements = await ctx.provider.fetchArticleElements({
    domainId: domainId,
    articleId: articleId,
  });
  var layout =
    article && article.layout ? article.layout : { order: [], type: "scroll" };
  var order = layout.order || [];

  var byId = {};
  for (var j = 0; j < elements.length; j++) byId[elements[j].id] = elements[j];
  var childrenOf = {};
  for (var k = 0; k < elements.length; k++) {
    if (elements[k].parentId) {
      if (!childrenOf[elements[k].parentId])
        childrenOf[elements[k].parentId] = [];
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
    editorUrl: "https://www.xenote.com/workspaces" + path,
    title: article ? article.title : null,
    description: article ? article.description : null,
    requiredArticles: article ? article.requiredArticles || [] : [],
    articleContext: article ? article.articleContext || "" : "",
    layout: {
      type: layout.type || "scroll",
      pageWidth: layout.pageWidth || "normal",
      hideTitle: layout.hideTitle || false,
      grid: layout.grid ? {
        cols: layout.grid.cols || 12,
        cell: layout.grid.cell || null,
        elements: layout.grid.elements || null,
      } : null,
    },
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
      publicUrl: "https://xenote.com/" + basePath,
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
    return await fetchFolderContent(
      ctx,
      pathData.domainId,
      pathData.folderId,
      args.path,
    );
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
      publicUrl: "https://xenote.com/" + basePath,
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
  if (!args.articlePath)
    throw new Error(
      "Missing required param 'articlePath'. Got params: " +
        Object.keys(args).join(", "),
    );
  if (!args.id)
    throw new Error(
      "Missing required param 'id'. Got params: " +
        Object.keys(args).join(", "),
    );
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
  var folder = await ctx.provider.fetchFolder({
    domainId: domainId,
    folderId: folderId,
  });
  var childFolders = await ctx.provider.fetchChildrenFolders({
    domainId: domainId,
    folderId: folderId,
  });
  var childArticles = await ctx.provider.fetchChildrenArticles({
    domainId: domainId,
    folderId: folderId,
  });

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
      requiredArticles: childArticles[j].requiredArticles || [],
    };
  }

  var layoutList = folder && folder.layout && folder.layout.list;
  var items;
  if (layoutList && layoutList.length > 0) {
    items = [];
    for (var k = 0; k < layoutList.length; k++) {
      var item = layoutList[k];
      if (item.type === "section") {
        items.push({ type: "section", id: item.id, title: item.title || null });
      } else if (children[item.id]) {
        var child = children[item.id];
        child.id = item.id;
        items.push(child);
      }
    }
  } else {
    items = Object.values(children);
  }

  var title = folder ? folder.title : null;
  var description = null;
  var theme = null;
  if (domainId === folderId) {
    var domain = await ctx.provider.fetchDomain(domainId);
    if (domain) {
      title = domain.title || title;
      description = domain.description || null;
      var dt = domain.theme || {};
      theme = {
        coverPageLayout: dt.coverPageLayout || "standard",
        typography: resolveTypographyPreset(dt),
        linkColor: dt.linkColor || "blue",
      };
    }
  }

  return {
    type: "folder",
    path: path,
    title: title,
    description: description,
    theme: theme,
    items: items,
  };
}

// ── Default Settings (mirrors frontend Policies) ────────────────────────────

var defaultImportMap = {
  react: "/libraries/react.19.mjs",
  "react-dom": "/libraries/react-dom.19.mjs",
};

var DEFAULT_SETTINGS = {
  text: { alignment: null, spellCheck: true, css: "", columns: null },
  code: {
    layout: "",
    isReadOnly: false,
    autoHeight: true,
    height: 300,
    hasLineNumbers: false,
    lineWrapping: true,
    title: "",
    hasDivider: false,
  },
  file: {
    isBase64: false,
    isPulled: false,
    contentType: null,
    mode: null,
    filename: "",
    tabMode: null,
  },
  "web-runner": {
    title: "",
    layout: "dynamic",
    width: 640,
    height: 320,
    alignment: "center",
    autoHeight: false,
    hasBorder: false,
    runtime: "standard",
    target: "",
    classToRender: "",
    importMap: defaultImportMap,
    useSystemStyles: true,
    isChromeless: false,
    autorun: true,
    allowFullscreen: false,
  },
  "box-runner": {
    command: "",
    autoHeight: true,
    height: null,
    filename: null,
    displayEnv: false,
    wordWrap: true,
    pullFiles: [],
  },
  "kernel-runner": {
    tabMode: "4s",
    hasLineNumbers: false,
    lineWrapping: true,
    maxOutputHeight: 1000,
    syncFiles: true,
  },
  images: {
    galleryType: "grid",
    widthMode: "content",
    aspectRatio: null,
    alignment: "center",
    hasBorder: false,
    fitting: "cover",
    fillerColor: null,
  },
  iframe: {
    embedUrl: "",
    widthMode: "content",
    aspectRatio: "16:9",
    alignment: "center",
    hasBorder: false,
  },
  excalidraw: {
    maxWidth: null,
    percentWidth: 100,
    caption: "",
    alignment: "center",
    hasBorder: false,
    hasPadding: true,
    backgroundColor: null,
  },
};

// ── Mutation Tools ───────────────────────────────────────────────────────────

async function element_create(args, ctx) {
  if (!args.articlePath)
    throw new Error(
      "Missing required param 'articlePath'. Got params: " +
        Object.keys(args).join(", "),
    );
  if (!args.type)
    throw new Error(
      "Missing required param 'type'. Got params: " +
        Object.keys(args).join(", "),
    );

  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;
  var type = args.type;
  var content = args.content;
  var settings = typeof args.settings === "string" ? JSON.parse(args.settings) : args.settings;
  var parentId = args.parentId;
  var afterId = args.afterId;

  // Validate parentId for file elements
  if (type === "file" && !parentId) {
    throw new Error(
      "file elements require a parentId (the code element ID). " +
        "Create a code element first, then create the file with parentId set to the code element's ID.",
    );
  }

  // Validate parentId exists if provided
  if (parentId) {
    try {
      var parentEl = await ctx.provider.fetchElement({
        domainId: domainId,
        articleId: articleId,
        elementId: parentId,
      });
    } catch (e) {
      throw new Error(
        "parentId '" + parentId + "' not found in this article. " +
          "Make sure the parent element exists before creating a child.",
      );
    }
  }

  var defaults = DEFAULT_SETTINGS[type] || {};
  var data = { type: type, version: 0 };
  if (content !== undefined) data.content = content;
  data.settings = Object.assign({}, defaults, settings || {});
  if (type === "web-runner" && settings && settings.importMap) {
    data.settings.importMap = Object.assign({}, defaultImportMap, settings.importMap);
  }
  if (parentId) data.parentId = parentId;

  if (type === "file") {
    if (!data.settings.filename) data.settings.filename = "untitled.js";
    // Check for duplicate filenames — filenames are scoped to the article, not the code element
    var existingElements = await ctx.provider.fetchArticleElements({
      domainId: domainId,
      articleId: articleId,
    });
    for (var fi = 0; fi < existingElements.length; fi++) {
      if (
        existingElements[fi].type === "file" &&
        existingElements[fi].settings &&
        existingElements[fi].settings.filename === data.settings.filename
      ) {
        throw new Error(
          "Duplicate filename '" + data.settings.filename + "' — filenames must be unique across the entire article, not just within a code element. " +
            "Use distinct names like 'xor-app.jsx' and 'adder-app.jsx', or group all related files under one code element.",
        );
      }
    }
    var fileResult = await ctx.provider.createElement({
      domainId: domainId,
      articleId: articleId,
      data: data,
    });
    var fileCreateResult = { id: fileResult.id, type: type, parentId: parentId };
    var lineCount = (content || "").split("\n").length;
    if (lineCount > 150) {
      fileCreateResult.warning =
        "This file is " + lineCount + " lines. Split large files into smaller ones (entry, styles, components, utils) for easier patching and readability.";
    }
    return fileCreateResult;
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
  await ctx.resolve.updateLayout(
    domainId,
    articleId,
    Object.assign({}, layout, { order: order }),
  );

  var createResult = { id: result.id, type: type, insertAt: insertAt };
  if ((layout.type || "scroll") === "grid") {
    createResult.warning = "This is a grid article. Set the element's position with article_update({ layoutConfig: { grid: { elements: { \"" + result.id + "\": { id: \"" + result.id + "\", x: 0, y: 0, w: 4, h: 4 } } } } }) or it will be invisible.";
  }

  // Contextual tips for complex element types
  var tips = {
    "web-runner":
      "Rules: Don't import React (auto-available). Extension required on all imports: './file.js'. " +
      "CSS must be imported in entry file: import './styles.css'. " +
      "Use isChromeless: true + autoHeight: true for embedded feel. " +
      "import '/core/style/base.css' for theming and dark mode. " +
      "get_guide('frontend') covers importMap, cross-article imports, Gen AI API, and debug loop.",
    "box-runner":
      "Rules: Needs a connected machine (user manages from ENV panel). " +
      "All article files sync to sandbox folder. Use isPulled: true on file elements to fetch output back. " +
      "get_guide('backend') covers machines, Vani messaging, and env vars.",
    "kernel-runner":
      "Rules: Content is Python code directly on this element — no parentId or file elements needed. " +
      "Needs a connected machine. Variables persist across cells in the same article. " +
      "get_guide('backend') covers machines, rich output, and env vars.",
    code:
      "Rules: This is a container — add file children with parentId set to this element's ID. " +
      "Always split into multiple files: entry (.jsx), styles (.css), data (.js), components (.jsx). " +
      "Filenames must be unique across the entire article (not just this code element). Use prefixes if multiple code elements need similar files (e.g. 'xor-app.jsx', 'adder-app.jsx'). " +
      "get_guide('code-and-files') covers editing patterns and element_patch usage.",
  };
  if (tips[type]) createResult.tip = tips[type];

  return createResult;
}

async function element_update(args, ctx) {
  if (!args.articlePath)
    throw new Error(
      "Missing required param 'articlePath'. Got params: " +
        Object.keys(args).join(", "),
    );
  if (!args.id)
    throw new Error(
      "Missing required param 'id'. Got params: " +
        Object.keys(args).join(", "),
    );
  if (!args.data) {
    // Check if they passed content/settings at top level instead of inside data
    var hint =
      args.content !== undefined || args.settings !== undefined
        ? " It looks like you passed content/settings at the top level — they must be nested inside 'data', e.g. { data: { content: ... } }."
        : "";
    throw new Error("Missing required param 'data'." + hint);
  }
  // Reject empty data — this is always a mistake
  if (
    args.data.content === undefined &&
    args.data.settings === undefined &&
    args.data.entries === undefined &&
    args.data.editorData === undefined
  ) {
    throw new Error(
      "Empty data object — nothing to update. Pass { data: { content, settings, or entries } }. " +
        "If you're trying to diagnose an issue, use element_get to read current content instead.",
    );
  }
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

  if (
    args.expectedVersion !== undefined &&
    el.version !== args.expectedVersion
  ) {
    throw new Error(
      "VERSION_CONFLICT: Element has been modified (expected v" +
        args.expectedVersion +
        ", now v" +
        el.version +
        "). Fetch current content and retry.",
    );
  }

  var updateData = { version: version };
  if (data.content !== undefined) updateData.content = data.content;
  if (data.entries !== undefined) updateData.entries = data.entries;
  if (data.settings !== undefined) {
    var mergeSettings = typeof data.settings === "string" ? JSON.parse(data.settings) : data.settings;
    updateData.settings = Object.assign({}, el.settings || {}, mergeSettings);
  }
  if (data.editorData !== undefined) updateData.editorData = data.editorData;

  await ctx.provider.updateElement({
    domainId: domainId,
    articleId: articleId,
    elementId: id,
    data: updateData,
  });

  var updateResult = { id: id, appliedData: data };
  if (el.type === "file" && data.content !== undefined) {
    var updatedLineCount = data.content.split("\n").length;
    if (updatedLineCount > 150) {
      updateResult.warning =
        "This file is now " + updatedLineCount + " lines. Consider splitting into smaller files for easier patching and readability.";
    }
  }
  return updateResult;
}

async function element_patch(args, ctx) {
  if (!args.articlePath)
    throw new Error(
      "Missing required param 'articlePath'. Got params: " +
        Object.keys(args).join(", "),
    );
  if (!args.id)
    throw new Error(
      "Missing required param 'id'. Got params: " +
        Object.keys(args).join(", "),
    );
  if (!args.edits || !Array.isArray(args.edits) || args.edits.length === 0)
    throw new Error("Missing or empty 'edits' array.");
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

  if (
    args.expectedVersion !== undefined &&
    el.version !== args.expectedVersion
  ) {
    throw new Error(
      "VERSION_CONFLICT: Element has been modified (expected v" +
        args.expectedVersion +
        ", now v" +
        el.version +
        "). Fetch current content and retry.",
    );
  }

  var error = verifyEdits(originalContent, edits);
  if (error) {
    throw new Error(
      "EDIT_FAILED: " +
        error.message +
        " Check for special characters (×, →, curly quotes, unicode) that may differ from what you expect." +
        " Call element_get to see current content. If matching is difficult, use element_update with full content instead.",
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

  await ctx.provider.deleteElement({
    domainId: domainId,
    articleId: articleId,
    elementId: id,
  });
  for (var i = 0; i < children.length; i++) {
    await ctx.provider.deleteElement({
      domainId: domainId,
      articleId: articleId,
      elementId: children[i].id,
    });
  }

  var layout = await ctx.resolve.fetchArticleLayout(domainId, articleId);
  var order = (layout.order || []).filter(function (oid) {
    return oid !== id;
  });
  var updatedLayout = Object.assign({}, layout, { order: order });
  if (updatedLayout.grid && updatedLayout.grid.elements) {
    var gridElements = Object.assign({}, updatedLayout.grid.elements);
    delete gridElements[id];
    updatedLayout.grid = Object.assign({}, updatedLayout.grid, {
      elements: gridElements,
    });
  }
  await ctx.resolve.updateLayout(domainId, articleId, updatedLayout);

  return { id: id };
}

async function element_move(args, ctx) {
  if (!args.articlePath)
    throw new Error(
      "Missing required param 'articlePath'. Got params: " +
        Object.keys(args).join(", "),
    );
  if (!args.id)
    throw new Error(
      "Missing required param 'id'. Got params: " +
        Object.keys(args).join(", "),
    );

  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;
  var id = args.id;
  var afterId = args.afterId;
  var index = args.index;

  var layout = await ctx.resolve.fetchArticleLayout(domainId, articleId);
  var order = (layout.order || []).slice();

  var sourceIndex = order.indexOf(id);
  if (sourceIndex < 0) throw new Error("Element not in layout order: " + id);
  order.splice(sourceIndex, 1);

  var destIndex;
  if (index !== undefined && index !== null) {
    // Direct index positioning
    destIndex = Math.max(0, Math.min(index, order.length));
  } else if (afterId !== undefined && afterId !== null) {
    // Position after a specific element
    var afterIndex = order.indexOf(afterId);
    if (afterIndex < 0)
      throw new Error(
        "afterId '" + afterId + "' not found in layout order. " +
          "Current order: [" + order.join(", ") + "]",
      );
    destIndex = afterIndex + 1;
  } else {
    // Neither specified — move to start
    destIndex = 0;
  }
  order.splice(destIndex, 0, id);

  await ctx.resolve.updateLayout(
    domainId,
    articleId,
    Object.assign({}, layout, { order: order }),
  );

  return { id: id, fromIndex: sourceIndex, toIndex: destIndex };
}

async function article_update(args, ctx) {
  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;

  var update = {};
  if (args.title !== undefined) update.title = args.title;
  if (args.description !== undefined) update.description = args.description;
  if (args.articleContext !== undefined)
    update.articleContext = args.articleContext;
  if (args.requiredArticles !== undefined) {
    if (!Array.isArray(args.requiredArticles))
      throw new Error("requiredArticles must be an array of article IDs.");
    update.requiredArticles = args.requiredArticles;
  }
  if (args.settings !== undefined) {
    var articleSettings = typeof args.settings === "string" ? JSON.parse(args.settings) : args.settings;
    var article = await ctx.provider.fetchArticle({
      domainId: domainId,
      articleId: articleId,
    });
    update.settings = Object.assign(
      {},
      (article && article.settings) || {},
      articleSettings,
    );
  }

  if (Object.keys(update).length > 0) {
    await ctx.provider.updateArticle({
      domainId: domainId,
      articleId: articleId,
      data: update,
    });
  }

  if (args.layoutType || args.layoutConfig || args.pageWidth || args.hideTitle !== undefined) {
    var layout = await ctx.resolve.fetchArticleLayout(domainId, articleId);
    var updatedLayout = Object.assign({}, layout);
    if (args.layoutType) updatedLayout.type = args.layoutType;
    if (args.pageWidth) updatedLayout.pageWidth = args.pageWidth;
    if (args.hideTitle !== undefined) updatedLayout.hideTitle = args.hideTitle;
    if (args.layoutConfig) {
      // Grid element positions — accept both layoutConfig.grid.elements and layoutConfig.elements
      var gridElements = null;
      var gridCols = undefined;
      if (args.layoutConfig.grid) {
        gridElements = args.layoutConfig.grid.elements || null;
        gridCols = args.layoutConfig.grid.cols;
      } else if (args.layoutConfig.elements) {
        gridElements = args.layoutConfig.elements;
      }

      if (gridElements || gridCols !== undefined) {
        var existingGrid = layout.grid || {};
        updatedLayout.grid = Object.assign({}, existingGrid);
        if (gridElements) {
          var existingElements = existingGrid.elements || {};
          updatedLayout.grid.elements = Object.assign({}, existingElements, gridElements);
        }
        if (gridCols !== undefined) {
          updatedLayout.grid.cols = gridCols;
        }
      }
    }
    await ctx.resolve.updateLayout(domainId, articleId, updatedLayout);
  }

  return {
    applied: Object.assign({}, update, {
      layoutType: args.layoutType,
      layoutConfig: args.layoutConfig,
    }),
  };
}

async function workspace_update(args, ctx) {
  var domainId;
  if (args.articlePath) {
    var pathData = await ctx.resolve.resolvePath(args.articlePath);
    domainId = pathData.domainId;
  } else {
    domainId = ctx.uid;
  }

  var update = {};
  if (args.title !== undefined) update.title = args.title;
  if (args.description !== undefined) update.description = args.description;

  if (args.theme !== undefined) {
    var domain = await ctx.provider.fetchDomain(domainId);
    var currentTheme = (domain && domain.theme) || {};
    var themeUpdate = {};

    if (args.theme.coverPageLayout !== undefined)
      themeUpdate.coverPageLayout = args.theme.coverPageLayout;
    if (args.theme.linkColor !== undefined)
      themeUpdate.linkColor = args.theme.linkColor;
    if (args.theme.typography !== undefined) {
      var typo = expandTypographyPreset(args.theme.typography);
      if (!typo)
        throw new Error(
          "Unknown typography preset: '" + args.theme.typography + "'. " +
            "Options: editorial, elegant, technical, journal, system.",
        );
      Object.assign(themeUpdate, typo);
    }

    update.theme = Object.assign({}, currentTheme, themeUpdate);
  }

  if (Object.keys(update).length === 0)
    throw new Error("Nothing to update. Provide at least one of: title, description, theme.");

  await ctx.provider.updateDomain({
    domainId: domainId,
    data: update,
  });

  return { applied: update };
}

// ── Version Handler (via Cloud Functions) ────────────────────────────────────

async function version_handler(args, ctx) {
  if (!args.articlePath)
    throw new Error("articlePath is required for version operations");
  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;
  var action = args.action;

  if (action === "list") {
    var article = await ctx.provider.fetchArticle({
      domainId: domainId,
      articleId: articleId,
    });
    var publishedVersionId = article ? article.publishedVersionId : null;
    var versions = await ctx.provider.fetchVersions({
      domainId: domainId,
      articleId: articleId,
    });
    return {
      versions: versions.map(function (v) {
        return {
          id: v.id,
          label: v.label,
          slug: v.slug,
          notes: v.notes,
          isPublic: v.isPublic || false,
          isPublished: v.id === publishedVersionId,
          createdAt: v.createdAt,
        };
      }),
    };
  }

  if (action === "update") {
    if (!args.versionId)
      throw new Error("versionId is required for update");
    var data = {};
    if (args.label !== undefined) data.label = args.label;
    if (args.notes !== undefined) data.notes = args.notes;
    if (Object.keys(data).length > 0) {
      await ctx.provider.updateVersion({
        domainId: domainId,
        articleId: articleId,
        versionId: args.versionId,
        data: data,
      });
    }
    if (args.isPublished === true) {
      await httpsCallable(
        ctx.functions,
        "publishVersionCall",
      )({
        domainId: domainId,
        articleId: articleId,
        versionId: args.versionId,
      });
      data.isPublished = true;
      ctx.provider.setPresence(ctx.uid, {
        toolName: "version",
        path: args.articlePath,
        lastAction: { type: "published", slug: args.versionId },
      }).catch(function () {});
    } else if (args.isPublished === false) {
      await httpsCallable(
        ctx.functions,
        "unpublishArticleCall",
      )({
        domainId: domainId,
        articleId: articleId,
      });
      data.isPublished = false;
    }
    return { versionId: args.versionId, updated: data };
  }

  if (action === "create") {
    // Auto-generate label and slug like the frontend does
    var label = args.label || "Updates - " + new Date().toLocaleDateString();
    var slug = args.slug;
    if (!slug) {
      var article = await ctx.provider.fetchArticle({
        domainId: domainId,
        articleId: articleId,
      });
      slug = nextVersionSlug((article && article.latestVersion) || "");
    }
    var isPublic = args.isPublic !== false;
    var result;
    try {
      result = await httpsCallable(
        ctx.functions,
        "createVersionCall",
      )({
        domainId: domainId,
        articleId: articleId,
        label: label,
        slug: slug,
        notes: args.notes,
        isPublic: isPublic,
      });
    } catch (e) {
      throw new Error(
        "version create failed: " + (e.message || e.code || String(e)) +
          ". Params sent: domainId=" + domainId +
          ", articleId=" + articleId +
          ", slug=" + slug +
          ", isPublic=" + isPublic,
      );
    }
    var version = result.data.version;
    var versionId = version.id;
    // Auto-publish when isPublic (matches frontend behavior)
    if (isPublic) {
      try {
        await httpsCallable(
          ctx.functions,
          "publishVersionCall",
        )({
          domainId: domainId,
          articleId: articleId,
          versionId: versionId,
        });
      } catch (e) {
        throw new Error(
          "version created (id=" + versionId + ") but publish failed: " +
            (e.message || e.code || String(e)),
        );
      }
    }
    var versionResult = {
      versionId: versionId,
      label: version.label,
      slug: version.slug,
      notes: version.notes || null,
      filenames: version.filenames || [],
      dvMap: version.dvMap || null,
      isPublic: isPublic,
      isPublished: isPublic,
    };
    if (isPublic) {
      versionResult.publicUrl =
        "https://xenote.com/" + args.articlePath.replace(/^\//, "");
      versionResult.tip =
        "If other articles import from this one, they must also be republished to pick up these changes. " +
        "Their published versions still point to the previous snapshot until you republish them.";
      ctx.provider.setPresence(ctx.uid, {
        toolName: "version",
        path: args.articlePath,
        lastAction: { type: "published", label: version.label, slug: version.slug },
      }).catch(function () {});
    }
    return versionResult;
  }

  if (action === "delete") {
    await httpsCallable(
      ctx.functions,
      "deleteVersionCall",
    )({
      domainId: domainId,
      articleId: articleId,
      versionId: args.versionId,
    });
    return { versionId: args.versionId };
  }

  if (action === "revert") {
    await httpsCallable(
      ctx.functions,
      "revertToVersionCall",
    )({
      domainId: domainId,
      articleId: articleId,
      versionId: args.versionId,
    });
    return { versionId: args.versionId, revertedAt: Date.now() };
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
    if (!parentId)
      throw new Error(
        "parentId is required, or articlePath must point to a folder",
      );
    var result = await httpsCallable(
      ctx.functions,
      "createArticleCall",
    )({
      domainId: domainId,
      parentId: parentId,
      title: args.title,
      slug: args.slug,
      description: args.description,
      layoutType: args.layoutType,
      insertAt: args.insertAt,
    });
    var createResult = result.data;
    if (args.slug && args.path) {
      createResult.editorUrl =
        "https://www.xenote.com/workspaces" + args.path + "/" + args.slug;
    }
    return createResult;
  }

  if (action === "createFolder") {
    var folderParentId = args.parentId || resolvedParentId;
    if (!folderParentId)
      throw new Error(
        "parentId is required, or articlePath must point to a folder",
      );
    var result2 = await httpsCallable(
      ctx.functions,
      "createFolderCall",
    )({
      domainId: domainId,
      parentId: folderParentId,
      title: args.title,
      slug: args.slug,
    });
    return result2.data;
  }

  if (action === "deleteArticle") {
    await httpsCallable(
      ctx.functions,
      "deleteArticleCall",
    )({
      domainId: domainId,
      articleId: args.articleId,
    });
    return { articleId: args.articleId };
  }

  if (action === "deleteFolder") {
    await httpsCallable(
      ctx.functions,
      "deleteFolderCall",
    )({
      domainId: domainId,
      folderId: args.folderId,
    });
    return { folderId: args.folderId };
  }

  if (action === "move") {
    await httpsCallable(
      ctx.functions,
      "moveToFolderCall",
    )({
      domainId: domainId,
      itemId: args.itemId,
      itemType: args.itemType,
      newParentId: args.newParentId,
    });
    return {
      itemId: args.itemId,
      itemType: args.itemType,
      newParentId: args.newParentId,
    };
  }

  if (action === "addSection") {
    if (!args.title) throw new Error("title is required for addSection");
    var folder = await ctx.provider.fetchFolder({
      domainId: domainId,
      folderId: resolvedParentId,
    });
    if (!folder) throw new Error("Folder not found");
    var layout = folder.layout || {};
    var list = (layout.list || []).slice();

    var sectionId = String(Date.now());
    var section = {
      type: "section",
      id: sectionId,
      title: args.title,
      displayMode: args.displayMode || "list",
      showDesc: args.showDesc !== undefined ? args.showDesc : false,
      showThumb: args.showThumb !== undefined ? args.showThumb : false,
      isHidden: args.isHidden !== undefined ? args.isHidden : false,
    };

    if (args.insertAt !== undefined && args.insertAt !== null) {
      var idx = Math.max(0, Math.min(args.insertAt, list.length));
      list.splice(idx, 0, section);
    } else {
      list.push(section);
    }

    await ctx.provider.updateFolder({
      domainId: domainId,
      folderId: resolvedParentId,
      data: { layout: Object.assign({}, layout, { list: list }) },
    });
    return { sectionId: sectionId, title: args.title, insertAt: idx !== undefined ? idx : list.length - 1 };
  }

  if (action === "editSection") {
    if (!args.sectionId) throw new Error("sectionId is required for editSection");
    var folder = await ctx.provider.fetchFolder({
      domainId: domainId,
      folderId: resolvedParentId,
    });
    if (!folder) throw new Error("Folder not found");
    var layout = folder.layout || {};
    var list = (layout.list || []).slice();

    var sectionIndex = -1;
    for (var si = 0; si < list.length; si++) {
      if (list[si].id === args.sectionId && list[si].type === "section") {
        sectionIndex = si;
        break;
      }
    }
    if (sectionIndex < 0)
      throw new Error("Section '" + args.sectionId + "' not found in folder layout.");

    var updated = Object.assign({}, list[sectionIndex]);
    if (args.title !== undefined) updated.title = args.title;
    if (args.displayMode !== undefined) updated.displayMode = args.displayMode;
    if (args.showDesc !== undefined) updated.showDesc = args.showDesc;
    if (args.showThumb !== undefined) updated.showThumb = args.showThumb;
    if (args.isHidden !== undefined) updated.isHidden = args.isHidden;
    list[sectionIndex] = updated;

    await ctx.provider.updateFolder({
      domainId: domainId,
      folderId: resolvedParentId,
      data: { layout: Object.assign({}, layout, { list: list }) },
    });
    return { sectionId: args.sectionId, updated: updated };
  }

  if (action === "deleteSection") {
    if (!args.sectionId) throw new Error("sectionId is required for deleteSection");
    var folder = await ctx.provider.fetchFolder({
      domainId: domainId,
      folderId: resolvedParentId,
    });
    if (!folder) throw new Error("Folder not found");
    var layout = folder.layout || {};
    var list = (layout.list || []).filter(function (item) {
      return item.id !== args.sectionId;
    });

    await ctx.provider.updateFolder({
      domainId: domainId,
      folderId: resolvedParentId,
      data: { layout: Object.assign({}, layout, { list: list }) },
    });
    return { sectionId: args.sectionId };
  }

  if (action === "reorder") {
    if (!args.itemId) throw new Error("itemId is required for reorder");
    var folder = await ctx.provider.fetchFolder({
      domainId: domainId,
      folderId: resolvedParentId,
    });
    if (!folder) throw new Error("Folder not found");
    var layout = folder.layout || {};
    var list = (layout.list || []).slice();

    var sourceIndex = -1;
    for (var ri = 0; ri < list.length; ri++) {
      if (list[ri].id === args.itemId) { sourceIndex = ri; break; }
    }
    if (sourceIndex < 0)
      throw new Error(
        "itemId '" + args.itemId + "' not found in folder layout. " +
          "Current items: " + list.map(function (i) { return i.id; }).join(", "),
      );

    var item = list[sourceIndex];
    list.splice(sourceIndex, 1);

    var destIndex;
    if (args.afterItemId !== undefined && args.afterItemId !== null) {
      var afterIdx = -1;
      for (var ai = 0; ai < list.length; ai++) {
        if (list[ai].id === args.afterItemId) { afterIdx = ai; break; }
      }
      if (afterIdx < 0)
        throw new Error(
          "afterItemId '" + args.afterItemId + "' not found in folder layout.",
        );
      destIndex = afterIdx + 1;
    } else if (args.index !== undefined && args.index !== null) {
      destIndex = Math.max(0, Math.min(args.index, list.length));
    } else {
      destIndex = 0;
    }

    list.splice(destIndex, 0, item);
    await ctx.provider.updateFolder({
      domainId: domainId,
      folderId: resolvedParentId,
      data: { layout: Object.assign({}, layout, { list: list }) },
    });
    return {
      itemId: args.itemId,
      fromIndex: sourceIndex,
      toIndex: destIndex,
    };
  }

  if (action === "renameSlug") {
    await httpsCallable(
      ctx.functions,
      "renameSlugCall",
    )({
      domainId: domainId,
      slug: args.slug,
      articleId: args.articleId,
      folderId: args.folderId,
    });
    return {
      slug: args.slug,
      articleId: args.articleId,
      folderId: args.folderId,
    };
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
      summary.settings = {
        layout: el.settings ? el.settings.layout : undefined,
      };
      summary.files = (children || [])
        .filter(function (c) {
          return c.type === "file";
        })
        .map(function (c) {
          return c.settings ? c.settings.filename : null;
        });
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
    case "iframe":
      summary.embedUrl = el.settings ? el.settings.embedUrl : null;
      break;
  }
  return summary;
}

function verifyEdits(content, edits) {
  for (var i = 0; i < edits.length; i++) {
    var edit = edits[i];
    if (!content.includes(edit.old_string)) {
      return {
        edit: edit,
        message:
          "old_string not found in content. Make sure it matches exactly (including whitespace and indentation).",
      };
    }
    if (!edit.replace_all) {
      var firstIndex = content.indexOf(edit.old_string);
      var secondIndex = content.indexOf(edit.old_string, firstIndex + 1);
      if (secondIndex !== -1) {
        return {
          edit: edit,
          message:
            "old_string is not unique — found multiple occurrences. Include more surrounding context or use replace_all.",
        };
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
  return (
    m[1] + "." + m[2] + "." + m[3] + "-" + (m[4] || "d") + "." + (devNum + 1)
  );
}

module.exports = {
  get_guide: get_guide_handler,
  fetch: fetch_handler,
  public_fetch: public_fetch_handler,
  element_get: element_get,
  element_create: element_create,
  element_update: element_update,
  element_patch: element_patch,
  element_delete: element_delete,
  element_move: element_move,
  article_update: article_update,
  workspace_update: workspace_update,
  version: version_handler,
  folder: folder_handler,
  element_run: element_run,
};

async function element_run(args, ctx) {
  var articlePath = args.articlePath;
  var elementId = args.id;
  if (!articlePath) throw new Error("articlePath is required");
  if (!elementId) throw new Error("id is required");

  // Check if a browser tab is attached
  var presenceSnap = await ctx.provider.getPresence(ctx.uid);
  if (!presenceSnap || !presenceSnap.attachedTabId) {
    throw new Error(
      "No browser tab is attached. Open Xenote in a browser and click Attach on the presence indicator.",
    );
  }

  var pathData = await ctx.resolve.resolvePath(articlePath);

  // Verify element exists and is a runner type
  var element = await ctx.provider.fetchElement({
    domainId: pathData.domainId,
    articleId: pathData.articleId,
    elementId: elementId,
  });
  var runnerTypes = ["web-runner", "box-runner", "kernel-runner"];
  if (runnerTypes.indexOf(element.type) === -1) {
    throw new Error(
      "element_run only works on runner elements (" +
        runnerTypes.join(", ") +
        "). This element is type: " +
        element.type,
    );
  }

  // Create run request and wait for browser to execute
  var requestId = await ctx.provider.createRunRequest(ctx.uid, {
    articlePath: articlePath,
    elementId: elementId,
    elementType: element.type,
  });

  try {
    var result = await ctx.provider.waitForRunResult(ctx.uid, requestId, 10000);
    // Clean up
    ctx.provider.deleteRunRequest(ctx.uid, requestId).catch(function () {});

    if (result.status === "error") {
      throw new Error(result.error || "Execution failed");
    }
    return result.result || "Executed successfully";
  } catch (e) {
    ctx.provider.deleteRunRequest(ctx.uid, requestId).catch(function () {});
    throw e;
  }
}
