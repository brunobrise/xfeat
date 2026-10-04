const crypto = require("crypto");
const fs = require("fs/promises");

// Code-unit string order. Unlike localeCompare it does not depend on the
// machine's ICU locale, which keeps generated output byte-identical everywhere.
function byText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function unquote(value) {
  return String(value)
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .trim();
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

module.exports = { byText, pathExists, sha256, unquote };
