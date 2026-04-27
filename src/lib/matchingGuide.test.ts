import { describe, expect, it } from 'vitest';

import {
  MATCHING_GUIDE_LEGEND_AMBER,
  MATCHING_GUIDE_LEGEND_GREEN,
  MATCHING_GUIDE_LEGEND_PREFIX,
  MATCHING_GUIDE_LEGEND_RED,
  buildMatchingRules,
} from './matchingGuide';
import { WEIGHTS } from './scoring';

describe('matchingGuide', () => {
  it('exports the legend labels used by the UI', () => {
    expect(MATCHING_GUIDE_LEGEND_PREFIX).toBe('Per-field match colours:');
    expect(MATCHING_GUIDE_LEGEND_GREEN).toContain('green');
    expect(MATCHING_GUIDE_LEGEND_AMBER).toContain('amber');
    expect(MATCHING_GUIDE_LEGEND_RED).toContain('red');
  });

  it('builds all matching guide sections with populated tiers', () => {
    const rules = buildMatchingRules();

    expect(rules).toHaveLength(8);
    expect(rules.map((section) => section.field)).toEqual([
      'Overall Relevance Score',
      'GPU Model',
      'GPU Driver',
      'CPU',
      'OS / Distro',
      'Kernel',
      'RAM',
      'Proton Version',
    ]);

    for (const section of rules) {
      expect(section.description.length).toBeGreaterThan(20);
      expect(section.tiers.length).toBeGreaterThan(0);
      for (const tier of section.tiers) {
        expect(tier.label.length).toBeGreaterThan(0);
        expect(tier.note.length).toBeGreaterThan(0);
      }
    }
  });

  it('reflects current scoring constants in the rule copy', () => {
    const overall = buildMatchingRules()[0];

    expect(overall.tiers[0].note).toContain(`Platinum=${WEIGHTS.BASE_MAX}`);
    expect(overall.tiers[1].note).toContain(String(WEIGHTS.RECENCY_RECENT));
    expect(overall.tiers[2].note).toContain(String(WEIGHTS.CUSTOM_PROTON));
    expect(overall.tiers[3].note).toContain(String(WEIGHTS.PROTON_MATCH));
    expect(overall.tiers[3].note).toContain(String(WEIGHTS.PROTON_CLOSE));
    expect(overall.tiers[8].note).toContain(String(WEIGHTS.BORKED_DECAY_DAYS));
  });
});
