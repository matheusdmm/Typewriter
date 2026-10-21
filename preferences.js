(() => {
  let value = null;
  function apply(preferences) {
    value = { ...preferences };
    document.documentElement.dataset.theme = value.theme;
    for (const name of document.querySelectorAll('.brand-copy strong')) name.textContent = value.username;
    for (const brand of document.querySelectorAll('.brand')) brand.textContent = Array.from(value.username)[0].toLocaleUpperCase('pt-BR');
    for (const container of document.querySelectorAll('.blog-addresses')) {
      container.replaceChildren();
      for (const [key, label] of [['productionUrl', 'Produção'], ['developmentUrl', 'Desenvolvimento']]) {
        if (!value[key]) continue;
        const link = document.createElement('a');
        link.href = value[key];
        link.target = '_blank';
        link.rel = 'noopener';
        link.title = `${label}: ${value[key]}`;
        const environment = document.createElement('span');
        environment.className = 'blog-environment';
        environment.textContent = label;
        const address = document.createElement('span');
        address.className = 'blog-address';
        address.textContent = value[key];
        link.append(environment, address);
        container.append(link);
      }
      container.hidden = !container.childElementCount;
    }
    window.dispatchEvent(new CustomEvent('preferences-change', { detail: { ...value } }));
  }
  const ready = fetch('/api/settings').then(async (response) => {
    if (!response.ok) throw new Error('Não foi possível carregar as configurações.');
    const preferences = await response.json();
    apply(preferences);
    return preferences;
  });
  // Each page can report the error through its own status area.
  ready.catch(() => {});
  window.editorPreferences = {
    ready, apply,
    get value() { return value && { ...value }; },
    postUrl(id, environment) {
      const base = environment === 'production' ? value?.productionUrl : value?.developmentUrl;
      return base && id ? `${base}/blog/${encodeURIComponent(id.replace(/\.md$/, ''))}/` : '';
    },
  };
})();
