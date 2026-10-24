import { describe, it, expect } from 'vitest';
import { CDN_DATA_BASE, APP_INDEX_URL, YEAR_URL } from './cdnUrls';

describe('cdnUrls (#131)', () => {
  it('points at the R2 data host, not the Pages site that serves HTML for /data', () => {
    expect(CDN_DATA_BASE).toBe('https://data.proton-pulse.com/data');
    expect(APP_INDEX_URL.replace('{id}', '730')).toBe('https://data.proton-pulse.com/data/730/index.json');
    expect(YEAR_URL.replace('{id}', '730').replace('{year}', '2025')).toBe('https://data.proton-pulse.com/data/730/2025.json');
  });
});
