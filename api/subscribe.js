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

function parseJson(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  loadLocalEnv();

  let data;
  try {
    data = await parseJson(req);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const email = typeof data.email === 'string' ? data.email.trim() : '';
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  const airtableToken = process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME || 'Newsletter';

  if (!airtableToken || !baseId) {
    return res.status(500).json({ error: 'Backend is not configured. Set AIRTABLE_PAT (or AIRTABLE_API_KEY) and AIRTABLE_BASE_ID.' });
  }

  const headers = {
    Authorization: `Bearer ${airtableToken}`,
    'Content-Type': 'application/json',
  };

  const filterFormula = `filterByFormula=${encodeURIComponent(`{Email}="${email.replace(/"/g, '\\"')}"`)}`;
  const queryUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?${filterFormula}&maxRecords=1`;

  try {
    const existingRes = await fetch(queryUrl, { headers });
    const existingData = await existingRes.json();
    if (existingData.error) {
      throw new Error(existingData.error.message || 'Airtable query failed');
    }
    if (existingData.records && existingData.records.length > 0) {
      return res.status(200).json({ success: true, duplicate: true });
    }

    const createUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fields: { Email: email } }),
    });
    const createData = await createRes.json();
    if (createData.error) {
      throw new Error(createData.error.message || 'Airtable insert failed');
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Unable to save signup at this time.' });
  }
}
