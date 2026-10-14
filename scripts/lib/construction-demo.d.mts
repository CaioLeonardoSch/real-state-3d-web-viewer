export const DEMO_PROGRESS_MONTH: string;
export function demoProgress(id: string, totalFloors: number): { floorsBuilt: number; updatedAt: string; source: 'ilustrativo' };
export function demoFloors(l: { floors?: number; buildingHeightM?: number }): number;
