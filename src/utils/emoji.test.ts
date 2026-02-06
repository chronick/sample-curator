import { describe, it, expect } from 'vitest';
import {
  getTypeEmoji,
  getAcousticEmoji,
  getAcousticColor,
  TYPE_EMOJI,
  ACOUSTIC_EMOJI,
  ACOUSTIC_COLORS,
} from './emoji';

describe('getTypeEmoji', () => {
  it('returns correct emoji for each type', () => {
    expect(getTypeEmoji('kick')).toBe('🥁');
    expect(getTypeEmoji('snare')).toBe('🪘');
    expect(getTypeEmoji('hihat')).toBe('🔔');
    expect(getTypeEmoji('clap')).toBe('👏');
    expect(getTypeEmoji('percussion')).toBe('🪇');
    expect(getTypeEmoji('bass')).toBe('🎸');
    expect(getTypeEmoji('synth')).toBe('🎹');
    expect(getTypeEmoji('vocal')).toBe('🎤');
    expect(getTypeEmoji('fx')).toBe('✨');
    expect(getTypeEmoji('loop')).toBe('🔄');
  });

  it('returns empty string for unknown type', () => {
    expect(getTypeEmoji('unknown')).toBe('');
  });

  it('returns empty string for null', () => {
    expect(getTypeEmoji(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(getTypeEmoji(undefined)).toBe('');
  });

  it('is case insensitive', () => {
    expect(getTypeEmoji('KICK')).toBe('🥁');
    expect(getTypeEmoji('Snare')).toBe('🪘');
  });
});

describe('getAcousticEmoji', () => {
  it('returns correct emoji for each tag', () => {
    expect(getAcousticEmoji('bright')).toBe('☀️');
    expect(getAcousticEmoji('dark')).toBe('🌙');
    expect(getAcousticEmoji('punchy')).toBe('👊');
    expect(getAcousticEmoji('sustained')).toBe('🌊');
    expect(getAcousticEmoji('tonal')).toBe('🎵');
    expect(getAcousticEmoji('noisy')).toBe('📻');
    expect(getAcousticEmoji('warm')).toBe('🔥');
    expect(getAcousticEmoji('cold')).toBe('❄️');
    expect(getAcousticEmoji('sharp')).toBe('⚡');
    expect(getAcousticEmoji('smooth')).toBe('🧈');
  });

  it('returns empty string for unknown tag', () => {
    expect(getAcousticEmoji('unknown')).toBe('');
  });

  it('is case insensitive', () => {
    expect(getAcousticEmoji('BRIGHT')).toBe('☀️');
    expect(getAcousticEmoji('Dark')).toBe('🌙');
  });
});

describe('getAcousticColor', () => {
  it('returns correct classes for known tags', () => {
    expect(getAcousticColor('bright')).toContain('yellow');
    expect(getAcousticColor('dark')).toContain('purple');
    expect(getAcousticColor('punchy')).toContain('red');
  });

  it('returns gray fallback for unknown tags', () => {
    expect(getAcousticColor('unknown')).toContain('gray');
  });
});

describe('constants', () => {
  it('TYPE_EMOJI has expected keys', () => {
    const expectedKeys = ['kick', 'snare', 'hihat', 'clap', 'percussion', 'bass', 'synth', 'vocal', 'fx', 'loop'];
    expect(Object.keys(TYPE_EMOJI).sort()).toEqual(expectedKeys.sort());
  });

  it('ACOUSTIC_COLORS has matching keys to ACOUSTIC_EMOJI', () => {
    expect(Object.keys(ACOUSTIC_COLORS).sort()).toEqual(Object.keys(ACOUSTIC_EMOJI).sort());
  });
});
