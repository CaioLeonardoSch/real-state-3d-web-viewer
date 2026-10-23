// site.html, the site's former address (links in old e-mails and bookmarks): the site is now the platform's root
// (index.html). Keeps the query, which names the client and the page (?imobiliaria=…&p=…).
location.replace(`./${location.search}${location.hash}`);
