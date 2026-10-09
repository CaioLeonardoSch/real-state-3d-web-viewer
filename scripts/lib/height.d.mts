export declare const METERS_PER_LEVEL: number;
export declare const DEFAULT_HEIGHT_M: number;
export declare function parseOsmNumber(value: unknown): number;
export declare function computeRenderHeight(
  tags: Record<string, unknown> | undefined,
  cadastreFloors?: number,
): {
  renderHeight: number;
  source: 'height' | 'levels' | 'cadastre' | 'default';
};
export declare function loadCadastreFloors(root: string): Promise<Map<string, number>>;
