const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Store logs in memory (in production, use a database)
const logs = [];

// Rate limiting: track requests per IP per minute
const rateLimits = new Map();

// Constants
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;

if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY environment variable not set!');
  process.exit(1);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main ask endpoint
app.post('/api/ask', async (req, res) => {
  const { question, storyTitle } = req.body;
  const userIp = req.ip || req.connection.remoteAddress;
  const startTime = Date.now();

  // Basic validation
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Invalid question' });
  }

  // Rate limiting: max 10 requests per minute per IP
  const now = Date.now();
  const minuteAgo = now - 60000;
  const userKey = userIp;

  if (!rateLimits.has(userKey)) {
    rateLimits.set(userKey, []);
  }

  const userRequests = rateLimits.get(userKey).filter((t) => t > minuteAgo);
  if (userRequests.length >= 10) {
    return res.status(429).json({
      error: 'Rate limit exceeded. Max 10 requests per minute.',
    });
  }

  userRequests.push(now);
  rateLimits.set(userKey, userRequests);

  try {
    // Call Gemini API
    const systemPrompt = `You are a reading companion helping a reader understand a story.
${storyTitle ? `The reader is currently reading: "${storyTitle}".` : ''}

RULES:
1. Answer in 2-4 sentences maximum.
2. Only discuss things up to and including the current story. NEVER reveal twists or endings.
3. If asked something that would spoil it, say: "That would spoil it - keep reading!"
4. Give brief, clear definitions for old-fashioned words or confusing phrases.
5. Be concise and conversational. Never write long essays.`;

    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: question }] }],
        }),
      }
    );

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      throw new Error(geminiData.error?.message || 'Gemini API error');
    }

    const answer =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'No answer';
    const responseTime = Date.now() - startTime;

    // Log the request
    logs.push({
      timestamp: new Date().toISOString(),
      userIp,
      storyTitle: storyTitle || 'unknown',
      questionLength: question.length,
      answerLength: answer.length,
      responseTime,
      success: true,
    });

    // Keep only last 1000 logs to avoid memory bloat
    if (logs.length > 1000) {
      logs.shift();
    }

    res.json({ answer });
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // Log the error
    logs.push({
      timestamp: new Date().toISOString(),
      userIp,
      storyTitle: storyTitle || 'unknown',
      questionLength: question.length,
      responseTime,
      success: false,
      error: error.message,
    });

    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Logs dashboard endpoint
app.get('/api/logs', (req, res) => {
  const now = Date.now();
  const lastHour = now - 3600000;
  const lastDay = now - 86400000;

  // Calculate stats
  const logsLastHour = logs.filter(
    (log) => new Date(log.timestamp).getTime() > lastHour
  );
  const logsLastDay = logs.filter(
    (log) => new Date(log.timestamp).getTime() > lastDay
  );

  const successLastHour = logsLastHour.filter((log) => log.success).length;
  const successLastDay = logsLastDay.filter((log) => log.success).length;

  const avgResponseTimeLastHour =
    logsLastHour.length > 0
      ? Math.round(
          logsLastHour.reduce((sum, log) => sum + log.responseTime, 0) /
            logsLastHour.length
        )
      : 0;

  const avgResponseTimeLastDay =
    logsLastDay.length > 0
      ? Math.round(
          logsLastDay.reduce((sum, log) => sum + log.responseTime, 0) /
            logsLastDay.length
        )
      : 0;

  // Most active stories
  const storyCount = {};
  logsLastDay.forEach((log) => {
    storyCount[log.storyTitle] =
      (storyCount[log.storyTitle] || 0) + (log.success ? 1 : 0);
  });

  const topStories = Object.entries(storyCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  res.json({
    summary: {
      totalRequests: logs.length,
      requestsLastHour: logsLastHour.length,
      successfulLastHour: successLastHour,
      requestsLastDay: logsLastDay.length,
      successfulLastDay: successLastDay,
      avgResponseTimeLastHourMs: avgResponseTimeLastHour,
      avgResponseTimeLastDayMs: avgResponseTimeLastDay,
    },
    topStoriesLastDay: topStories.map(([story, count]) => ({
      story,
      requests: count,
    })),
    recentLogs: logs.slice(-20).reverse(),
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Lumina backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Logs dashboard: http://localhost:${PORT}/api/logs`);
});
