import { describe, expect, it } from 'vitest';
import {
  bandIndexFromValue,
  companyBand,
  employeeBand,
  parseSizeValue,
  revenueBand,
} from '../lib/company-leads/bands';

describe('parseSizeValue', () => {
  it('reads the classic employee ranges by midpoint', () => {
    expect(parseSizeValue('1 - 4')).toBe(3);
    expect(parseSizeValue('5 - 9')).toBe(7);
    expect(parseSizeValue('10 - 19')).toBe(15);
    expect(parseSizeValue('500 - 999')).toBe(750);
    expect(parseSizeValue('1000 - 4999')).toBe(3000);
  });

  it('reads plain numbers with thousands separators', () => {
    expect(parseSizeValue('100,000')).toBe(100000);
    expect(parseSizeValue('1,000')).toBe(1000);
    expect(parseSizeValue('250')).toBe(250);
  });

  it('reads word multipliers', () => {
    expect(parseSizeValue('$1 Million to $2.5 Million')).toBe(1750000);
    expect(parseSizeValue('$500,000 to $1 Million')).toBe(750000);
    expect(parseSizeValue('$100 Million')).toBe(100000000);
    expect(parseSizeValue('250k')).toBe(250000);
    expect(parseSizeValue('$2 billion')).toBe(2000000000);
  });

  it('treats "under X" as an upper bound and halves it', () => {
    expect(parseSizeValue('Under $500,000')).toBe(250000);
    expect(parseSizeValue('less than 10')).toBe(5);
  });

  it('keeps "over X" and "X+" as the floor', () => {
    expect(parseSizeValue('$100 Million +')).toBe(100000000);
    expect(parseSizeValue('1,000+')).toBe(1000);
    expect(parseSizeValue('more than 500')).toBe(500);
  });

  it('returns null when there is no number', () => {
    expect(parseSizeValue(null)).toBeNull();
    expect(parseSizeValue('')).toBeNull();
    expect(parseSizeValue('Nonclassifiable')).toBeNull();
  });
});

describe('bandIndexFromValue', () => {
  const ceilings = [10, 100, 1000, Number.POSITIVE_INFINITY];

  it('maps values onto the four bands (inclusive ceilings)', () => {
    expect(bandIndexFromValue(3, ceilings)).toBe(0);
    expect(bandIndexFromValue(10, ceilings)).toBe(0);
    expect(bandIndexFromValue(11, ceilings)).toBe(1);
    expect(bandIndexFromValue(100, ceilings)).toBe(1);
    expect(bandIndexFromValue(101, ceilings)).toBe(2);
    expect(bandIndexFromValue(1000, ceilings)).toBe(2);
    expect(bandIndexFromValue(1001, ceilings)).toBe(3);
  });

  it('maps thresholds with exclusive ceilings', () => {
    const money = [1_000_000, 10_000_000, 100_000_000, Number.POSITIVE_INFINITY];
    expect(bandIndexFromValue(999_999, money, false)).toBe(0);
    expect(bandIndexFromValue(1_000_000, money, false)).toBe(1);
    expect(bandIndexFromValue(9_999_999, money, false)).toBe(1);
    expect(bandIndexFromValue(100_000_000, money, false)).toBe(3);
  });

  it('keeps unknown values unknown', () => {
    expect(bandIndexFromValue(null, ceilings)).toBeNull();
    expect(bandIndexFromValue(Number.NaN, ceilings)).toBeNull();
    expect(bandIndexFromValue(-5, ceilings)).toBeNull();
  });
});

describe('employeeBand / revenueBand', () => {
  it('bands employees', () => {
    expect(employeeBand('1 - 4')).toBe(0);
    expect(employeeBand('10 - 19')).toBe(1);
    expect(employeeBand('100 - 249')).toBe(2);
    expect(employeeBand('5000 +')).toBe(3);
    expect(employeeBand('Unknown')).toBeNull();
  });

  it('bands revenue in dollars', () => {
    expect(revenueBand('Under $500,000')).toBe(0);
    expect(revenueBand('$500,000 to $1 Million')).toBe(0);
    expect(revenueBand('$1 Million to $2.5 Million')).toBe(1);
    expect(revenueBand('$10 Million to $20 Million')).toBe(2);
    expect(revenueBand('$100 Million +')).toBe(3);
  });
});

describe('companyBand', () => {
  it('takes the larger of headcount and revenue', () => {
    // Big revenue, tiny team: still a real advertiser.
    expect(companyBand('1 - 4', '$50 Million')).toBe(2);
    // Large organisation, modest revenue.
    expect(companyBand('250 - 499', '$5 Million')).toBe(2);
    // Both small.
    expect(companyBand('1 - 4', '$250,000')).toBe(0);
  });

  it('never turns a missing value into MICRO by accident alone', () => {
    expect(companyBand(null, null)).toBeNull();
    expect(companyBand('1 - 4', null)).toBe(0);
    expect(companyBand(null, '$50 Million')).toBe(2);
  });
});
