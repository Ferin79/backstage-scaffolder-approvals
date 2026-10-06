import '@testing-library/jest-dom';

// jsdom has no `matchMedia`, and BUI's `useBreakpoint` needs it: the requests
// table drops its secondary columns on a narrow screen. This answers the
// `min-width` queries BUI asks from `window.innerWidth`, which jsdom sets to
// 1024 — so tests see a desktop layout by default, and a test file can narrow
// the window to see the phone one. BUI caches its first answer, and this never
// sends the change events that would move it, so narrow the window before
// anything renders (see RequestsTable.narrow.test.tsx).
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => {
    const minWidth = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: minWidth ? window.innerWidth >= Number(minWidth[1]) : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  };
}
