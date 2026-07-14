// Inline stroke icons for the toolbar (16-unit viewBox, currentColor), same style as
// richdoc. Each button pairs one of these with a title/aria-label tooltip.
const svgIcon = (inner: string): string =>
  `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICON = {
  add: svgIcon('<path d="M8 3.5v9M3.5 8h9"/>'),
  remove: svgIcon('<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.4 8.5h6.2l.4-8.5"/>'),
  shift: svgIcon('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2.2 1.3"/>'),
  overlaps: svgIcon('<rect x="2.5" y="3.5" width="7" height="4" rx="1"/><rect x="6.5" y="8.5" width="7" height="4" rx="1"/>'),
  styles: svgIcon('<path d="M5 3.5h6M8 3.5v9M5.5 12.5h5"/><path d="M11.5 8.5l2-2 1.5 1.5-2 2z"/>'),
  script: svgIcon('<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/>'),
  mic: svgIcon('<rect x="6" y="2" width="4" height="7" rx="2"/><path d="M4 7a4 4 0 0 0 8 0M8 11v2.5M6 13.5h4"/>'),
  fade: svgIcon('<path d="M2 13l5-10v10z" fill="currentColor" stroke="none"/><path d="M14 13L9 3v10z" fill="currentColor" stroke="none" opacity="0.5"/>'),
  transform: svgIcon('<path d="M12.5 5A5.5 5.5 0 1 0 13 8.5"/><path d="M11 2.5v3h3"/>'),
  clip: svgIcon('<path d="M2 5h9v9M5 2v3M5 5h6v6"/><rect x="2" y="8" width="6" height="6" rx="1" stroke-dasharray="2 1.5"/>'),
  draw: svgIcon('<path d="M11 3.5l1.5 1.5-7 7L3.5 13l1-2z"/><path d="M10 4.5l1.5 1.5"/>'),
  save: svgIcon('<path d="M8 2.5v7.5M5 7.5l3 3 3-3M3.5 13h9"/>'),
  transcribe: svgIcon('<path d="M3 8v0M5.5 5.5v5M8 3.5v9M10.5 6v4M13 8v0"/><path d="M11 13.5l1 1 2-2.5" opacity="0.7"/>'),
  translate: svgIcon('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2.2 1.8 2.2 10.2 0 12M8 2c-2.2 1.8-2.2 10.2 0 12"/>'),
  savevideo: svgIcon('<rect x="2" y="3" width="12" height="8.5" rx="1"/><path d="M2 5.5h12M5 3v2.5M11 3v2.5" opacity="0.6"/><path d="M8 13v0M6.5 12l1.5 1.5 1.5-1.5"/>'),
  undo: svgIcon('<path d="M4 8h6a3 3 0 0 1 0 6H6"/><path d="M6.5 5L3.5 8l3 3"/>'),
  redo: svgIcon('<path d="M12 8H6a3 3 0 0 0 0 6h4"/><path d="M9.5 5l3 3-3 3"/>'),
  setstart: svgIcon('<path d="M4 2.5v11"/><path d="M13 8H6.5"/><path d="M9 5.5 6.5 8 9 10.5"/>'),
  setend: svgIcon('<path d="M12 2.5v11"/><path d="M3 8h6.5"/><path d="M7 5.5 9.5 8 7 10.5"/>'),
  playcue: svgIcon('<path d="M4 3.5v9l7-4.5z" fill="currentColor" stroke="none"/>'),
  follow: svgIcon('<circle cx="8" cy="8" r="2.5"/><path d="M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14"/>'),
  merge: svgIcon('<rect x="3" y="2.5" width="10" height="3.5" rx="1"/><rect x="3" y="10" width="10" height="3.5" rx="1"/><path d="M8 6.2v3.6M6.5 8.2 8 9.8l1.5-1.6"/>'),
  split: svgIcon('<rect x="3" y="2.5" width="10" height="3.5" rx="1"/><rect x="3" y="10" width="10" height="3.5" rx="1"/><path d="M8 9.8V6.2M6.5 7.8 8 6.2l1.5 1.6"/>'),
  search: svgIcon('<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>'),
  problems: svgIcon('<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11v0"/>'),
  more: svgIcon('<circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none"/>'),
  tune: svgIcon('<path d="M2.5 4.5h5M11 4.5h2.5M2.5 11.5h2.5M9 11.5h4.5"/><circle cx="9" cy="4.5" r="1.6"/><circle cx="6.5" cy="11.5" r="1.6"/>'),
  meta: svgIcon('<path d="M8.2 2.5H13v4.8l-6 6-4.8-4.8z"/><circle cx="10.4" cy="5.1" r="0.9" fill="currentColor" stroke="none"/>'),
};
