import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export const config = {
  api: {
    bodyParser: false,
  },
};

function parseForm(req: NextApiRequest): Promise<{ filepath: string }> {
  const form = formidable({ multiples: false, keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      const file = files.image as formidable.File | undefined;
      if (!file) return reject(new Error('image missing'));
      resolve({ filepath: file.filepath });
    });
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { filepath } = await parseForm(req);

    const py = spawn('python3', [path.join(process.cwd(), 'api', 'reconstruct.py'), filepath], {
      env: { ...process.env },
    });

    let out = '';
    let err = '';
    py.stdout.on('data', (d) => (out += d.toString()));
    py.stderr.on('data', (d) => (err += d.toString()));

    py.on('close', (code) => {
      if (code !== 0) {
        return res.status(500).json({ error: 'Python failed', details: err });
      }
      try {
        const parsed = JSON.parse(out);
        return res.status(200).json(parsed);
      } catch (e: any) {
        return res.status(500).json({ error: 'Invalid JSON from Python', details: out });
      }
    });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Bad request' });
  }
}
