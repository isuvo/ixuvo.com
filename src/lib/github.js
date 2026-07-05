const GH_USER = 'isuvo';

function shortMonth(date) {
  return date.toLocaleString('en-US', { month: 'short' });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'isuvo-HomeServer-Site',
      Accept: 'text/html,application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status})`);
  }

  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'isuvo-HomeServer-Site',
      Accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status})`);
  }

  return response.json();
}

export async function getGitHubRepos(limit = 9) {
  const repos = await fetchJson(`https://api.github.com/users/${GH_USER}/repos?sort=updated&per_page=${limit}`);

  return repos.map((repo) => ({
    name: repo.name,
    url: repo.html_url,
    description: repo.description || 'No description provided yet.',
    language: repo.language || 'Mixed',
    updated: repo.updated_at,
    homepage: repo.homepage || '',
  }));
}

export async function getGitHubActivity() {
  const html = await fetchText(`https://github.com/users/${GH_USER}/contributions`);
  const totalMatch = html.match(/<h2[^>]*>\s*([0-9,]+)\s+contributions\s+in the last year/i);
  const cellRegex = /data-date="([^"]+)"[^>]*data-level="([^"]+)"[^>]*class="ContributionCalendar-day"/g;
  const levelsByDate = new Map();

  for (const match of html.matchAll(cellRegex)) {
    levelsByDate.set(match[1], Number(match[2] || 0));
  }

  const dates = [...levelsByDate.keys()].sort();
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  if (!firstDate || !lastDate) {
    return {
      total: totalMatch ? totalMatch[1] : '0',
      cells: [],
      monthLabels: [],
    };
  }

  const cells = [];
  const cursor = new Date(`${firstDate}T00:00:00Z`);
  const end = new Date(`${lastDate}T00:00:00Z`);

  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    cells.push({
      date,
      level: levelsByDate.get(date) || 0,
      month: shortMonth(cursor),
      weekday: cursor.getUTCDay(),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const monthLabels = [];
  for (let weekIndex = 0; weekIndex < Math.ceil(cells.length / 7); weekIndex += 1) {
    const weekStart = cells[weekIndex * 7];
    if (!weekStart) {
      continue;
    }

    const date = new Date(`${weekStart.date}T00:00:00Z`);
    if (date.getUTCDate() <= 7 || weekIndex === 0) {
      monthLabels.push({
        label: shortMonth(date),
        weekIndex,
      });
    }
  }

  return {
    total: totalMatch ? totalMatch[1] : '0',
    cells,
    monthLabels,
  };
}
