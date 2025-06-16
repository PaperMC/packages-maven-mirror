export default {
	async fetch(request, env, ctx): Promise<Response> {
		const githubMavenUrl = `https://maven.pkg.github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
		const githubToken = env.GITHUB_TOKEN;

		const url = new URL(request.url);
		let path = url.pathname;
		if (!path.startsWith(`/${env.GITHUB_REPO}/`)) {
			return new Response(`Invalid request (bad prefix)`, { status: 404 });
		}
		// Remove the leading /${env.GITHUB_REPO}
		// TODO: Support multiple repositories
		path = path.substring(env.GITHUB_REPO.length + 1);
		if (!isAllowedPath(env, path)) {
			return new Response(`Invalid request (bad path)`, { status: 404 });
		}
		if (!isAllowedExtension(env, path)) {
			return new Response(`Invalid request (bad extension)`, { status: 404 });
		}

		const targetUrl = `${githubMavenUrl}${path}`;

		const cache = caches.default;
		const cacheTtl = 60 * 5;
		const cacheKey = new Request(targetUrl, { method: 'GET' });

		const cachedResponse = await cache.match(cacheKey);
		if (cachedResponse) {
			return cachedResponse.clone();
		}

		const newRequest = new Request(targetUrl, {
			method: request.method,
			headers: {
				'Authorization': `Bearer ${githubToken}`,
        'Accept': request.headers.get('Accept') || 'application/octet-stream',
        'User-Agent': 'Cloudflare-Worker-Maven-Proxy',
      },
    });

    try {
      const response = await fetch(newRequest);

      if (!response.ok) {
				console.warn(response);
        return new Response(`Failed to fetch from GitHub Packages`, { status: response.status });
      }

      const cacheResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });

      cacheResponse.headers.set('Cache-Control', `public, max-age=${cacheTtl}`);

      if (response.ok) {
        ctx.waitUntil(
          cache.put(cacheKey, cacheResponse.clone())
        );
      }

      return cacheResponse;
    } catch (error) {
			console.error(error);
      return new Response(`Internal server error`, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

function isAllowedPath(env: Env, url: string): boolean {
	if (env.ALLOWED_PATHS) {
		const allowedPackages: RegExp[] = [];
		const split = env.ALLOWED_PATHS.split(',');
		for (let i = 0; i < split.length; i++) {
			allowedPackages.push(new RegExp(split[i].trim()));
		}
		if (allowedPackages.length === 0) {
			return true;
		}
		for (let i = 0; i < allowedPackages.length; i++) {
			const pkg = allowedPackages[i];
			if (pkg.test(url)) {
				return true;
			}
		}
		return false;
	}
	return true;
}

function isAllowedExtension(env: Env, path: string): boolean {
	const allowedExtensions = env.ALLOWED_EXTENSIONS.split(",");

	for (const ext of allowedExtensions) {
		if (path.endsWith(ext)) {
			return true;
		}
	}

	return false;
}
