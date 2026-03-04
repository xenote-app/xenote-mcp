var fs = require("fs");
var path = require("path");

var dir = path.join(__dirname, "guides");

var names = ["overview", "elements", "code-and-files", "frontend", "backend", "widget"];

for (var i = 0; i < names.length; i++) {
  exports[names[i]] = fs.readFileSync(path.join(dir, names[i] + ".md"), "utf8");
}
