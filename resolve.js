/**
 * Path Resolution
 *
 * Resolves /workspace-slug/article-slug paths to { domainId, articleId }.
 * Access control is handled by Firestore security rules (client SDK).
 */

function createResolve(provider) {
  async function resolvePath(path) {
    var p = path.startsWith("/") ? path.slice(1) : path;
    if (!p) throw new Error("Empty path");

    var pathKey = p.replace(/\//g, "\\");
    var pathData = await provider.fetchPath(pathKey);

    if (!pathData) throw new Error("Path not found: " + path);

    return pathData;
  }

  async function fetchArticleLayout(domainId, articleId) {
    var article = await provider.fetchArticle({ domainId: domainId, articleId: articleId });
    return (article && article.layout) || { order: [], type: "scroll" };
  }

  async function updateLayout(domainId, articleId, layout) {
    return provider.updateArticle({
      domainId: domainId,
      articleId: articleId,
      data: { layout: layout },
    });
  }

  return {
    resolvePath: resolvePath,
    fetchArticleLayout: fetchArticleLayout,
    updateLayout: updateLayout,
  };
}

module.exports = { createResolve };
