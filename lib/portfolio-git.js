const { execFileSync } = require("child_process");

function runGit(repoDir, args) {
  try {
    return execFileSync("git", args, {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15000,
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

// Converts a git remote into a browsable https URL. Embedded credentials are
// always dropped so tokens in remote URLs never reach generated docs.
function normalizeRemote(remote) {
  const value = String(remote || "").trim();
  if (!value) return "";
  let host;
  let repoPath;
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(value);
  if (scp) {
    [, host, repoPath] = scp;
  } else {
    let url;
    try {
      url = new URL(value);
    } catch {
      return "";
    }
    if (!["http:", "https:", "ssh:", "git:"].includes(url.protocol)) return "";
    host = url.hostname;
    repoPath = url.pathname;
  }
  repoPath = repoPath
    .replace(/^\/+/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  if (!host || !repoPath) return "";
  return `https://${host}/${repoPath}`;
}

function permalink(webUrl, sha, file, line = 1) {
  if (!webUrl || !sha || !file) return "";
  const host = new URL(webUrl).hostname;
  if (host === "github.com") return `${webUrl}/blob/${sha}/${file}#L${line}`;
  if (host === "gitlab.com") return `${webUrl}/-/blob/${sha}/${file}#L${line}`;
  if (host === "bitbucket.org") {
    return `${webUrl}/src/${sha}/${file}#lines-${line}`;
  }
  return "";
}

// Reads git metadata for a selected folder. When the folder is a subfolder of
// a larger repository, `prefix` locates it inside that repository and status,
// history, and tracked files are scoped to the subfolder.
function gitInfo(repoDir) {
  const inside = runGit(repoDir, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") {
    return {
      isRepo: false,
      head: "",
      branch: "",
      prefix: "",
      remoteUrl: "",
      lastCommitDate: "",
      dirty: false,
      tracked: new Set(),
    };
  }
  const prefix = (
    runGit(repoDir, ["rev-parse", "--show-prefix"]) || ""
  ).replace(/\/$/, "");
  const head = runGit(repoDir, ["rev-parse", "HEAD"]) || "";
  const status = runGit(repoDir, ["status", "--porcelain", "--", "."]);
  const tracked = runGit(repoDir, ["ls-files", "-z", "--", "."]) || "";
  return {
    isRepo: true,
    head,
    branch: runGit(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]) || "",
    prefix,
    remoteUrl: normalizeRemote(
      runGit(repoDir, ["remote", "get-url", "origin"]),
    ),
    lastCommitDate: head
      ? runGit(repoDir, ["log", "-1", "--format=%cI", "--", "."]) || ""
      : "",
    dirty: Boolean(status),
    tracked: new Set(tracked.split("\0").filter(Boolean)),
  };
}

function parseGitmodules(text) {
  const modules = [];
  let current = null;
  String(text || "")
    .split("\n")
    .forEach((raw, index) => {
      const line = raw.trim();
      const header = /^\[submodule\s+"([^"]+)"\]$/.exec(line);
      if (header) {
        current = { name: header[1], path: "", url: "", line: index + 1 };
        modules.push(current);
        return;
      }
      const pair = /^(path|url)\s*=\s*(.+)$/.exec(line);
      if (current && pair) {
        current[pair[1]] = pair[2].trim();
        if (pair[1] === "url") current.line = index + 1;
      }
    });
  return modules;
}

module.exports = {
  gitInfo,
  normalizeRemote,
  parseGitmodules,
  permalink,
};
