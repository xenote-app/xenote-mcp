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

async function browserAttachmentStatus(ctx) {
  var attached = !!(await ctx.provider.getActivePresence(ctx.uid));
  return {
    attached: attached,
    message: attached
      ? "An attached browser will receive this file update."
      : "No browser is attached; this file update was saved but was not delivered to a browser.",
  };
}

// ── Read-only Tools ──────────────────────────────────────────────────────────

async function get_guide_handler(args) {
  var guide = args && args.guide;
  var available = Object.keys(guides);
  if (!guide) {
    return (
      "Available guides: " + available.join(", ") + ".\n\n" +
      "Call get_guide({ guide: '<name>' }) to read one."
    );
  }
  if (!guides[guide]) {
    throw new Error(
      "Guide '" + guide + "' not found. Available: " + available.join(", ") + ".",
    );
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
  var list = buildElementSummaries(elements, layout.order || []);

  return {
    type: "article",
    id: articleId,
    path: path,
    editorUrl: "https://www.xenote.com/workspaces" + path,
    title: article ? article.title : null,
    description: article ? article.description : null,
    requiredArticles: article ? article.requiredArticles || [] : [],
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

// Version snapshots are immutable — cache parsed elements.json across
// sessions. Access is authorized before this is reached (path + version doc
// reads go through security rules).
var versionElementsCache = {};
var versionElementsCacheOrder = [];
var VERSION_ELEMENTS_CACHE_MAX = 30;

async function getVersionElements(ctx, domainId, articleId, versionId) {
  var key = domainId + "/" + articleId + "/" + versionId;
  if (versionElementsCache[key]) return versionElementsCache[key];
  var map = await ctx.provider.fetchVersionElements({
    domainId: domainId,
    articleId: articleId,
    versionId: versionId,
  });
  var elements = Object.keys(map).map(function (id) {
    return Object.assign({}, map[id], { id: id });
  });
  versionElementsCache[key] = elements;
  versionElementsCacheOrder.push(key);
  if (versionElementsCacheOrder.length > VERSION_ELEMENTS_CACHE_MAX)
    delete versionElementsCache[versionElementsCacheOrder.shift()];
  return elements;
}

async function publishedArticleResult(ctx, args, basePath, domainId, articleId, ver) {
  var result = {
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
  try {
    var elements = await getVersionElements(ctx, domainId, articleId, ver.id);
    var order =
      (ver.article && ver.article.layout && ver.article.layout.order) || [];
    result.elements = buildElementSummaries(elements, order);
    result.tip =
      "Pass elementId (with this same path) to get an element's full content.";
  } catch (e) {
    result.elementsError = "Element summaries unavailable: " + e.message;
  }
  return result;
}

async function publishedElementResult(ctx, args, domainId, articleId, versionId) {
  var elements = await getVersionElements(ctx, domainId, articleId, versionId);
  var el = null;
  for (var i = 0; i < elements.length; i++) {
    if (elements[i].id === args.elementId) { el = elements[i]; break; }
  }
  if (!el)
    throw new Error(
      "Element '" + args.elementId + "' not found in this published version. " +
        "Fetch the article path (without elementId) to see element summaries and ids.",
    );

  var isBase64 = el.type === "file" && el.settings && el.settings.isBase64;
  var result = {
    id: el.id,
    type: el.type,
    parentId: el.parentId || null,
    settings: el.settings || null,
    entries: el.entries || null,
  };
  if (isBase64) {
    result.content = "[base64 omitted]";
    result.byteSize = (el.content || "").length;
  } else if (el.content) {
    var paged = paginateContent(el.content, args.offset, args.limit);
    result.content = paged.content;
    if (paged.pagination) result.pagination = paged.pagination;
  } else {
    result.content = null;
  }
  if (el.editorData !== undefined && el.editorData !== null)
    result.editorData = el.editorData;
  return result;
}

async function publishedFileResult(ctx, args, articleBasePath, domainId, articleId, ver, filename) {
  var elements = await getVersionElements(ctx, domainId, articleId, ver.id);
  var el = null;
  for (var i = 0; i < elements.length; i++) {
    var e = elements[i];
    if (e.type === "file" && e.settings && e.settings.filename === filename) {
      el = e;
      break;
    }
  }
  if (!el) {
    var known = ver.filenames || [];
    if (known.indexOf(filename) >= 0)
      throw new Error(
        "'" + filename + "' is an uploaded asset in this version — importable by path, but it has no code interface.",
      );
    throw new Error(
      "File '" + filename + "' not found in this published version. Files: " +
        (known.join(", ") || "(none)"),
    );
  }

  var result = {
    type: "file",
    filename: filename,
    elementId: el.id,
    importPath: "/" + articleBasePath + "/" + filename,
    pinnedImportPath: "/" + articleBasePath + "@" + ver.slug + "/" + filename,
  };
  if (el.settings && el.settings.isBase64) {
    result.note = "Binary file — no code interface.";
    result.byteSize = (el.content || "").length;
    return result;
  }
  var content = el.content || "";

  // With a range (offset/limit): return that window of content.
  if (args.offset !== undefined || args.limit !== undefined) {
    var paged = paginateContent(content, args.offset, args.limit);
    result.content = paged.content;
    if (paged.pagination) result.pagination = paged.pagination;
    return result;
  }

  // Without a range: interface view — imports/exports only.
  var lines = content.split("\n");
  var imports = [];
  var exportLines = [];
  for (var l = 0; l < lines.length; l++) {
    var t = lines[l].trim();
    if (t.indexOf("import ") === 0) imports.push(t.slice(0, 200));
    else if (t.indexOf("export ") === 0) exportLines.push(t.slice(0, 200));
  }
  result.lineCount = lines.length;
  result.charCount = content.length;
  result.imports = imports;
  result.exports = exportLines;
  result.tip =
    "Interface view only. For content, add offset/limit, or use elementId '" +
    el.id + "' for the full element.";
  return result;
}

async function public_fetch_handler(args, ctx) {
  var path = args.path;
  if (path.startsWith("/")) path = path.slice(1);
  if (!path) throw new Error("Path is required");

  var fileName = args.filename || null;
  if (args.elementId && fileName)
    throw new Error("Pass either elementId or filename, not both.");

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

    if (fileName)
      return await publishedFileResult(
        ctx, args, basePath, versionPathData.domainId, versionPathData.articleId, ver, fileName,
      );
    if (args.elementId)
      return await publishedElementResult(
        ctx, args, versionPathData.domainId, versionPathData.articleId, ver.id,
      );
    return await publishedArticleResult(
      ctx, args, basePath, versionPathData.domainId, versionPathData.articleId, ver,
    );
  }

  // No version specified: look up the base path
  var pathData = await ctx.provider.fetchPath(pathKey);
  if (!pathData) {
    var lastSeg = path.split("/").pop();
    throw new Error(
      "Path not found: " + args.path +
        (lastSeg.indexOf(".") !== -1
          ? ". That looks like a file path — path must be the article path; pass the file separately: { path: '/" +
            path.slice(0, path.length - lastSeg.length - 1) + "', filename: '" + lastSeg + "' }."
          : ""),
    );
  }

  if (pathData.type === "folder") {
    if (fileName || args.elementId)
      throw new Error(
        (fileName ? "filename" : "elementId") +
          " only applies to article paths — '/" + path + "' is a folder.",
      );
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

    if (fileName)
      return await publishedFileResult(
        ctx, args, basePath, pathData.domainId, pathData.articleId, version, fileName,
      );
    if (args.elementId)
      return await publishedElementResult(
        ctx, args, pathData.domainId, pathData.articleId, version.id,
      );
    return await publishedArticleResult(
      ctx, args, basePath, pathData.domainId, pathData.articleId, version,
    );
  }

  throw new Error("Unknown path type: " + pathData.type);
}

async function element_get(args, ctx) {
  if (!args.articlePath)
    throw new Error(
      "Missing required param 'articlePath'. Got params: " +
        Object.keys(args).join(", ") +
        (args.path !== undefined
          ? ". Note: element_* tools use 'articlePath' (the folder tool uses 'path' — easy to mix up). Did you mean articlePath: '" + args.path + "'?"
          : ""),
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
    settings: el.settings || null,
    entries: el.entries || null,
  };
  if (isBase64) {
    result.content = "[base64 omitted]";
    result.byteSize = (el.content || "").length;
  } else if (el.content) {
    var paged = paginateContent(el.content, args.offset, args.limit);
    result.content = paged.content;
    if (paged.pagination) result.pagination = paged.pagination;
  } else {
    result.content = null;
  }
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
      id: childFolders[i].id,
      slug: childFolders[i].slug,
      title: childFolders[i].title || null,
    };
  }
  for (var j = 0; j < childArticles.length; j++) {
    children[childArticles[j].id] = {
      type: "article",
      id: childArticles[j].id,
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
        items.push(children[item.id]);
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
    // Hidden on publish by default: MCP builds apps/experiences where code is
    // plumbing for a runner, so readers see the output, not the source. Callers
    // pass isReadOnly: false (playground) or true (read-only) to show it.
    isReadOnly: "hidden",
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
        Object.keys(args).join(", ") +
        (args.path !== undefined
          ? ". Note: element_* tools use 'articlePath' (the folder tool uses 'path' — easy to mix up). Did you mean articlePath: '" + args.path + "'?"
          : ""),
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
    var fileCreateResult = {
      id: fileResult.id,
      type: type,
      parentId: parentId,
      editorUrl: "https://www.xenote.com/workspaces" + args.articlePath,
    };
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

  var createResult = {
    id: result.id,
    type: type,
    insertAt: insertAt,
    editorUrl: "https://www.xenote.com/workspaces" + args.articlePath,
  };
  if ((layout.type || "scroll") === "grid") {
    createResult.warning = "This is a grid article. Set the element's position with article_update({ layoutConfig: { grid: { elements: { \"" + result.id + "\": { id: \"" + result.id + "\", x: 0, y: 0, w: 4, h: 4 } } } } }) or it will be invisible.";
  }

  // Contextual tips for complex element types
  var tips = {
    "web-runner":
      "Rules: Don't import React (auto-available). Extension required on all imports: './file.js'. " +
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
      "Best practice: give it a descriptive settings.title naming what it builds (e.g. '3D Lattice Model' or 'Sorting Visualizer') rather than leaving it unset. " +
      "Split files by concern (for a web-runner, that's usually entry, styles, components, data; for a node/python script, it's app + helpers + config). " +
      "Filenames must be unique across the entire article (not just this code element). Use prefixes if multiple code elements need similar files (e.g. 'xor-app.jsx', 'adder-app.jsx'). " +
      "Default to layout: 'collapsed' — it shows the file list and expands to a full IDE on click, keeping the article compact. Use layout: '' only when the code itself is part of the contextual reading (the prose teaches by walking through this code). Not a file-size decision. " +
      "Hidden on the published page by default (readers see the runner's output, not the source; still editable here). To show the code — a coding lesson or an editable playground — set isReadOnly: false (editable) or true (read-only). " +
      "get_guide('code-and-files') covers editing patterns and element_patch usage.",
  };
  if (tips[type]) createResult.tip = tips[type];
  if (type === "code" && !data.settings.title) {
    createResult.recommendation =
      "Add a descriptive settings.title so readers know what this code builds (for example, 'Sorting Visualizer' or '3D Lattice Model').";
  }

  return createResult;
}

function resolveBatchRef(value, created) {
  if (typeof value !== "string" || value.charAt(0) !== "@") return value;
  var idx = parseInt(value.slice(1), 10);
  if (isNaN(idx) || idx < 0 || idx >= created.length) {
    throw new Error(
      "Bad batch reference '" + value + "': index out of range (have " + created.length + " created so far).",
    );
  }
  return created[idx].id;
}

async function elements_create(args, ctx) {
  if (!args.articlePath)
    throw new Error(
      "Missing required param 'articlePath'. Got params: " +
        Object.keys(args).join(", ") +
        (args.path !== undefined
          ? ". Note: element_* tools use 'articlePath' (the folder tool uses 'path' — easy to mix up). Did you mean articlePath: '" + args.path + "'?"
          : ""),
    );
  if (!Array.isArray(args.elements) || args.elements.length === 0)
    throw new Error(
      "Missing or empty 'elements' array. Pass elements: [{ type, content?, settings?, parentId?, afterId? }, ...]. " +
        "Use '@<index>' to reference earlier elements in this batch (e.g. parentId: '@0').",
    );

  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;

  var created = [];

  try {
    for (var i = 0; i < args.elements.length; i++) {
      var spec = args.elements[i];
      var childArgs = Object.assign({}, spec, { articlePath: args.articlePath });
      if (spec.parentId !== undefined) {
        childArgs.parentId = resolveBatchRef(spec.parentId, created);
      }
      if (spec.afterId !== undefined) {
        childArgs.afterId = resolveBatchRef(spec.afterId, created);
      }
      var result = await element_create(childArgs, ctx);
      created.push(result);
    }
  } catch (e) {
    var createdIds = {};
    var deleted = 0;
    for (var r = created.length - 1; r >= 0; r--) {
      createdIds[created[r].id] = true;
      try {
        await ctx.provider.deleteElement({
          domainId: domainId,
          articleId: articleId,
          elementId: created[r].id,
        });
        deleted++;
      } catch (_) { /* best-effort */ }
    }
    // Filter created ids out of the CURRENT layout (don't restore a stale
    // snapshot — would erase any concurrent edits).
    try {
      var currentLayout = await ctx.resolve.fetchArticleLayout(domainId, articleId);
      var newOrder = (currentLayout.order || []).filter(function (oid) {
        return !createdIds[oid];
      });
      var cleanedLayout = Object.assign({}, currentLayout, { order: newOrder });
      if (cleanedLayout.grid && cleanedLayout.grid.elements) {
        var gridElements = Object.assign({}, cleanedLayout.grid.elements);
        for (var gid in createdIds) delete gridElements[gid];
        cleanedLayout.grid = Object.assign({}, cleanedLayout.grid, {
          elements: gridElements,
        });
      }
      await ctx.resolve.updateLayout(domainId, articleId, cleanedLayout);
    } catch (_) { /* best-effort */ }
    throw new Error(
      "Batch create failed at index " + created.length + ": " + e.message +
        ". Rolled back " + deleted + " of " + created.length + " element(s).",
    );
  }

  return { created: created };
}

async function element_update(args, ctx) {
  if (!args.articlePath)
    throw new Error(
      "Missing required param 'articlePath'. Got params: " +
        Object.keys(args).join(", ") +
        (args.path !== undefined
          ? ". Note: element_* tools use 'articlePath' (the folder tool uses 'path' — easy to mix up). Did you mean articlePath: '" + args.path + "'?"
          : ""),
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
    args.data.editorData === undefined &&
    args.data.parentId === undefined
  ) {
    throw new Error(
      "Empty data object — nothing to update. Pass { data: { content, settings, entries, or parentId } }. " +
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

  if (data.parentId !== undefined) {
    if (!data.parentId) {
      throw new Error(
        "parentId must be the ID of another element. Null/empty would orphan this element (file elements aren't in layout.order, so a null-parent file becomes invisible). To remove an element entirely, use element_delete.",
      );
    }
    try {
      await ctx.provider.fetchElement({
        domainId: domainId,
        articleId: articleId,
        elementId: data.parentId,
      });
    } catch (e) {
      throw new Error(
        "parentId '" + data.parentId + "' not found in this article. " +
          "Make sure the new parent element exists before reparenting.",
      );
    }
  }

  var updateData = { version: version };
  if (data.content !== undefined) updateData.content = data.content;
  if (data.entries !== undefined) updateData.entries = data.entries;
  if (data.settings !== undefined) {
    var mergeSettings = typeof data.settings === "string" ? JSON.parse(data.settings) : data.settings;
    updateData.settings = Object.assign({}, el.settings || {}, mergeSettings);
  }
  if (data.editorData !== undefined) updateData.editorData = data.editorData;
  if (data.parentId !== undefined) updateData.parentId = data.parentId;

  await ctx.provider.updateElement({
    domainId: domainId,
    articleId: articleId,
    elementId: id,
    data: updateData,
  });

  // Log the edit so an attached browser tab can react to it.
  if (
    el.type === "file" &&
    data.content !== undefined &&
    el.settings &&
    el.settings.filename
  )
    ctx.provider
      .logEvent(ctx.uid, {
        type: "fileChange",
        path: args.articlePath,
        filename: el.settings.filename,
        version: version,
      })
      .catch(function () {});

  var updateResult = { id: id, appliedData: data };
  if (el.type === "file" && data.content !== undefined) {
    updateResult.browser = await browserAttachmentStatus(ctx);
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
        Object.keys(args).join(", ") +
        (args.path !== undefined
          ? ". Note: element_* tools use 'articlePath' (the folder tool uses 'path' — easy to mix up). Did you mean articlePath: '" + args.path + "'?"
          : ""),
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

  var applied = applyEdits(originalContent, edits);
  if (applied.error) {
    throw new Error(
      "EDIT_FAILED: " +
        applied.error +
        " Check for special characters (×, →, curly quotes, unicode) that may differ from what you expect." +
        " Call element_get to see current content. If matching is difficult, use element_update with full content instead.",
    );
  }

  var newContent = applied.content;
  await ctx.provider.updateElement({
    domainId: domainId,
    articleId: articleId,
    elementId: id,
    data: { content: newContent, version: version },
  });

  if (el.type === "file" && el.settings && el.settings.filename)
    ctx.provider
      .logEvent(ctx.uid, {
        type: "fileChange",
        path: args.articlePath,
        filename: el.settings.filename,
        version: version,
      })
      .catch(function () {});

  var patchResult = { id: id, edits: edits };
  if (el.type === "file") {
    patchResult.browser = await browserAttachmentStatus(ctx);
  }
  return patchResult;
}

async function element_delete(args, ctx) {
  var pathData = await ctx.resolve.resolvePath(args.articlePath);
  var domainId = pathData.domainId;
  var articleId = pathData.articleId;
  var id = args.id;
  var deletedIds = await ctx.provider.deleteElementTree({
    domainId: domainId,
    articleId: articleId,
    elementId: id,
  });
  return { id: id, deletedIds: deletedIds };
}

async function element_move(args, ctx) {
  if (!args.articlePath)
    throw new Error(
      "Missing required param 'articlePath'. Got params: " +
        Object.keys(args).join(", ") +
        (args.path !== undefined
          ? ". Note: element_* tools use 'articlePath' (the folder tool uses 'path' — easy to mix up). Did you mean articlePath: '" + args.path + "'?"
          : ""),
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
  if (!args.path) throw new Error("path is required for workspace_update");
  var pathData = await ctx.resolve.resolvePath(args.path);
  var domainId = pathData.domainId;
  if (pathData.type !== "folder" || pathData.folderId !== domainId) {
    throw new Error(
      "path must be a workspace path, not an article or subfolder: " + args.path,
    );
  }
  var domain = await ctx.provider.fetchDomain(domainId);
  if (!domain) throw new Error("Workspace not found: " + args.path);

  var update = {};
  var previous = {};
  if (args.title !== undefined) {
    update.title = args.title;
    previous.title = domain.title || null;
  }
  if (args.description !== undefined) {
    update.description = args.description;
    previous.description = domain.description || null;
  }

  if (args.theme !== undefined) {
    var currentTheme = domain.theme || {};
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
    previous.theme = currentTheme;
  }

  if (Object.keys(update).length === 0)
    throw new Error("Nothing to update. Provide at least one of: title, description, theme.");

  await ctx.provider.updateDomain({
    domainId: domainId,
    data: update,
  });

  return { workspace: args.path, previous: previous, applied: update };
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
      ctx.provider.logEvent(ctx.uid, {
        type: "published",
        path: args.articlePath,
        slug: args.versionId,
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
      ctx.provider.logEvent(ctx.uid, {
        type: "published",
        path: args.articlePath,
        label: version.label,
        slug: version.slug,
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

// Decode HTML entities that LLMs tend to introduce into plain-text fields
// (e.g. a title "Cats & Dogs" arriving as "Cats &amp; Dogs"). Titles are plain
// text, not HTML, so we normalize them back to real characters.
function decodeEntities(str) {
  if (typeof str !== "string" || str.indexOf("&") === -1) return str;
  var named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, body) {
    if (body.charAt(0) === "#") {
      var code =
        body.charAt(1) === "x" || body.charAt(1) === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      // Out-of-range code points make String.fromCodePoint throw — leave the
      // malformed entity as-is rather than failing the whole tool call.
      return isNaN(code) || code > 0x10ffff ? m : String.fromCodePoint(code);
    }
    var lower = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(named, lower) ? named[lower] : m;
  });
}

// Port of the app's lib/slugify — keeps MCP-generated slugs identical to
// what the editor UI produces.
function slugify(str) {
  var a = "àáâäæãåāăąçćčđďèéêëēėęěğǵḧîïíīįìłḿñńǹňôöòóœøōõőṕŕřßśšşșťțûüùúūǘůűųẃẍÿýžźż·/_,:;";
  var b = "aaaaaaaaaacccddeeeeeeeegghiiiiiilmnnnnoooooooooprrsssssttuuuuuuuuuwxyyzzz------";
  var p = new RegExp(a.split("").join("|"), "g");
  return String(str)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(p, function (c) { return b.charAt(a.indexOf(c)); })
    .replace(/&/g, "-and-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

// Derive a valid, unique slug from a title. Mirrors the app's createSlug:
// slugify, then append -1, -2, … until the path is free. The cloud function
// re-checks for collisions, so the dedup here is best-effort convenience.
async function deriveUniqueSlug(ctx, domainId, parentId, title, kind) {
  var base = slugify(title || "");
  // Leave room for a "-N" dedup suffix within the 64-char limit.
  if (base.length > 62) base = base.slice(0, 62).replace(/-+$/, "");
  if (base.length < 2) {
    throw new Error(
      "Could not derive a valid slug from " + kind + " title " +
        JSON.stringify(title || "") + ". Pass an explicit slug: " +
        "2-64 chars, lowercase letters/numbers/hyphens.",
    );
  }
  var parentFolder = await ctx.provider.fetchFolder({
    domainId: domainId,
    folderId: parentId,
  });
  var basePathKey = parentFolder && parentFolder.path ? parentFolder.path : null;
  if (!basePathKey) return base; // can't dedup — let the cloud function guard
  for (var i = 0; i < 10; i++) {
    var candidate = base + (i ? "-" + i : "");
    var existing = await ctx.provider.fetchPath(basePathKey + "\\" + candidate);
    if (!existing) return candidate;
  }
  throw new Error(
    "Could not find an available slug near '" + base + "' — pass an explicit slug.",
  );
}

async function folder_handler(args, ctx) {
  var action = args.action;

  // createWorkspace needs no path — handle before path resolution
  if (action === "createWorkspace") {
    if (!args.title) throw new Error("title is required for createWorkspace");
    if (!args.slug)
      throw new Error(
        "slug is required for createWorkspace. It becomes the workspace's public base URL " +
          "(xenote.com/<slug>) and can't be freely recycled — confirm it with the user first. " +
          "5-64 chars, lowercase letters/numbers/hyphens.",
      );
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(args.slug) || args.slug.length > 64)
      throw new Error(
        "Invalid slug '" + args.slug + "' — use lowercase letters/numbers/hyphens " +
          "(no leading/trailing hyphen), 5-64 chars.",
      );
    await httpsCallable(ctx.functions, "createDomainCall")({
      slug: args.slug,
      title: args.title,
      isPrimary: false,
    });
    return {
      path: "/" + args.slug,
      slug: args.slug,
      title: args.title,
      editorUrl: "https://www.xenote.com/workspaces/" + args.slug,
      tip: "Add content at path '/" + args.slug + "' — create an article with folder(action: createArticle).",
    };
  }

  // Resolve domainId (and parentId for create actions) from path
  var domainId = null;
  var resolvedParentId = null;
  var createActions = { createArticle: 1, createFolder: 1 };
  if (args.path) {
    var pathData;
    try {
      pathData = await ctx.resolve.resolvePath(args.path);
    } catch (e) {
      // For create actions, path is the existing PARENT container — a bare
      // "Path not found" reads as a tool failure. Clarify that the parent is
      // what's missing, and that the new item's slug must not be in the path.
      // Only rewrite genuine not-found errors; let provider failures through.
      if (createActions[action] && /^Path not found/.test(e.message)) {
        var segs = String(args.path).replace(/^\/+|\/+$/g, "").split("/");
        var parent = "/" + segs.slice(0, -1).join("/");
        throw new Error(
          "Parent path not found: '" + args.path + "'. For " + action +
            ", path must be the EXISTING workspace/folder to create inside — not the new item's path. " +
            "Do not include the new slug in it" +
            (segs.length > 1 ? " (did you mean parent '" + parent + "'?)" : "") +
            ". Check the parent slug is correct; fetch the workspace to list valid paths.",
        );
      }
      throw e;
    }
    domainId = pathData.domainId;
    if (pathData.type === "folder") resolvedParentId = pathData.folderId;
  }
  if (!domainId) throw new Error("path is required for folder operations");

  var needsFolderPath = { addSection: 1, editSection: 1, deleteSection: 1, reorder: 1 };
  if (needsFolderPath[action] && !resolvedParentId)
    throw new Error(
      "path must point to a workspace or folder for " + action +
        " — it resolved to an article. Use a path like '/my-workspace' or '/my-workspace/my-folder'.",
    );

  if (action === "createArticle") {
    var parentId = resolvedParentId;
    if (!parentId)
      throw new Error(
        "path must point to a workspace or folder — that is where the article is created. " +
          "It resolved to an article instead. Use a path like '/my-workspace' or '/my-workspace/my-folder'.",
      );
    if (!args.title)
      throw new Error(
        "title is required for createArticle (it is also used to generate the slug if none is given).",
      );
    var articleSlug = args.slug;
    if (!articleSlug) {
      articleSlug = await deriveUniqueSlug(
        ctx, domainId, parentId, args.title, "article",
      );
    }
    var result = await httpsCallable(
      ctx.functions,
      "createArticleCall",
    )({
      domainId: domainId,
      parentId: parentId,
      title: args.title,
      slug: articleSlug,
      description: args.description,
      layoutType: args.layoutType,
      insertAt: args.insertAt,
    });
    var createResult = result.data;
    var articlePath = args.path.replace(/\/$/, "") + "/" + articleSlug;
    createResult.slug = articleSlug;
    createResult.path = articlePath;
    createResult.editorUrl =
      "https://www.xenote.com/workspaces" + articlePath;
    createResult.tip =
      "Pass this 'path' as the articlePath argument to element_create and other element_* tools.";

    // Attach the folder index with organizing feedback — agents act on tool
    // responses far more reliably than on guides. Best-effort: creation
    // already succeeded, so never fail the call over index feedback.
    try {
      var indexItems =
        (await fetchFolderContent(ctx, domainId, parentId, args.path)).items || [];
      var sectionCount = 0;
      var articleCount = 0;
      var newItemId = null;
      for (var fi = 0; fi < indexItems.length; fi++) {
        if (indexItems[fi].type === "section") {
          sectionCount++;
        } else if (indexItems[fi].type === "article") {
          articleCount++;
          if (indexItems[fi].slug === articleSlug) newItemId = indexItems[fi].id;
        }
      }

      var organizeTip = null;
      if (sectionCount > 0) {
        organizeTip =
          "The article was appended at the end, outside any section (see folderIndex). If it belongs under one, " +
          "reorder with itemId '" + (newItemId || "?") + "' and afterItemId of the section (or an article in it); " +
          "if none fit, addSection — confirm with the user if unsure.";
      } else if (articleCount >= 5) {
        organizeTip =
          articleCount + " articles and no sections — the index is getting hard to scan. Grouping into categories " +
          "(addSection, then reorder articles under them) helps the user; apply if obvious, else suggest one.";
      } else if (articleCount > 1) {
        organizeTip =
          "Appended to the end of the index — reorder (itemId '" + (newItemId || "?") +
          "') if it belongs next to related content.";
      }
      if (organizeTip) {
        createResult.folderIndex = indexItems.map(function (it) {
          return { type: it.type, id: it.id, title: it.title };
        });
        createResult.organizeTip = organizeTip;
      }
    } catch (ignore) {}
    return createResult;
  }

  if (action === "createFolder") {
    var folderParentId = resolvedParentId;
    if (!folderParentId)
      throw new Error(
        "path must point to a workspace or folder — that is where the folder is created. " +
          "It resolved to an article instead. Use a path like '/my-workspace' or '/my-workspace/my-folder'.",
      );
    var folderSlug = args.slug;
    if (!folderSlug) {
      if (!args.title)
        throw new Error(
          "createFolder requires a title (used to generate the slug) or an explicit slug.",
        );
      folderSlug = await deriveUniqueSlug(
        ctx, domainId, folderParentId, args.title, "folder",
      );
    }
    var result2 = await httpsCallable(
      ctx.functions,
      "createFolderCall",
    )({
      domainId: domainId,
      parentId: folderParentId,
      title: args.title,
      slug: folderSlug,
    });
    var folderResult = result2.data;
    var folderPath = args.path.replace(/\/$/, "") + "/" + folderSlug;
    if (folderResult && typeof folderResult === "object") {
      folderResult.slug = folderSlug;
      folderResult.path = folderPath;
    }
    return folderResult;
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

// Order elements by layout order, with each parent's children listed after it.
function buildElementSummaries(elements, order) {
  var byId = {};
  var childrenOf = {};
  for (var i = 0; i < elements.length; i++) {
    byId[elements[i].id] = elements[i];
    if (elements[i].parentId) {
      if (!childrenOf[elements[i].parentId])
        childrenOf[elements[i].parentId] = [];
      childrenOf[elements[i].parentId].push(elements[i]);
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
  return list;
}

// Cap returned content size with line-based paging. Always returns at least
// one line so paging progresses even on absurdly long single lines.
var MAX_CONTENT_CHARS = 50000;

function paginateContent(content, offset, limit) {
  var lines = content.split("\n");
  var start = Math.max(0, offset || 0);
  var maxLines = limit || Infinity;
  var out = [];
  var chars = 0;
  var i = start;
  while (i < lines.length && out.length < maxLines) {
    chars += lines[i].length + 1;
    if (out.length > 0 && chars > MAX_CONTENT_CHARS) break;
    out.push(lines[i]);
    i++;
  }
  var result = { content: out.join("\n") };
  if (start > 0 || i < lines.length) {
    result.pagination = {
      offset: start,
      returnedLines: out.length,
      totalLines: lines.length,
      truncated: i < lines.length,
    };
    if (i < lines.length)
      result.pagination.tip =
        "Content continues — call again with offset: " + i + ".";
  }
  return result;
}

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

// Apply edits sequentially — edit N runs against the content edits 1..N-1
// produced. All-or-nothing: returns { error } before any edit is considered
// applied, or { content } with the final result.
function applyEdits(content, edits) {
  for (var i = 0; i < edits.length; i++) {
    var edit = edits[i];
    if (!edit.old_string) {
      return { error: "Edit " + (i + 1) + ": old_string must be a non-empty string." };
    }
    if (!content.includes(edit.old_string)) {
      return {
        error:
          "Edit " + (i + 1) + ": old_string not found in content" +
          (i > 0 ? " (as it stands after the preceding edits)" : "") +
          ". Make sure it matches exactly (including whitespace and indentation).",
      };
    }
    if (!edit.replace_all) {
      var firstIndex = content.indexOf(edit.old_string);
      var secondIndex = content.indexOf(edit.old_string, firstIndex + 1);
      if (secondIndex !== -1) {
        return {
          error:
            "Edit " + (i + 1) + ": old_string is not unique — found multiple occurrences. Include more surrounding context or use replace_all.",
        };
      }
    }
    content = edit.replace_all
      ? content.split(edit.old_string).join(edit.new_string)
      : content.replace(edit.old_string, edit.new_string);
  }
  return { content: content };
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
  elements_create: elements_create,
  element_update: element_update,
  element_patch: element_patch,
  element_delete: element_delete,
  element_move: element_move,
  article_update: article_update,
  workspace_update: workspace_update,
  version: version_handler,
  folder: folder_handler,
  element_run: element_run,
  decodeEntities: decodeEntities,
};

async function element_run(args, ctx) {
  var articlePath = args.articlePath;
  var elementId = args.id;
  if (!articlePath) throw new Error("articlePath is required");
  if (!elementId) throw new Error("id is required");

  // Check if a browser tab is attached
  var presenceSnap = await ctx.provider.getActivePresence(ctx.uid);
  if (!presenceSnap) {
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
