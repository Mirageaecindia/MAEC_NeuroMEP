/** The guide section each page's Help button opens (kept apart so the app bundle stays small). */
export const SECTION_OF_PAGE = {
  projects: 'login',
  import: 'import-file',
  floor: 'floor-setup',
  building: 'building-tab',
  schematic: 'schematic',
  output: 'output',
} as const;

/** Opens the user guide in its own browser tab (one tab, reused) at a section. */
export function openGuide(section: string) {
  window.open(`/guide#${section}`, 'neuromep-guide');
}
