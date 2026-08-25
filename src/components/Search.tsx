import { useEffect, useRef, useState } from 'react';
import './search.css';

interface SearchItem {
  title: string;
  url: string;
  category: string;
}

let indexPromise: Promise<SearchItem[]> | null = null;

function loadIndex(): Promise<SearchItem[]> {
  indexPromise ??= fetch('/search.json').then((r) => r.json());
  return indexPromise;
}

export default function Search() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const results =
    q.length >= 2 && items
      ? items.filter((i) => i.title.toLowerCase().includes(q)).slice(0, 8)
      : [];

  return (
    <div className="search" ref={rootRef}>
      <input
        type="search"
        placeholder="Поиск по сайту…"
        value={query}
        aria-label="Поиск по сайту"
        onFocus={() => {
          setOpen(true);
          loadIndex().then(setItems);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open && q.length >= 2 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={r.url}>
              <a href={r.url}>
                <span>{r.title}</span>
                <small>{r.category}</small>
              </a>
            </li>
          ))}
          {items && results.length === 0 && <li className="search-empty">Ничего не найдено</li>}
        </ul>
      )}
    </div>
  );
}
