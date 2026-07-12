import fs from 'fs';
import path from 'path';

function findEnvFile(name) {
  let dir = process.cwd();
  const root = path.parse(dir).root;

  while (true) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

function loadLocalEnv() {
  const envPath = findEnvFile('.env.local');
  if (!envPath) return;
  const contents = fs.readFileSync(envPath, 'utf8');
  contents.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) return;
    const key = match[1].trim();
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  loadLocalEnv();

  const secret = req.query.secret || req.headers['x-admin-secret'];
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret || secret !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const airtableToken = process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME || 'Newsletter';

  if (!airtableToken || !baseId) {
    return res.status(500).json({ error: 'Backend is not configured.' });
  }

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?pageSize=100&sort%5B0%5D%5Bfield%5D=Submitted&sort%5B0%5D%5Bdirection%5D=desc`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${airtableToken}`,
      },
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || 'Airtable request failed');
    }

    const emails = (data.records || []).map(record => ({
      id: record.id,
      email: record.fields.Email || '',
      submitted: record.fields.Submitted || record.createdTime || '',
    }));

    return res.status(200).json({ success: true, emails });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Unable to load submissions.' });
  }
}
