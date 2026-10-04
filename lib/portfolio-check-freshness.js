const fs = require("fs/promises");
const path = require("path");
const { loadPortfolioSelection } = require("./portfolio-selection");
const { buildPortfolioModel } = require("./portfolio-model");
const { buildChecks, unknownClaimFindings } = require("./portfolio-checks");
const { byText } = require("./portfolio-util");

const CHECKS_FILE = "checks.json";

function wellFormed(check) {
  return (
    check !== null &&
    typeof check === "object" &&
    typeof check.id === "string" &&
    Array.isArray(check.claims) &&
    check.claims.every((claim) => typeof claim === "string")
  );
}

// Reads checks.json when the last scan wrote it. Every claim a check cites
// must exist in portfolio.json; otherwise the check can never be verified.
// Returns null when there is nothing valid to compare against.
async function readChecks(outDir, status, findings) {
  if (!(status.documents || []).includes(CHECKS_FILE)) return null;
  let data;
  try {
    data = JSON.parse(
      await fs.readFile(path.join(outDir, CHECKS_FILE), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") {
      findings.push({ type: "invalid-checks", path: CHECKS_FILE });
    }
    return null;
  }
  if (!Array.isArray(data?.checks) || !data.checks.every(wellFormed)) {
    findings.push({ type: "invalid-checks", path: CHECKS_FILE });
    return null;
  }
  const claimIds = new Set(status.claims.map((claim) => claim.id));
  findings.push(...unknownClaimFindings(data.checks, claimIds));
  return { focus: data.focus, checks: data.checks };
}

// Line hashes cannot see a fact that was added: a new dependency changes no
// cited line, yet makes dependency and impact answers incomplete. Rebuilding
// the model read-only from the same selection and recomputing the checks
// catches it. A changed or removed answer is blocking; new checks and a new
// focus repository are reported as warnings.
async function checkFreshness(outDir, status, stored) {
  // A scan may combine a manifest with extra paths or --from folders, so the
  // stored repositories are always passed too. The loader puts manifest
  // entries first and drops duplicates, which reproduces the original order
  // and therefore the original repository names.
  const selection = await loadPortfolioSelection({
    ...(status.manifest
      ? { manifest: path.resolve(outDir, status.manifest) }
      : {}),
    paths: status.repos.map((repo) => path.resolve(outDir, repo.path)),
    cwd: outDir,
  });
  const plan = buildChecks(await buildPortfolioModel(selection));
  const before = new Map(stored.checks.map((c) => [c.id, JSON.stringify(c)]));
  const after = new Map(plan.checks.map((c) => [c.id, JSON.stringify(c)]));
  const findings = [];
  for (const [id, body] of before) {
    if (!after.has(id)) {
      findings.push({ type: "stale-check", check: id, reason: "removed" });
    } else if (after.get(id) !== body) {
      findings.push({ type: "stale-check", check: id, reason: "changed" });
    }
  }
  const warnings = [];
  const added = [...after.keys()].filter((id) => !before.has(id));
  if (added.length) {
    warnings.push({ type: "new-checks", checks: added.sort(byText) });
  }
  if (plan.focus !== stored.focus) {
    warnings.push({
      type: "focus-changed",
      from: stored.focus,
      to: plan.focus,
    });
  }
  return { findings, warnings };
}

module.exports = { CHECKS_FILE, checkFreshness, readChecks };
