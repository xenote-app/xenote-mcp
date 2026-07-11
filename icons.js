// Xenote logo, served to MCP clients as themed icons (see Implementation.icons).
// Two variants so the client can pick the right one for its UI theme:
//   theme "light" -> light background -> dark-colored mark
//   theme "dark"  -> dark background  -> light-colored mark
// Path is the Xenote mark from the notebook app (public/favicon.svg).

var LOGO_PATH =
  "M1.52447 12.8773L12.5427 19.2386L25 11.3633M1.34964 16.3899L12.3678 22.7512L24.8252 14.8759M1.17482 19.9025L12.193 26.2638L24.6504 18.3885M12.9711 4.19511L13.538 7.73683M13.538 7.73683L14.0341 10.8358M13.538 7.73683L18.2953 8.02237M13.538 7.73683L8.10121 7.4105M1.13425 9.03847L12.1524 15.3998L24.6098 7.52446L13.3091 1L1.13425 9.03847Z";

function svg(stroke, strokeWidth) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 28">' +
    '<path d="' +
    LOGO_PATH +
    '" fill="none" stroke="' +
    stroke +
    '" stroke-width="' +
    strokeWidth +
    '" stroke-linejoin="round"/>' +
    "</svg>"
  );
}

function dataUri(svgStr) {
  return "data:image/svg+xml;base64," + Buffer.from(svgStr).toString("base64");
}

// zinc-900 mark for light UIs, zinc-100 mark for dark UIs
var icons = [
  {
    src: dataUri(svg("#18181b", "1.2")),
    mimeType: "image/svg+xml",
    sizes: ["any"],
    theme: "light",
  },
  {
    src: dataUri(svg("#f4f4f5", "0.9")),
    mimeType: "image/svg+xml",
    sizes: ["any"],
    theme: "dark",
  },
];

module.exports = { icons: icons };
