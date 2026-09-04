const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const SECRET_KEY = process.env.SECRET_KEY;
const API_BASE = 'https://api.github.com';

const upload = multer({ dest: 'uploads/' });

const builds = new Map();

const authenticate = (req, res, next) => {
  const token = req.headers['x-api-key'];
  if (token !== SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.post('/api/build', authenticate, upload.single('source'), async (req, res) => {
  try {
    const buildId = uuidv4();
    const projectId = req.body.project_id || buildId;

    builds.set(buildId, {
      id: buildId,
      project_id: projectId,
      status: 'uploading',
      created_at: new Date().toISOString()
    });

    if (req.file) {
      const tarPath = req.file.path;
      const tarBytes = fs.readFileSync(tarPath);
      const tarBase64 = tarBytes.toString('base64');

      const filePath = `builds/${projectId}/source.tar.gz`;
      await uploadToGitHub(filePath, tarBase64, `Upload source for ${projectId}`);

      fs.unlinkSync(tarPath);
    }

    const runId = await triggerWorkflow(projectId);

    builds.set(buildId, {
      ...builds.get(buildId),
      status: 'building',
      run_id: runId
    });

    res.json({
      build_id: buildId,
      status: 'building',
      message: 'Build started'
    });

  } catch (error) {
    console.error('Build error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/build/:id/status', authenticate, async (req, res) => {
  try {
    const build = builds.get(req.params.id);
    if (!build) {
      return res.status(404).json({ error: 'Build not found' });
    }

    if (build.run_id) {
      const status = await checkBuildStatus(build.run_id);

      if (status === 'completed') {
        const artifactUrl = await getArtifactUrl(build.run_id);
        builds.set(req.params.id, {
          ...build,
          status: 'success',
          artifact_url: artifactUrl
        });

        return res.json({
          build_id: req.params.id,
          status: 'success',
          artifact_url: artifactUrl
        });
      } else if (status === 'failure') {
        builds.set(req.params.id, {
          ...build,
          status: 'failed'
        });

        return res.json({
          build_id: req.params.id,
          status: 'failed'
        });
      }
    }

    res.json({
      build_id: req.params.id,
      status: build.status
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/build/:id/download', authenticate, async (req, res) => {
  try {
    const build = builds.get(req.params.id);
    if (!build || build.status !== 'success') {
      return res.status(404).json({ error: 'Build not ready' });
    }

    const response = await fetch(build.artifact_url, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      throw new Error('Download failed');
    }

    const buffer = await response.buffer();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${build.project_id}.zip"`);
    res.send(buffer);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function uploadToGitHub(filePath, content, message) {
  const existing = await getFileSha(filePath);

  const body = {
    message: message,
    content: content
  };

  if (existing) {
    body.sha = existing;
  }

  const response = await fetch(
    `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
    {
      method: existing ? 'PUT' : 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub upload failed: ${error}`);
  }

  return response.json();
}

async function getFileSha(filePath) {
  try {
    const response = await fetch(
      `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.sha;
    }
  } catch (e) {}
  return null;
}

async function triggerWorkflow(projectId) {
  const response = await fetch(
    `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/build.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          project_id: projectId,
          user_token: 'server'
        }
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Trigger workflow failed: ${error}`);
  }

  await new Promise(resolve => setTimeout(resolve, 2000));

  const runsResponse = await fetch(
    `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs?per_page=1`,
    {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`
      }
    }
  );

  const runsData = await runsResponse.json();
  if (runsData.workflow_runs && runsData.workflow_runs.length > 0) {
    return runsData.workflow_runs[0].id;
  }

  return null;
}

async function checkBuildStatus(runId) {
  const response = await fetch(
    `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}`,
    {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`
      }
    }
  );

  const data = await response.json();
  return data.status;
}

async function getArtifactUrl(runId) {
  const response = await fetch(
    `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}/artifacts`,
    {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`
      }
    }
  );

  const data = await response.json();
  if (data.artifacts && data.artifacts.length > 0) {
    return data.artifacts[0].archive_download_url;
  }
  return null;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Cloud Build Server running on port ${PORT}`);
  console.log(`GitHub: ${GITHUB_OWNER}/${GITHUB_REPO}`);
});
