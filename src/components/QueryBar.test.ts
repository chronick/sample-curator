import { describe, it, expect } from 'vitest';
import { parseQuery, splitTokens, unquote } from './QueryBar';

describe('parseQuery', () => {
  it('returns empty object for empty string', () => {
    const result = parseQuery('');
    expect(result).toEqual({});
  });

  it('parses bare word as query', () => {
    const result = parseQuery('kick');
    expect(result.query).toBe('kick');
  });

  it('parses multiple bare words as query', () => {
    const result = parseQuery('dark kick');
    expect(result.query).toBe('dark kick');
  });

  it('parses type filter', () => {
    const result = parseQuery('type:kick');
    expect(result.sample_type).toBe('kick');
  });

  it('parses bpm min', () => {
    const result = parseQuery('bpm:>120');
    expect(result.min_bpm).toBe(120);
  });

  it('parses bpm max', () => {
    const result = parseQuery('bpm:<160');
    expect(result.max_bpm).toBe(160);
  });

  it('parses bpm range', () => {
    const result = parseQuery('bpm:120-160');
    expect(result.min_bpm).toBe(120);
    expect(result.max_bpm).toBe(160);
  });

  it('parses tag filter', () => {
    const result = parseQuery('tag:dark');
    expect(result.tags).toEqual(['dark']);
  });

  it('parses multiple tags', () => {
    const result = parseQuery('tag:dark tag:heavy');
    expect(result.tags).toEqual(['dark', 'heavy']);
  });

  it('parses pack filter numeric', () => {
    const result = parseQuery('pack:42');
    expect(result.pack_id).toBe(42);
  });

  it('does not set pack_id for non-numeric pack name', () => {
    const result = parseQuery('pack:Techno');
    expect(result.pack_id).toBeUndefined();
  });

  it('parses score min', () => {
    const result = parseQuery('score:>70');
    expect(result.min_score).toBe(70);
  });

  it('parses score max', () => {
    const result = parseQuery('score:<90');
    expect(result.max_score).toBe(90);
  });

  it('parses combined filters', () => {
    const result = parseQuery('type:kick bpm:>120 tag:dark bright');
    expect(result.sample_type).toBe('kick');
    expect(result.min_bpm).toBe(120);
    expect(result.tags).toEqual(['dark']);
    expect(result.query).toBe('bright');
  });

  it('handles quoted value', () => {
    const result = parseQuery('tag:"techno dark"');
    expect(result.tags).toEqual(['techno dark']);
  });

  it('treats unknown field as bare word', () => {
    const result = parseQuery('foo:bar');
    expect(result.query).toBe('foo:bar');
  });
});

describe('splitTokens', () => {
  it('splits basic tokens', () => {
    expect(splitTokens('a b c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted strings', () => {
    expect(splitTokens('a "b c" d')).toEqual(['a', '"b c"', 'd']);
  });

  it('returns empty array for empty string', () => {
    expect(splitTokens('')).toEqual([]);
  });
});

describe('unquote', () => {
  it('strips double quotes', () => {
    expect(unquote('"hello"')).toBe('hello');
  });

  it('strips single quotes', () => {
    expect(unquote("'hello'")).toBe('hello');
  });

  it('leaves unquoted strings unchanged', () => {
    expect(unquote('hello')).toBe('hello');
  });
});
