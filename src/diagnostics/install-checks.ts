export interface CheckResult {
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DiscoveryDiagnosis {
  id: string;
  title: string;
  checks: Record<string, CheckResult>;
  grade: "pass" | "warn" | "fail";
}

export interface IssueDiagnosis {
  issueId: string;
  name: string;
  date: string;
  discoveries: DiscoveryDiagnosis[];
  summary: { pass: number; warn: number; fail: number };
}

interface DiscoveryInput {
  id: string;
  title: string;
  install?: { steps?: string[] };
  source: { url: string };
}

interface IssueInput {
  id: string;
  name: string;
  date: string;
  discoveries: DiscoveryInput[];
}

const COMMENT_RE = /^#/;
const PLACEHOLDER_KEYWORD_RE = /^#\s*(check|see|visit|follow|refer|note|todo|fixme|\s*$)/i;

export function detectPlaceholders(steps: string[]): CheckResult {
  if (steps.length === 0) {
    return { status: "fail", message: "no steps" };
  }
  const placeholders = steps.filter(s => PLACEHOLDER_KEYWORD_RE.test(s.trim()));
  if (placeholders.length === 0) {
    return { status: "pass", message: "none" };
  }
  const isMajority = placeholders.length * 2 >= steps.length;
  return {
    status: isMajority ? "fail" : "warn",
    message: `${placeholders.length} of ${steps.length} steps are placeholders`,
  };
}

export function checkStepCompleteness(steps: string[]): CheckResult {
  if (steps.length === 0) {
    return { status: "fail", message: "no steps" };
  }
  const runnable = steps.filter(s => {
    const t = s.trim();
    return t.length > 0 && !COMMENT_RE.test(t);
  });
  if (runnable.length === 0) {
    return { status: "fail", message: "all steps are placeholders" };
  }
  if (runnable.length === 1) {
    return { status: "warn", message: "only 1 runnable command" };
  }
  return { status: "pass", message: `${runnable.length} runnable commands` };
}

export function checkCommandSyntax(steps: string[]): CheckResult | null {
  const issues: string[] = [];
  for (const step of steps) {
    const t = step.trim();
    if (/^git clone\s*$/i.test(t)) {
      issues.push("git clone missing URL");
    } else {
      const cloneMatch = t.match(/^git clone\s+(\S+)/i);
      if (cloneMatch) {
        const arg = cloneMatch[1];
        if (!arg.startsWith("http") && !arg.startsWith("git@") && !arg.startsWith("ssh://")) {
          issues.push(`git clone suspect arg: ${arg}`);
        }
      }
    }
  }
  if (issues.length === 0) return null;
  return { status: "fail", message: issues.join("; ") };
}

export async function checkUrlLiveness(url: string): Promise<CheckResult> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
    if (res.status >= 200 && res.status < 300) {
      return { status: "pass", message: String(res.status) };
    }
    if (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) {
      return { status: "warn", message: `${res.status} redirect` };
    }
    if (res.status === 404) {
      return { status: "fail", message: "404 not found" };
    }
    return { status: "warn", message: `HTTP ${res.status}` };
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { status: "warn", message: "timeout" };
    }
    return { status: "warn", message: "unreachable" };
  }
}

export async function checkCloneUrls(steps: string[]): Promise<CheckResult | null> {
  const urls: string[] = [];
  for (const step of steps) {
    const m = step.trim().match(/^git clone\s+(https?:\/\/\S+)/i);
    if (m) urls.push(m[1].split(" ")[0]);
  }
  if (urls.length === 0) return null;
  const results = await Promise.all(urls.map(u => checkUrlLiveness(u)));
  const failed = results.filter(r => r.status === "fail");
  const warned = results.filter(r => r.status === "warn");
  if (failed.length > 0) return { status: "fail", message: `${failed.length} repo URL(s) unreachable` };
  if (warned.length > 0) return { status: "warn", message: `${warned.length} repo URL(s) returned warnings` };
  return { status: "pass", message: "repo exists" };
}

