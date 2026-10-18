// Small helpers shared by the site's pages (src/site/app.ts and src/site/pages/).

export const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel)!;
export const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
