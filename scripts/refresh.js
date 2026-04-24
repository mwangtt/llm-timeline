#!/usr/bin/env node
/**
 * scripts/refresh.js
 *
 * Calls Claude to research the latest LLM releases and appends new events to data.json.
 * Run manually or via GitHub Actions (see .github/workflows/refresh.yml).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/refresh.js
 *
 * Requires: npm install @anthropic-ai/sdk
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data.json');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  const lastUpdated = data.meta.last_updated;

  console.log(`data.json last updated: ${lastUpdated}`);
  console.log(`Today: ${today}`);

  if (lastUpdated === today) {
    console.log('Already up to date. Skipping.');
    return;
  }

  // Count existing months to know current col range
  const currentMonthCount = data.months.length;
  const lastMonth = data.months[data.months.length - 1];

  const prompt = `You are updating an LLM timeline JSON file. The current data covers ${data.meta.coverage} (${currentMonthCount} months, col 0 = Jan 2025, col ${currentMonthCount - 1} = ${lastMonth}).

Today is ${today}. The timeline was last updated on ${lastUpdated}.

Your task:
1. Search your knowledge for major LLM model releases and updates that happened AFTER ${lastUpdated} and up to ${today}.
2. Focus on: OpenAI (provider id: "openai"), Google Gemini (provider id: "gemini"), Anthropic Claude (provider id: "claude"), Google AI Mode (provider id: "aimode"), Google AI Overviews (provider id: "aioverview"), Perplexity (provider id: "perplexity").
3. For each new event, determine which col it belongs to (col = months since Jan 2025, so Jan 2025=0, Feb 2025=1, ..., Dec 2025=11, Jan 2026=12, Feb 2026=13, Mar 2026=14, Apr 2026=15, May 2026=16, ...).
4. If the timeline needs new month columns added (e.g., we've reached May 2026 and col 16 doesn't exist), list them in "new_months".

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "new_months": ["May '26", "Jun '26"],
  "new_events": [
    {
      "provider": "openai",
      "col": 16,
      "date": "May 12",
      "name": "Model Name",
      "tags": ["tag1", "tag2"],
      "tip": ["Key fact 1", "Key fact 2", "Key fact 3"]
    }
  ],
  "updated_benchmarks": [],
  "summary": "Brief description of what was added"
}

Rules:
- Only include events you are confident about (real releases, not rumors).
- If nothing significant happened since ${lastUpdated}, return empty arrays.
- "tags" should be 1-3 short descriptive labels.
- "tip" should be 2-5 bullet points with specific facts (benchmark scores, dates, capabilities).
- Do not duplicate events already in the timeline.
- updated_benchmarks: if any benchmark leader changed, include the full replacement benchmark object with fields: lbl, winner, score, hint.

Current events in the timeline (last 5, for context on what's already included):
${JSON.stringify(data.events.slice(-5), null, 2)}`;

  console.log('Calling Claude to research new events…');

  const message = await client.messages.create({
    model: 'claude-opus-4-7-20251101',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].text.trim();
  console.log('Claude response:', raw.slice(0, 200), '…');

  let update;
  try {
    // strip possible markdown fences
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    update = JSON.parse(jsonStr);
  } catch (e) {
    console.error('Failed to parse Claude response as JSON:', e.message);
    process.exit(1);
  }

  // Apply updates
  let changed = false;

  if (update.new_months && update.new_months.length > 0) {
    data.months.push(...update.new_months);
    console.log(`Added ${update.new_months.length} new month(s): ${update.new_months.join(', ')}`);
    changed = true;
  }

  if (update.new_events && update.new_events.length > 0) {
    data.events.push(...update.new_events);
    console.log(`Added ${update.new_events.length} new event(s).`);
    changed = true;
  }

  if (update.updated_benchmarks && update.updated_benchmarks.length > 0) {
    for (const updated of update.updated_benchmarks) {
      const idx = data.benchmarks.findIndex(b => b.lbl === updated.lbl);
      if (idx >= 0) {
        data.benchmarks[idx] = updated;
        console.log(`Updated benchmark: ${updated.lbl}`);
      } else {
        data.benchmarks.push(updated);
        console.log(`Added new benchmark: ${updated.lbl}`);
      }
    }
    changed = true;
  }

  // Always update meta date and coverage
  data.meta.last_updated = today;
  const lastMonthLabel = data.months[data.months.length - 1];
  data.meta.coverage = `Jan 2025 – ${lastMonthLabel}`;

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log(`data.json updated. Summary: ${update.summary || '(no summary)'}`);

  if (!changed) {
    console.log('No new events found — only timestamp updated.');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
