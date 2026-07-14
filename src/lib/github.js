const GH_USER = 'isuvo';
const GH_ACTIVITY_USERS = ['isuvo', 'shuvo-kage'];

function shortMonth(date) {
  return date.toLocaleString('en-US', { month: 'short' });
}

function readAttribute(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : '';
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
  const activities = await Promise.all(GH_ACTIVITY_USERS.map(async (user) => {
    const html = await fetchText(`https://github.com/users/${user}/contributions`);
    const totalMatch = html.match(/<h2[^>]*>\s*([0-9,]+)\s+contributions\s+in the last year/i);
    const cellRegex = /<[^>]*ContributionCalendar-day[^>]*>/g;
    const levelsByDate = new Map();
    const countsByDate = new Map();

    for (const match of html.matchAll(cellRegex)) {
      const tag = match[0];
      const date = readAttribute(tag, 'data-date');
      const count = Number(readAttribute(tag, 'data-count') || 0);
      const level = Number(readAttribute(tag, 'data-level') || 0);

      if (!date) {
        continue;
      }

      levelsByDate.set(date, level);
      countsByDate.set(date, count);
    }

    return {
      total: totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : 0,
      countsByDate,
      levelsByDate,
    };
  }));

  const total = activities.reduce((sum, activity) => sum + activity.total, 0);
  const levelsByDate = new Map();
  const countsByDate = new Map();

  for (const activity of activities) {
    for (const [date, count] of activity.countsByDate) {
      countsByDate.set(date, (countsByDate.get(date) || 0) + count);
    }

    for (const [date, level] of activity.levelsByDate) {
      levelsByDate.set(date, Math.min(4, (levelsByDate.get(date) || 0) + level));
    }
  }

  const dates = [...new Set([...countsByDate.keys(), ...levelsByDate.keys()])].sort();
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  if (!firstDate || !lastDate) {
    return {
      total: total.toLocaleString('en-US'),
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
      count: countsByDate.get(date) || 0,
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
    total: total.toLocaleString('en-US'),
    cells,
    monthLabels,
  };
}
