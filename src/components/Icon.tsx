const PATHS: Record<string, string> = {
  home: 'M4 11 12 4l8 7v9H4z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  check: 'M20 6 9 17l-5-5',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  left: 'm15 6-6 6 6 6',
  right: 'm9 6 6 6-6 6',
  down: 'm6 9 6 6 6-6',
  up: 'm6 15 6-6 6 6',
  gear: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  face: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M9 9v1M15 9v1M12 9v4h-1M9 16c1.5 1 4.5 1 6 0',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  share: 'M12 3v12M8 7l4-4 4 4M6 11H5v9h14v-9h-1',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  clock: 'M12 7v5l3 2',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  card: 'M3 6h18v12H3zM3 10h18',
  finger:
    'M7.5 5.5A8 8 0 0 1 20 11v1M4.5 9A8 8 0 0 0 4 12v3M8 19.5A12 12 0 0 0 9 14v-2a3 3 0 0 1 6 0v1M12 12v2a16 16 0 0 1-1.5 7M15.5 16.5a20 20 0 0 1-.8 3.5M7 15v-3a5 5 0 0 1 10 0v2.5',
  backspace: 'M9 6h11v12H9l-6-6zM12 10l4 4M16 10l-4 4',
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {name === 'clock' && <circle cx="12" cy="12" r="9" />}
      {name === 'gear' && <circle cx="12" cy="12" r="3" />}
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
