import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SECTIONS } from './sections';
import './guide.css';

/**
 * The NeuroMEP user guide (user request 7 Nov 2026): a page of its own, opened in a new tab by
 * the toolbar's Help button at the section of the current page. Contents on the left, a search
 * that keeps only the sections containing every word typed, and Calculation buttons that work an
 * example through with the real engine.
 */
export function GuidePage() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(() => window.location.hash.slice(1) || SECTIONS[0]!.id);
  const refs = useRef(new Map<string, HTMLElement>());
  const [texts, setTexts] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    document.title = 'NeuroMEP User Guide';
  }, []);

  // The searchable text of each section, taken once from the rendered page.
  useLayoutEffect(() => {
    setTexts(
      new Map(
        SECTIONS.map((s) => [s.id, (refs.current.get(s.id)?.textContent ?? '').toLowerCase()]),
      ),
    );
  }, []);

  // Help opens the guide at #section; the browser's own anchor jump runs before React renders.
  useEffect(() => {
    const go = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      setActive(id);
      document.getElementById(id)?.scrollIntoView();
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = useMemo(
    () =>
      new Set(
        SECTIONS.filter(
          (s) =>
            words.length === 0 ||
            words.every((w) => (texts.get(s.id) ?? s.title.toLowerCase()).includes(w)),
        ).map((s) => s.id),
      ),
    [words, texts],
  );
  const groups = [...new Set(SECTIONS.map((s) => s.group))];

  return (
    <div className="guide">
      <header className="guide-header">
        <h1>NeuroMEP User Guide</h1>
        <input
          type="search"
          className="guide-search"
          placeholder="Search the guide (e.g. riser, voltage drop, E1801)"
          aria-label="Search the guide"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>
      <div className="guide-body">
        <nav className="guide-toc" aria-label="Contents">
          {groups.map((g) => (
            <div key={g}>
              <p className="toc-group">{g}</p>
              <ul>
                {SECTIONS.filter((s) => s.group === g && visible.has(s.id)).map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={active === s.id ? 'current' : undefined}
                      aria-current={active === s.id ? 'location' : undefined}
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <main className="guide-content">
          {visible.size === 0 && (
            <p className="muted">Nothing in the guide matches &quot;{query}&quot;.</p>
          )}
          {groups.map((g) => (
            <div key={g} hidden={!SECTIONS.some((s) => s.group === g && visible.has(s.id))}>
              <h2 className="guide-group">{g}</h2>
              {SECTIONS.filter((s) => s.group === g).map((s) => (
                <section
                  key={s.id}
                  id={s.id}
                  hidden={!visible.has(s.id)}
                  ref={(el) => {
                    if (el) refs.current.set(s.id, el);
                  }}
                  className="guide-section"
                  aria-labelledby={`${s.id}-title`}
                >
                  <h2 id={`${s.id}-title`}>{s.title}</h2>
                  {s.body}
                </section>
              ))}
            </div>
          ))}
        </main>
      </div>
    </div>
  );
}
