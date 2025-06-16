const allowedExtensions = [".jar", ".zip", ".module", ".pom", ".xml", ".sha1", ".md5", ".sha256", ".asc"]

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const githubMavenUrl = `https://maven.pkg.github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
		const githubToken = env.GITHUB_TOKEN;

		const url = new URL(request.url);
		const path = url.pathname;
		if (!path.startsWith("/")) {
			return new Response(`Invalid request (missing slash)`, { status: 404 });
		}
		if (!isAllowedPath(env, path)) {
			return new Response(`Invalid request (path)`, { status: 404 });
		}

		let allowed = false;
		for (const ext of allowedExtensions) {
			if (path.endsWith(ext)) {
				allowed = true;
				break;
			}
		}
		if (!allowed) {
			return new Response(`Invalid request (extension)`, { status: 404 });
		}

		const targetUrl = `${githubMavenUrl}${path}`;

		const cache = caches.default;
		const cacheTtl = 60 * 5;
		const cacheKey = new Request(targetUrl, { method: 'GET' });

		const cachedResponse = await cache.match(cacheKey);
		if (cachedResponse) {
			return new Response(cachedResponse.body, {
				status: cachedResponse.status,
				statusText: cachedResponse.statusText,
				headers: new Headers(cachedResponse.headers),
			});
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
