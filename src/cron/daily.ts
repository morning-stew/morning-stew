/**
 * OpenClaw Cron Job Configuration for Morning Stew
 * 
 * This file documents the cron job setup for daily newsletter generation.
 * Run these commands to set up the cron jobs in OpenClaw:
 * 
 * 1. Daily newsletter generation (6 AM PT):
 * 
 *    openclaw cron add \
 *      --name "Morning Stew Daily" \
 *      --cron "0 6 * * *" \
 *      --tz "America/Los_Angeles" \
 *      --session isolated \
 *      --message "Generate today's Morning Stew newsletter. Run: cd ~/morning-stew && pnpm generate && pnpm publish" \
 *      --announce \
 *      --channel twitter
 * 
 * 2. Twitter announcement (7 AM PT, after generation):
 * 
 *    openclaw cron add \
 *      --name "Morning Stew Tweet" \
 *      --cron "0 7 * * *" \
 *      --tz "America/Los_Angeles" \
 *      --session isolated \
 *      --message "Post today's Morning Stew newsletter to Twitter. Include the issue name and key highlights."
 * 
 * To list active cron jobs:
 *    openclaw cron list
 * 
 * To run a job manually:
 *    openclaw cron run <jobId>
 * 
 * To view run history:
 *    openclaw cron runs --id <jobId>
 */

export const CRON_JOBS = {
  daily_generate: {
    name: "Morning Stew Daily",
    schedule: { kind: "cron", expr: "0 6 * * *", tz: "America/Los_Angeles" },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: {
      kind: "agentTurn",
      message: `Generate today's Morning Stew newsletter:
1. Run the scrapers to collect new skills, GitHub releases, and Twitter buzz
2. Compile the newsletter with a creative name
3. Publish to the API server
4. Announce on Twitter

Commands:
cd ~/morning-stew
pnpm generate
pnpm publish`,
    },
    delivery: {
      mode: "announce",
      channel: "main",
    },
  },
} as const;

/**
 * CLI command to set up all cron jobs
 */
export function getSetupCommands(): string[] {
  return [
    `openclaw cron add \\
  --name "Morning Stew Daily" \\
  --cron "0 6 * * *" \\
  --tz "America/Los_Angeles" \\
  --session isolated \\
  --message "Generate and publish today's Morning Stew newsletter. Run: cd ~/morning-stew && pnpm generate && pnpm publish" \\
  --announce`,
  ];
}