export async function checkPackageRegistry(step: string): Promise<CheckResult | null> {
  const t = step.trim();

  // pip install -r requirements.txt
  if (/^pip3? install\s+-r/i.test(t)) {
    return { status: "pass", message: "requirements.txt (local)" };
  }

  // pip install <pkg>
  const pipMatch = t.match(/^pip3? install\s+(\S+)/i);
  if (pipMatch) {
    const pkg = pipMatch[1];
    try {
      const res = await fetch(`https://pypi.org/pypi/${pkg}/json`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return { status: "pass", message: `${pkg} on PyPI` };
      return { status: "fail", message: `${pkg} not found on PyPI` };
    } catch {
      return { status: "warn", message: "PyPI unreachable" };
    }
  }

  // npm install [-g] <pkg>
  const npmMatch = t.match(/^npm install(?:\s+(?:-g|-D|--save-dev))?\s+(@?[\w.-]+(?:\/[\w.-]+)?)/i);
  if (npmMatch) {
    const pkg = npmMatch[1];
    try {
      const res = await fetch(`https://registry.npmjs.org/${pkg}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return { status: "pass", message: `${pkg} on npm` };
      return { status: "fail", message: `${pkg} not found on npm` };
    } catch {
      return { status: "warn", message: "npm registry unreachable" };
    }
  }

  // npx [-y] <pkg>
  const npxMatch = t.match(/^npx\s+(?:-y\s+)?(@?[\w.-]+(?:\/[\w.-]+)?)/i);
  if (npxMatch) {
    const pkg = npxMatch[1];
    try {
      const res = await fetch(`https://registry.npmjs.org/${pkg}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return { status: "pass", message: `${pkg} on npm` };
      return { status: "fail", message: `${pkg} not found on npm` };
    } catch {
      return { status: "warn", message: "npm registry unreachable" };
    }
  }

  return null;
}

function mergeResults(results: CheckResult[]): CheckResult {
  const fail = results.find(r => r.status === "fail");
  if (fail) return fail;
  const warn = results.find(r => r.status === "warn");
  if (warn) return warn;
  return results[0];
}

function computeGrade(checks: Record<string, CheckResult>): "pass" | "warn" | "fail" {
  for (const c of Object.values(checks)) {
    if (c.status === "fail") return "fail";
  }
  for (const c of Object.values(checks)) {
    if (c.status === "warn") return "warn";
  }
  return "pass";
}

export async function diagnoseDiscovery(discovery: DiscoveryInput): Promise<DiscoveryDiagnosis> {
  const steps = discovery.install?.steps ?? [];
  const checks: Record<string, CheckResult> = {};

  const npmSteps = steps.filter(s => /^(?:npm install|npx)/i.test(s.trim()));
  const pipSteps = steps.filter(s => /^pip3? install/i.test(s.trim()));
  const hasCurlSh = steps.some(s => /curl.*\|\s*(ba)?sh/i.test(s.trim()));
  const hasBrewInstall = steps.some(s => /^brew install/i.test(s.trim()));

  const asyncChecks: Array<Promise<void>> = [];

  asyncChecks.push(
    checkUrlLiveness(discovery.source.url).then(r => { checks["Source URL"] = r; })
  );

  asyncChecks.push(
    checkCloneUrls(steps).then(r => { if (r) checks["git clone"] = r; })
  );

  if (npmSteps.length > 0) {
    asyncChecks.push((async () => {
      const results = (await Promise.all(npmSteps.map(s => checkPackageRegistry(s))))
        .filter((r): r is CheckResult => r !== null);
      if (results.length > 0) checks["npm"] = mergeResults(results);
    })());
  }

  if (pipSteps.length > 0) {
    asyncChecks.push((async () => {
      const results = (await Promise.all(pipSteps.map(s => checkPackageRegistry(s))))
        .filter((r): r is CheckResult => r !== null);
      if (results.length > 0) checks["pip install"] = mergeResults(results);
    })());
  }

  await Promise.all(asyncChecks);

  if (hasCurlSh) {
    checks["curl | sh"] = { status: "warn", message: "piped install script" };
  }

  if (hasBrewInstall) {
    checks["brew install"] = { status: "pass", message: "brew formula (not verified)" };
  }

  checks["Placeholders"] = detectPlaceholders(steps);
  checks["Steps"] = checkStepCompleteness(steps);

  const syntaxResult = checkCommandSyntax(steps);
  if (syntaxResult) checks["Syntax"] = syntaxResult;

  const grade = computeGrade(checks);
  return { id: discovery.id, title: discovery.title, checks, grade };
}

export async function diagnoseIssue(issue: IssueInput): Promise<IssueDiagnosis> {
  const discoveries = await Promise.all(issue.discoveries.map(d => diagnoseDiscovery(d)));
  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const d of discoveries) summary[d.grade]++;
  return { issueId: issue.id, name: issue.name, date: issue.date, discoveries, summary };
}
