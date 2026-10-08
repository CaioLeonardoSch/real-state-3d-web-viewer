export declare const METERS_PER_LEVEL: number;
export declare const DEFAULT_HEIGHT_M: number;
export declare function parseOsmNumber(value: unknown): number;
export declare function computeRenderHeight(tags: Record<string, unknown> | undefined): {
  renderHeight: number;
  source: 'height' | 'levels' | 'default';
};
