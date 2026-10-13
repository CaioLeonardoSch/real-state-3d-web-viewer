// Inline SVG icons of the client's site (stroke icons on a 24 px grid; they take the text colour).
const svg = (body: string, fill = false) =>
  `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;

export const ICONS = {
  area: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  bed: svg('<path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 14h18M7 9V6h4v3"/>'),
  bath: svg('<path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM6 12V6a2 2 0 0 1 4 0M7 19l-1 2M17 19l1 2"/>'),
  suite: svg('<path d="M3 18v-6h18v6M3 15h18M6 12V9h5v3M13 12V9h5v3"/>'),
  car: svg('<path d="M5 16h14v-4l-2-5H7l-2 5zM5 16v2M19 16v2M5 12h14"/><circle cx="8" cy="14" r=".6"/><circle cx="16" cy="14" r=".6"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  compare: svg('<path d="M8 4v16M16 4v16M4 8h4M16 16h4M4 16l4 0M16 8h4"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
  list: svg('<rect x="4" y="5" width="5" height="5" rx="1"/><rect x="4" y="14" width="5" height="5" rx="1"/><path d="M12 7h8M12 16h8"/>'),
  map: svg('<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2zM9 4v14M15 6v14"/>'),
  cube: svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5"/>'),
  filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  left: svg('<path d="m15 5-7 7 7 7"/>'),
  right: svg('<path d="m9 5 7 7-7 7"/>'),
  phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  clock: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
  share: svg('<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  whatsapp: svg(
    '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.6-.3z"/>',
    true,
  ),
  instagram: svg('<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="17" cy="7" r=".7"/>'),
  facebook: svg('<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z"/>'),
  youtube: svg('<rect x="3" y="6" width="18" height="12" rx="4"/><path d="m10.5 9.5 4 2.5-4 2.5z"/>'),
  linkedin: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 11v5M8 8v.01M12 16v-5M12 13a2 2 0 0 1 4 0v3"/>'),
  tiktok: svg('<path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5M14 4a4.5 4.5 0 0 0 4.5 4.5"/>'),
} as const;
export type IconName = keyof typeof ICONS;
