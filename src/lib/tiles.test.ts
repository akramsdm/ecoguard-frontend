import {describe,it,expect} from 'vitest';
import {resolveTileProfile,TileConfigError} from './tiles';

describe('tile profile resolution (step 2: env-driven provider, no hardcoded key)', () => {
  it('selects the MapTiler raster profile when a key is configured', () => {
    const p = resolveTileProfile({provider: 'maptiler', key: 'abcd1234efgh5678', style: 'streets-v2', dev: true});
    expect(p.provider).toBe('maptiler');
    expect(p.urlTemplate).toBe(
      'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=abcd1234efgh5678'
    );
    // Both attributions are present in one profile: MapTiler + OSM (also the
    // ODbL boundary attribution is added separately by the map component).
    expect(p.attribution).toContain('MapTiler');
    expect(p.attribution).toContain('openstreetmap.org/copyright');
    expect(p.devFallback).toBe(false);
  });

  it('the style is overridable via VITE_MAPTILER_STYLE', () => {
    const p = resolveTileProfile({provider: 'maptiler', key: 'abcd1234efgh5678', style: 'basic-v2', dev: true});
    expect(p.urlTemplate).toContain('/maps/basic-v2/{z}/{x}/{y}.png');
  });

  it('falls back to the OSM raster in dev only, when no key is set', () => {
    const p = resolveTileProfile({provider: 'maptiler', dev: true, key: ''});
    expect(p.provider).toBe('osm-dev');
    expect(p.devFallback).toBe(true);
    expect(p.urlTemplate).toContain('tile.openstreetmap.org');
    expect(p.attribution).toContain('OpenStreetMap');
  });

  it('refuses to start in production without a key (fallback impossible in production)', () => {
    expect(() => resolveTileProfile({provider: 'maptiler', dev: false, key: ''})).toThrowError(TileConfigError);
    // The explicit OSM provider is development-only too.
    expect(() => resolveTileProfile({provider: 'osm', dev: false})).toThrowError(TileConfigError);
  });

  it('rejects malformed MapTiler keys (too short or containing whitespace)', () => {
    expect(() => resolveTileProfile({provider: 'maptiler', dev: true, key: 'short'})).toThrowError(TileConfigError);
    expect(() => resolveTileProfile({provider: 'maptiler', dev: true, key: 'has space 1234'})).toThrowError(TileConfigError);
  });

  it('rejects an unknown provider', () => {
    expect(() => resolveTileProfile({provider: 'google', dev: true})).toThrowError(TileConfigError);
  });
});