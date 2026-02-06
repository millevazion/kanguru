const OVERRIDE_KEY = 'answer_overrides';

const getAuthHeader = (token?: string) => ({
  Authorization: `Bearer ${token ?? ''}`
});

const getApiUrl = (edgeConfigId: string) => {
  const url = new URL(`https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`);
  if (process.env.VERCEL_TEAM_ID) {
    url.searchParams.set('teamId', process.env.VERCEL_TEAM_ID);
  }
  return url;
};

const readOverrides = async () => {
  const edgeConfigId = process.env.EDGE_CONFIG_ID;
  const apiToken = process.env.VERCEL_API_TOKEN;
  if (!edgeConfigId || !apiToken) {
    return {};
  }
  const response = await fetch(getApiUrl(edgeConfigId), {
    method: 'GET',
    headers: {
      ...getAuthHeader(apiToken)
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to read overrides (${response.status})`);
  }
  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const entry = items.find((item: { key?: string }) => item?.key === OVERRIDE_KEY);
  return (entry?.value ?? {}) as Record<string, Record<string, string>>;
};

const writeOverrides = async (overrides: Record<string, Record<string, string>>) => {
  const edgeConfigId = process.env.EDGE_CONFIG_ID;
  const apiToken = process.env.VERCEL_API_TOKEN;
  if (!edgeConfigId || !apiToken) {
    throw new Error('Missing EDGE_CONFIG_ID or VERCEL_API_TOKEN.');
  }
  const response = await fetch(getApiUrl(edgeConfigId), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(apiToken)
    },
    body: JSON.stringify({
      items: [
        {
          operation: 'upsert',
          key: OVERRIDE_KEY,
          value: overrides
        }
      ]
    })
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Failed to update overrides (${response.status})`);
  }
};

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      const overrides = await readOverrides();
      return res.status(200).json({ overrides });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load overrides.';
      return res.status(500).json({ error: message, overrides: {} });
    }
  }

  if (req.method === 'POST') {
    const adminToken = req.headers['x-admin-token'];
    const token = Array.isArray(adminToken) ? adminToken[0] : adminToken;
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const overrides = req.body?.overrides;
    if (!overrides || typeof overrides !== 'object') {
      return res.status(400).json({ error: 'Invalid overrides payload.' });
    }

    try {
      await writeOverrides(overrides);
      return res.status(200).json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update overrides.';
      return res.status(500).json({ error: message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed.' });
}
