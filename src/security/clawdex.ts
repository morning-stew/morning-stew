import type { Skill } from "../types";

const CLAWDEX_API = "https://clawdex.koi.security/api/skill";

export type SecurityVerdict = "benign" | "malicious" | "unknown";

export interface ClawdexResponse {
  verdict: SecurityVerdict;
}

/**
 * Check a skill's security status via Clawdex API.
 * 
 * Verdicts:
 * - benign: Safe to install
 * - malicious: Do NOT install
 * - unknown: Ask user for approval
 */
export async function checkSkillSecurity(skillSlug: string): Promise<SecurityVerdict> {
  try {
    const response = await fetch(`${CLAWDEX_API}/${encodeURIComponent(skillSlug)}`);
    
    if (!response.ok) {
      console.log(`[clawdex] API error for ${skillSlug}: ${response.status}`);
      return "unknown";
    }

    const data = await response.json() as ClawdexResponse;
    return data.verdict || "unknown";
  } catch (error) {
    console.log(`[clawdex] Failed to check ${skillSlug}:`, error);
    return "unknown";
  }
}

/**
 * Check multiple skills in parallel.
 */
export async function checkSkillsSecurity(
  skills: Skill[]
): Promise<Map<string, SecurityVerdict>> {
  console.log(`[clawdex] Checking ${skills.length} skills...`);
  
  const results = new Map<string, SecurityVerdict>();
  
  // Extract slug from URL: https://clawhub.ai/author/skillname -> skillname
  const checks = skills.map(async (skill) => {
    const urlParts = skill.url.split("/");
    const slug = urlParts[urlParts.length - 1];
    
    const verdict = await checkSkillSecurity(slug);
    results.set(skill.url, verdict);
    
    return { skill, slug, verdict };
  });

  const checked = await Promise.all(checks);
  
  // Log summary
  const benign = checked.filter(c => c.verdict === "benign").length;
  const malicious = checked.filter(c => c.verdict === "malicious").length;
  const unknown = checked.filter(c => c.verdict === "unknown").length;
  
  console.log(`[clawdex] Results: ${benign} benign, ${malicious} malicious, ${unknown} unknown`);
  
  // Warn about malicious skills
  const maliciousSkills = checked.filter(c => c.verdict === "malicious");
  if (maliciousSkills.length > 0) {
    console.warn(`[clawdex] ⚠️  MALICIOUS SKILLS DETECTED:`);
    maliciousSkills.forEach(s => console.warn(`   - ${s.skill.name} (${s.slug})`));
  }

  return results;
}

/**
 * Update skills with security status from Clawdex.
 */
export async function enrichSkillsWithSecurity(skills: Skill[]): Promise<Skill[]> {
  const verdicts = await checkSkillsSecurity(skills);
  
  return skills.map(skill => ({
    ...skill,
    securityStatus: verdicts.get(skill.url) || "pending",
  }));
}

/**
 * Generate security notes for the newsletter based on audit results.
 */
export function generateSecurityNotes(skills: Skill[]): string[] {
  const notes: string[] = [];
  
  const malicious = skills.filter(s => s.securityStatus === "malicious");
  const unknown = skills.filter(s => s.securityStatus === "unknown");
  const benign = skills.filter(s => s.securityStatus === "benign");
  
  if (malicious.length > 0) {
    notes.push(`🚫 ${malicious.length} skill(s) flagged as MALICIOUS by Clawdex: ${malicious.map(s => s.name).join(", ")}`);
  }
  
  if (unknown.length > 0) {
    notes.push(`⚠️ ${unknown.length} skill(s) not yet audited: ${unknown.map(s => s.name).join(", ")}`);
  }
  
  if (benign.length > 0 && malicious.length === 0) {
    notes.push(`✅ ${benign.length} skill(s) verified safe by Clawdex`);
  }
  
  return notes;
}
