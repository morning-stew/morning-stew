import type { Discovery } from "../types";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// ── Types ──

export interface ToolRegistryEntry {
  url: string;
  title: string;
  oneLiner: string;
  category: string;
  tags: string[];
  source: string;
  author?: string;
  install: { steps: string[]; requirements?: string[]; timeEstimate?: string };
  signals?: { engagement?: number; comments?: number; trending?: boolean };
  firstSeen: string;
  lastSeen: string;
  timesPicked: number;
  issueIds: string[];
  llmVerdict?: Record<string, unknown>;
  curationScore?: number;
}

export interface ToolRegistry {
  entries: Record<string, ToolRegistryEntry>;
}

// ── Paths ──

function registryPath(): string {
  const dataDir = process.env.DATA_DIR || join(process.cwd(), ".morning-stew");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  return join(dataDir, "tool-registry.json");
}

// ── Core functions ──

export function loadRegistry(): ToolRegistry {
  const path = registryPath();
  if (!existsSync(path)) return { entries: {} };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ToolRegistry;
  } catch {
    return { entries: {} };
  }
}

export function saveRegistry(registry: ToolRegistry): void {
  writeFileSync(registryPath(), JSON.stringify(registry, null, 2));
}

export function registryKey(discovery: Discovery): string {
  if (discovery.source?.url) return discovery.source.url;
  return discovery.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
}

export function isInRegistry(registry: ToolRegistry, discovery: Discovery): boolean {
  const key = registryKey(discovery);
  if (registry.entries[key]) return true;

  // Also check by normalized title in case the URL differs
  const titleKey = discovery.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
  for (const entry of Object.values(registry.entries)) {
    const entryTitleKey = entry.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
    if (entryTitleKey === titleKey) return true;
  }

  return false;
}

export function registerDiscovery(
  registry: ToolRegistry,
  discovery: Discovery,
  issueId?: string,
): void {
  const key = registryKey(discovery);
  const now = new Date().toISOString();
  const existing = registry.entries[key];

  if (existing) {
    existing.lastSeen = now;
    if (issueId && !existing.issueIds.includes(issueId)) {
      existing.issueIds.push(issueId);
      existing.timesPicked++;
    }
    if (discovery.signals) existing.signals = discovery.signals;
    return;
  }

  registry.entries[key] = {
    url: discovery.source?.url ?? "",
    title: discovery.title,
    oneLiner: discovery.oneLiner,
    category: discovery.category,
    tags: discovery.tags ?? [],
    source: discovery.source?.type ?? "web",
    author: discovery.source?.author,
    install: discovery.install,
    signals: discovery.signals,
    firstSeen: now,
    lastSeen: now,
    timesPicked: issueId ? 1 : 0,
    issueIds: issueId ? [issueId] : [],
  };
}

export function getRegistryStats(): {
  total: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
} {
  const registry = loadRegistry();
  const entries = Object.values(registry.entries);

  const bySource: Record<string, number> = {};
  const byCategory: Record<string, number> = {};

  for (const entry of entries) {
    bySource[entry.source] = (bySource[entry.source] || 0) + 1;
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
  }

  return { total: entries.length, bySource, byCategory };
}
