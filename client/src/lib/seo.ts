/**
 * Small helpers for the public pages' <head>: title, description, link
 * previews (Open Graph) and structured data that search engines read.
 */

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

export function setPageMeta({ title, description, image }: { title: string; description?: string; image?: string }) {
  document.title = title;
  setMeta('property', 'og:title', title);
  setMeta('name', 'twitter:title', title);
  if (description) {
    const text = description.replace(/\s+/g, ' ').trim().slice(0, 300);
    setMeta('name', 'description', text);
    setMeta('property', 'og:description', text);
    setMeta('name', 'twitter:description', text);
  }
  if (image) setMeta('property', 'og:image', image);
  setMeta('property', 'og:url', window.location.origin + window.location.pathname);

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = window.location.origin + window.location.pathname;
}

/** Replaces the page's JSON-LD block with `data` (or removes it when null). */
export function setStructuredData(id: string, data: Record<string, unknown> | null) {
  const existing = document.getElementById(id);
  if (!data) {
    existing?.remove();
    return;
  }
  const script = (existing as HTMLScriptElement | null) || document.createElement('script');
  script.id = id;
  script.type = 'application/ld+json';
  // "<" is escaped so restaurant-provided text can never close the script tag.
  script.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  if (!existing) document.head.appendChild(script);
}
